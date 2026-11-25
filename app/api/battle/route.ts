import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { RUBRIC_VERSION, decideWinner, type BattleResult, type Score } from "@/lib/rubric";
import { FAVORITES, ScoringError, isMock, pick, roastPhoto, scorePhoto, scoringMode } from "@/lib/scoring";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BYTES = 3 * 1024 * 1024;
const DAILY_LIMIT = Number(process.env.DAILY_SCORE_LIMIT) || 20;
const ANON_DAILY_LIMIT = Number(process.env.ANON_DAILY_SCORE_LIMIT) || 6;

// DB 가 아직 없을 때(로컬 시험) 쓰는 임시 저장소
const memScores = new Map<string, Score>();

const err = (code: string, status: number) => NextResponse.json({ error: code }, { status });

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");

function isJpeg(b: Buffer) {
  return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

// 한국 시간 기준 오늘 0시
function startOfTodayKst() {
  const now = new Date(Date.now() + 9 * 3600_000);
  now.setUTCHours(0, 0, 0, 0);
  return new Date(now.getTime() - 9 * 3600_000);
}

// GET /api/battle → 지금 채점 모드 확인 (mock / live / not_configured)
export function GET() {
  return NextResponse.json({ mode: scoringMode(), mockFlagSet: process.env.MOCK_SCORING !== undefined });
}

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("bad_request", 400);
  }
  const files = { p1: form.get("p1"), p2: form.get("p2") };
  const img: { p1?: Buffer; p2?: Buffer } = {};
  for (const side of ["p1", "p2"] as const) {
    const f = files[side];
    if (!(f instanceof Blob) || f.size === 0) return err("missing_photo", 400);
    if (f.size > MAX_BYTES) return err("too_big", 413);
    const b = Buffer.from(await f.arrayBuffer());
    if (!isJpeg(b)) return err("image_rejected", 400);
    img[side] = b;
  }
  const p1 = img.p1!, p2 = img.p2!;
  const hash = { p1: sha(p1).slice(0, 32), p2: sha(p2).slice(0, 32) };

  const user = await currentUser();
  // 가짜 점수 모드(AI 키 없이 시험 배포)에서는 DB에 점수·배틀을 남기지 않는다 → 랭킹이 가짜로 오염되지 않음
  const db = isMock() ? null : adminClient();

  // 1) 저장된 점수 꺼내기
  const cached: { p1?: Score; p2?: Score } = {};
  if (db) {
    const { data, error } = await db
      .from("photo_scores")
      .select("hash,color,fit,harmony,trend,total,nickname,praise")
      .eq("rubric_version", RUBRIC_VERSION)
      .in("hash", [hash.p1, hash.p2]);
    if (error) console.error("photo_scores read", error.message);
    for (const row of data ?? []) {
      const s: Score = { color: row.color, fit: row.fit, harmony: row.harmony, trend: row.trend, total: row.total, nickname: row.nickname, praise: row.praise };
      if (row.hash === hash.p1) cached.p1 = s;
      if (row.hash === hash.p2) cached.p2 = s;
    }
  } else {
    cached.p1 = memScores.get(hash.p1);
    cached.p2 = memScores.get(hash.p2);
  }

  // 2) 새로 채점할 장수만큼 하루 제한 확인 (가짜 점수 모드는 제한 없음)
  const freshSides = (["p1", "p2"] as const).filter((s) => !cached[s] && !(s === "p2" && hash.p2 === hash.p1));
  const ipHash = sha("ootd:" + (request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "local")).slice(0, 32);
  if (db && freshSides.length && !isMock()) {
    const since = startOfTodayKst().toISOString();
    const q = db.from("photo_scores").select("hash", { count: "exact", head: true }).gte("created_at", since);
    const { count } = await (user ? q.eq("scored_by", user.id) : q.eq("scored_ip", ipHash));
    const used = count ?? 0;
    const limit = user ? DAILY_LIMIT : ANON_DAILY_LIMIT;
    if (used + freshSides.length > limit) return err(user ? "daily_limit" : "login_required", 429);
  }

  // 3) 새 사진 채점 (두 장 동시에)
  const freshRoast: { p1?: string; p2?: string } = {};
  try {
    await Promise.all(
      freshSides.map(async (side) => {
        const { score, roast } = await scorePhoto(img[side]!, hash[side]);
        cached[side] = score;
        freshRoast[side] = roast;
        if (db) {
          const { error } = await db.from("photo_scores").upsert(
            { hash: hash[side], rubric_version: RUBRIC_VERSION, ...score, scored_by: user?.id ?? null, scored_ip: ipHash },
            { onConflict: "hash,rubric_version", ignoreDuplicates: true },
          );
          if (error) console.error("photo_scores write", error.message);
        } else {
          memScores.set(hash[side], score);
        }
      }),
    );
  } catch (e) {
    if (e instanceof ScoringError) return err(e.code, e.code === "rate_limited" ? 429 : e.code === "refused" ? 422 : 502);
    console.error(e);
    return err("upstream", 502);
  }
  if (!cached.p2 && hash.p2 === hash.p1) cached.p2 = cached.p1;
  const s1 = cached.p1!, s2 = cached.p2!;

  // 4) 승패와 한줄평
  const winner = decideWinner(s1, s2, hash.p1, hash.p2);
  const loser = winner === "p1" ? "p2" : "p1";
  let roast = freshRoast[loser] ?? "";
  if (!roast) {
    try {
      roast = await roastPhoto(img[loser]!, cached[loser]!, cached[winner]!);
    } catch {
      roast = "";
    }
  }
  if (!roast) roast = pick(FAVORITES);

  // 5) 로그인했으면 기록 → 랭킹 반영 (같은 사진끼리는 기록 안 함)
  let recorded = false;
  if (user && db && hash.p1 !== hash.p2) {
    const { error } = await db.from("battles").insert({
      user_id: user.id,
      p1_hash: hash.p1,
      p2_hash: hash.p2,
      p1_total: s1.total,
      p2_total: s2.total,
      p1_won: winner === "p1",
      p1_nickname: s1.nickname,
    });
    if (error) console.error("battles write", error.message);
    else recorded = true;
  }

  const body: BattleResult = {
    p1: s1,
    p2: s2,
    winner,
    loser,
    roast,
    cachedSides: { p1: !freshSides.includes("p1"), p2: !freshSides.includes("p2") },
    recorded,
    loggedIn: !!user,
  };
  return NextResponse.json(body);
}
