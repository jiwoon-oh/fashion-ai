import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { RUBRIC_VERSION, decideWinner, type Score } from "./rubric";
import { ScoringError, roastPhoto, scorePhoto } from "./scoring";
import { fallbackRoast, guardRoast } from "./roaster";

// 일반 배틀(/api/battle)과 링크 대결(/api/rooms)이 같이 쓰는 채점·한줄평·기록 로직

export const MAX_BYTES = 3 * 1024 * 1024;
// 하루 채점 제한 (2026-11-27 사용자 결정): 비로그인 10판, 로그인 20판. 한 판 = 새 사진 2장이라 장수로는 ×2.
// 이미 채점한 사진(같은 사진)은 다시 세지 않는다. 예전 환경변수(DAILY_SCORE_LIMIT 등, 장수 기준)는 안 씀
const DAILY_BATTLES = Number(process.env.DAILY_BATTLE_LIMIT) || 20;
const ANON_DAILY_BATTLES = Number(process.env.ANON_DAILY_BATTLE_LIMIT) || 10;
const photosFor = (battles: number) => battles * 2;

export const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
export const photoHash = (b: Buffer) => sha(b).slice(0, 32);
export const isJpeg = (b: Buffer) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

/** 한줄평 + 스타일 번호(로그용: "s1"~"s25" / "bank" / "mock") */
export type Roast = { roast: string; style: string };

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
): Promise<{ scores: Map<string, Score>; fresh: Set<string>; roasts: Map<string, Roast> }> {
  const scoreDb = ctx.mock ? null : ctx.db; // 가짜 점수는 DB 점수 캐시에 안 남긴다
  const scores = new Map<string, Score>();
  const hashes = [...new Set(photos.map((p) => p.hash))];

  if (scoreDb) {
    // mood 칸은 2026-11-26에 추가. 아직 SQL 을 안 돌린 DB 면 mood 없이 다시 읽는다
    const read = (cols: string) => scoreDb.from("photo_scores").select(cols).eq("rubric_version", RUBRIC_VERSION).in("hash", hashes);
    let { data, error } = await read("hash,color,fit,harmony,trend,total,nickname,praise,mood");
    if (error && /mood/.test(error.message)) ({ data, error } = await read("hash,color,fit,harmony,trend,total,nickname,praise"));
    if (error) console.error("photo_scores read", error.message);
    for (const row of (data ?? []) as unknown as (Score & { hash: string; mood?: string | null })[]) {
      scores.set(row.hash, { color: row.color, fit: row.fit, harmony: row.harmony, trend: row.trend, total: row.total, nickname: row.nickname, praise: row.praise, mood: row.mood ?? undefined });
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
    const limit = photosFor(ctx.user ? DAILY_BATTLES : ANON_DAILY_BATTLES);
    if ((count ?? 0) + todo.length > limit) throw new LimitError(ctx.user ? "daily_limit" : "login_required");
  }

  const roasts = new Map<string, Roast>();
  await Promise.all(
    todo.map(async (h) => {
      const img = photos.find((p) => p.hash === h)!.img;
      const { score, roast, style } = await scorePhoto(img, h, ctx.recent);
      scores.set(h, score);
      roasts.set(h, { roast, style });
      if (scoreDb) {
        const row: Record<string, unknown> = { hash: h, rubric_version: RUBRIC_VERSION, ...score, scored_by: ctx.user?.id ?? null, scored_ip: ctx.ipHash };
        const write = (r: Record<string, unknown>) =>
          scoreDb.from("photo_scores").upsert(r, { onConflict: "hash,rubric_version", ignoreDuplicates: true });
        let { error } = await write(row);
        if (error && /mood/.test(error.message)) {
          delete row.mood; // mood 칸이 아직 없는 DB
          ({ error } = await write(row));
        }
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
  loser: { img: Buffer; score: Score; fresh?: Roast },
  winner: Score,
): Promise<Roast> {
  if (ctx.mock) return { roast: "(가짜 점수) " + fallbackRoast(ctx.recent), style: "mock" };
  const fresh = guardRoast(loser.fresh?.roast, ctx.recent);
  if (fresh) return { roast: fresh, style: loser.fresh!.style };
  try {
    const r = await roastPhoto(loser.img, loser.score, winner, ctx.recent);
    const text = guardRoast(r.roast, ctx.recent);
    if (text) return { roast: text, style: r.style };
  } catch {
    /* 아래 은행 문장 */
  }
  return { roast: fallbackRoast(ctx.recent), style: "bank" };
}

/**
 * 무드가 같은 두 코디는 점수 차를 3~5점으로 좁힌다 ("아깝게 짐"). 승패는 그대로.
 * 원래 차이가 5점 이하면 손대지 않는다. 같은 두 사진은 언제나 같은 결과가 나오게 사진 지문으로 3·4·5 중 하나를 고른다.
 * 사진별 저장 점수(photo_scores)는 그대로 두고, 이 배틀에 보여 주는 점수만 바꾼다.
 */
export function narrowGap(s1: Score, s2: Score, h1: string, h2: string): { s1: Score; s2: Score; rawDiff: number | null } {
  const raw = Math.abs(s1.total - s2.total);
  if (!s1.mood || s1.mood !== s2.mood || s1.mood === "기타" || raw <= 5 || h1 === h2) return { s1, s2, rawDiff: null };
  const gap = 3 + (parseInt(sha([h1, h2].sort().join(":")).slice(0, 8), 16) % 3);
  const p1Wins = s1.total > s2.total;
  const [hi, lo] = p1Wins ? [s1, s2] : [s2, s1];
  const top = Math.min(100, Math.round((hi.total + lo.total + gap) / 2));
  const nHi = shiftTo(hi, top), nLo = shiftTo(lo, top - gap);
  return p1Wins ? { s1: nHi, s2: nLo, rawDiff: raw } : { s1: nLo, s2: nHi, rawDiff: raw };
}

/** 항목 점수를 1점씩 옮겨 총점을 target 으로 맞춘다 (올릴 땐 낮은 항목부터, 내릴 땐 높은 항목부터) */
function shiftTo(s: Score, target: number): Score {
  const keys = ["color", "fit", "harmony", "trend"] as const;
  const v = { color: s.color, fit: s.fit, harmony: s.harmony, trend: s.trend };
  let total = keys.reduce((n, k) => n + v[k], 0);
  target = Math.max(0, Math.min(100, target));
  while (total !== target) {
    const up = total < target;
    const k = [...keys].filter((x) => (up ? v[x] < 25 : v[x] > 0)).sort((a, b) => (up ? v[a] - v[b] : v[b] - v[a]))[0];
    if (!k) break;
    v[k] += up ? 1 : -1;
    total += up ? 1 : -1;
  }
  return { ...s, ...v, total };
}

export function judge(s1: Score, s2: Score, h1: string, h2: string) {
  const winner = decideWinner(s1, s2, h1, h2);
  return { winner, loser: winner === "p1" ? ("p2" as const) : ("p1" as const) };
}

/**
 * 로그인한 사람의 배틀 기록 (그 사람 사진이 1P 자리). 같은 사진끼리는 기록 안 함.
 * 사진 자체는 저장하지 않는다 (점수·승패·지문만).
 */
export async function recordBattle(
  ctx: Ctx,
  user: User,
  mine: { hash: string; score: Score },
  other: { hash: string; score: Score },
  won: boolean,
): Promise<{ recorded: boolean; photoShared: boolean }> {
  const db = ctx.db;
  if (!db || mine.hash === other.hash) return { recorded: false, photoShared: false };
  const { error } = await db.from("battles").insert({
    is_mock: ctx.mock,
    user_id: user.id,
    p1_hash: mine.hash,
    p2_hash: other.hash,
    p1_total: mine.score.total,
    p2_total: other.score.total,
    p1_won: won,
    p1_nickname: mine.score.nickname,
  });
  if (error) console.error("battles write", error.message);
  return { recorded: !error && !ctx.mock, photoShared: false };
}

/** 채점 에러 → HTTP 응답 코드 */
export function errorStatus(e: unknown): { code: string; status: number } {
  if (e instanceof LimitError) return { code: e.code, status: 429 };
  if (e instanceof ScoringError) return { code: e.code, status: e.code === "rate_limited" ? 429 : e.code === "refused" ? 422 : 502 };
  console.error(e);
  return { code: "upstream", status: 502 };
}
