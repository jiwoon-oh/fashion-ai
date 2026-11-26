import { NextResponse, type NextRequest } from "next/server";
import type { BattleResult } from "@/lib/rubric";
import { isMock, scoringMode } from "@/lib/scoring";
import { cleanRecent } from "@/lib/roaster";
import { errorStatus, getScores, ipHashOf, judge, photoHash, pickRoast, readJpeg, recordBattle, type Ctx } from "@/lib/battle-core";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const err = (code: string, status: number) => NextResponse.json({ error: code }, { status });

// GET /api/battle → 지금 채점 모드 확인 (mock / live / not_configured)
export function GET() {
  return NextResponse.json({ mode: scoringMode(), mockFlagSet: process.env.MOCK_SCORING !== undefined });
}

// POST /api/battle → 한 폰에서 1P·2P 사진 두 장을 같이 올리는 배틀
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("bad_request", 400);
  }
  const p1 = await readJpeg(form.get("p1"));
  if (typeof p1 === "string") return err(p1, p1 === "too_big" ? 413 : 400);
  const p2 = await readJpeg(form.get("p2"));
  if (typeof p2 === "string") return err(p2, p2 === "too_big" ? 413 : 400);
  const hash = { p1: photoHash(p1), p2: photoHash(p2) };

  const user = await currentUser();
  const ctx: Ctx = { user, ipHash: ipHashOf(request.headers), mock: isMock(), db: adminClient(), recent: cleanRecent(form.get("recent")) };

  try {
    const { scores, fresh, roasts } = await getScores([{ img: p1, hash: hash.p1 }, { img: p2, hash: hash.p2 }], ctx);
    const s1 = scores.get(hash.p1)!, s2 = scores.get(hash.p2)!;
    const { winner, loser } = judge(s1, s2, hash.p1, hash.p2);
    const roast = await pickRoast(
      ctx,
      { img: loser === "p1" ? p1 : p2, score: loser === "p1" ? s1 : s2, fresh: roasts.get(hash[loser]) },
      winner === "p1" ? s1 : s2,
    );

    // 로그인했으면 기록 → 랭킹·친구 화면 반영 (사진은 저장 안 함)
    const rec = user
      ? await recordBattle(ctx, user, { hash: hash.p1, score: s1 }, { hash: hash.p2, score: s2 }, winner === "p1")
      : { recorded: false, photoShared: false };

    const body: BattleResult = {
      p1: s1,
      p2: s2,
      winner,
      loser,
      roast,
      cachedSides: { p1: !fresh.has(hash.p1), p2: !fresh.has(hash.p2) || hash.p1 === hash.p2 },
      ...rec,
      mock: ctx.mock,
      loggedIn: !!user,
    };
    return NextResponse.json(body);
  } catch (e) {
    const { code, status } = errorStatus(e);
    return err(code, status);
  }
}
