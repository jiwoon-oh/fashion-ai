import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { RUBRIC_VERSION, decideWinner, type Score } from "./rubric";
import { ScoringError, roastPhoto, scorePhoto } from "./scoring";
import { fallbackRoast, guardRoast } from "./roaster";

// 일반 배틀(/api/battle)과 링크 대결(/api/rooms)이 같이 쓰는 채점·한줄평·기록 로직

export const MAX_BYTES = 3 * 1024 * 1024;
const DAILY_LIMIT = Number(process.env.DAILY_SCORE_LIMIT) || 20;
const ANON_DAILY_LIMIT = Number(process.env.ANON_DAILY_SCORE_LIMIT) || 6;

export const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export const photoHash = (b: Buffer) => sha(b).slice(0, 32);
export const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** 하루 제한 초과 등 채점 전에 막힌 경우 */
export class LimitError extends Error {
  constructor(public code: "daily_limit" | "login_required") {
    super(code);
  }
}

export type Ctx = {
  user: User | null;
  ipHash: string;
  mock: boolean;
  db: SupabaseClient | null;
  recent: string[]; // 이 사람이 최근에 본 한줄평 (반복 금지)
};

export function ipHashOf(headers: Headers) {
  return sha("ootd:" + (headers.get("x-forwarded-for")?.split(",")[0].trim() || "local")).slice(0, 32);
}

// 한국 시간 기준 오늘 0시
function startOfTodayKst() {
  const now = new Date(Date.now() + 9 * 3600_000);
  now.setUTCHours(0, 0, 0, 0);
  return new Date(now.getTime() - 9 * 3600_000);
}

// DB 가 아직 없을 때(로컬 시험·가짜 점수) 쓰는 임시 저장소
const memScores = new Map<string, Score>();

/** 폼에서 JPEG 한 장 꺼내기. 문제 있으면 에러 코드 문자열 */
export async function readJpeg(f: FormDataEntryValue | null): Promise<Buffer | string> {
  if (!(f instanceof Blob) || f.size === 0) return "missing_photo";
  if (f.size > MAX_BYTES) return "too_big";
  const b = Buffer.from(await f.arrayBuffer());
  return isJpeg(b) ? b : "image_rejected";
}

/**
 * 여러 장 점수 얻기: 저장된 점수가 있으면 그대로, 없으면 새로 채점 (하루 제한 확인 포함).
 * 같은 지문은 한 번만 채점한다.
 */
export async function getScores(
  photos: { img: Buffer; hash: string }[],
  ctx: Ctx,
): Promise<{ scores: Map<string, Score>; fresh: Set<string>; roasts: Map<string, string> }> {
  const scoreDb = ctx.mock ? null : ctx.db; // 가짜 점수는 DB 점수 캐시에 안 남긴다
  const scores = new Map<string, Score>();
  const hashes = [...new Set(photos.map((p) => p.hash))];

  if (scoreDb) {
    const { data, error } = await scoreDb
      .from("photo_scores")
      .select("hash,color,fit,harmony,trend,total,nickname,praise")
      .eq("rubric_version", RUBRIC_VERSION)
      .in("hash", hashes);
    if (error) console.error("photo_scores read", error.message);
    for (const row of data ?? []) {
      scores.set(row.hash, { color: row.color, fit: row.fit, harmony: row.harmony, trend: row.trend, total: row.total, nickname: row.nickname, praise: row.praise });
    }
  } else {
    for (const h of hashes) {
      const s = memScores.get(h);
      if (s) scores.set(h, s);
    }
  }

  const todo = hashes.filter((h) => !scores.has(h));
  if (scoreDb && todo.length) {
    const since = startOfTodayKst().toISOString();
    const q = scoreDb.from("photo_scores").select("hash", { count: "exact", head: true }).gte("created_at", since);
    const { count } = await (ctx.user ? q.eq("scored_by", ctx.user.id) : q.eq("scored_ip", ctx.ipHash));
    const limit = ctx.user ? DAILY_LIMIT : ANON_DAILY_LIMIT;
    if ((count ?? 0) + todo.length > limit) throw new LimitError(ctx.user ? "daily_limit" : "login_required");
  }

  const roasts = new Map<string, string>();
  await Promise.all(
    todo.map(async (h) => {
      const img = photos.find((p) => p.hash === h)!.img;
      const { score, roast } = await scorePhoto(img, h, ctx.recent);
      scores.set(h, score);
      roasts.set(h, roast);
      if (scoreDb) {
        const { error } = await scoreDb.from("photo_scores").upsert(
          { hash: h, rubric_version: RUBRIC_VERSION, ...score, scored_by: ctx.user?.id ?? null, scored_ip: ctx.ipHash },
          { onConflict: "hash,rubric_version", ignoreDuplicates: true },
        );
        if (error) console.error("photo_scores write", error.message);
      } else {
        memScores.set(h, score);
      }
    }),
  );
  return { scores, fresh: new Set(todo), roasts };
}

/**
 * 진 쪽 한줄평: 채점하며 같이 만든 것 → 검사 탈락·반복이면 조롱 LLM 전용 호출 → 그래도 안 되면 은행 문장.
 * 최근에 본 문장은 어느 단계에서도 다시 안 쓴다.
 */
export async function pickRoast(
  ctx: Ctx,
  loser: { img: Buffer; score: Score; fresh?: string },
  winner: Score,
): Promise<string> {
  if (ctx.mock) return "(가짜 점수) " + fallbackRoast(ctx.recent);
  let roast = guardRoast(loser.fresh, ctx.recent) ?? "";
  if (!roast) {
    try {
      roast = guardRoast(await roastPhoto(loser.img, loser.score, winner, ctx.recent), ctx.recent) ?? "";
    } catch {
      roast = "";
    }
  }
  return roast || fallbackRoast(ctx.recent);
}

export function judge(s1: Score, s2: Score, h1: string, h2: string) {
  const winner = decideWinner(s1, s2, h1, h2);
  return { winner, loser: winner === "p1" ? ("p2" as const) : ("p1" as const) };
}

/**
 * 로그인한 사람의 배틀 기록 (그 사람 사진이 1P 자리). 같은 사진끼리는 기록 안 함.
 * sharePhoto 면 그 사람 사진만 친구 공개용으로 저장. 상대 사진은 여기서 저장하지 않는다.
 */
export async function recordBattle(
  ctx: Ctx,
  user: User,
  mine: { img: Buffer; hash: string; score: Score },
  other: { hash: string; score: Score },
  won: boolean,
  sharePhoto: boolean,
): Promise<{ recorded: boolean; photoShared: boolean }> {
  const db = ctx.db;
  if (!db || mine.hash === other.hash) return { recorded: false, photoShared: false };
  let path: string | null = null;
  if (sharePhoto) {
    const p = `${user.id}/${mine.hash}.jpg`;
    const { error } = await db.storage.from("photos").upload(p, mine.img, { contentType: "image/jpeg", upsert: true });
    if (error) console.error("photo upload", error.message);
    else path = p;
  }
  const { error } = await db.from("battles").insert({
    is_mock: ctx.mock,
    p1_photo_path: path,
    user_id: user.id,
    p1_hash: mine.hash,
    p2_hash: other.hash,
    p1_total: mine.score.total,
    p2_total: other.score.total,
    p1_won: won,
    p1_nickname: mine.score.nickname,
  });
  if (error) console.error("battles write", error.message);
  return { recorded: !error && !ctx.mock, photoShared: !!path };
}

/** 채점 에러 → HTTP 응답 코드 */
export function errorStatus(e: unknown): { code: string; status: number } {
  if (e instanceof LimitError) return { code: e.code, status: 429 };
  if (e instanceof ScoringError) return { code: e.code, status: e.code === "rate_limited" ? 429 : e.code === "refused" ? 422 : 502 };
  console.error(e);
  return { code: "upstream", status: 502 };
}
