import { NextResponse, type NextRequest } from "next/server";
import { isMock } from "@/lib/scoring";
import { acceptSharedRoast, fallbackRoast } from "@/lib/roaster";
import { errorStatus, getScores, ipHashOf, judge, narrowGap, photoHash, readJpeg, type Ctx } from "@/lib/battle-core";
import { createSharedRoom, newCode, newToken, tokenHash, SHARE_TTL_DAYS, type RoomResult } from "@/lib/rooms";
import { ensureProfile, nameFromMeta } from "@/lib/friends";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const err = (code: string, status: number) => NextResponse.json({ error: code }, { status });

// POST /api/share → 한 폰에서 한 배틀 결과를 공유 링크(/r/<코드>)로 만든다.
// 받는 것: p1·p2 사진, 화면에 나온 한줄평(roast)·말투(roastStyle)
// 점수·승패는 브라우저가 보낸 값을 믿지 않고 서버에서 다시 계산한다 (이미 채점한 사진이라 저장된 점수를 꺼내 씀, 추가 비용 없음).
// 한줄평은 검사를 통과하면 그대로, 아니면 은행 문장으로 바꾼다.
// 두 사진과 결과는 SHARE_TTL_DAYS 일 동안 보관하고, 링크를 아는 사람은 볼 수 있다.
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
  const h1 = photoHash(p1), h2 = photoHash(p2);

  const user = await currentUser();
  const db = adminClient();
  const ctx: Ctx = { user, ipHash: ipHashOf(request.headers), mock: isMock(), db, recent: [] };

  try {
    const { scores, fresh } = await getScores([{ img: p1, hash: h1 }, { img: p2, hash: h2 }], ctx);
    const { s1, s2, rawDiff } = narrowGap(scores.get(h1)!, scores.get(h2)!, h1, h2);
    const { winner, loser } = judge(s1, s2, h1, h2);
    const sent = String(form.get("roast") ?? "").replace(/^\(가짜 점수\)\s*/, "").slice(0, 120);
    const ok = acceptSharedRoast(sent);
    const roast = ctx.mock ? "(가짜 점수) " + (ok ?? fallbackRoast()) : ok ?? fallbackRoast();
    const roastStyle = String(form.get("roastStyle") ?? "").slice(0, 12) || undefined;

    let hostName = "1P";
    if (user) {
      const profile = db ? await ensureProfile(db, user).catch(() => null) : null;
      hostName = (profile?.name ?? nameFromMeta(user.user_metadata)).slice(0, 12) || hostName;
    }
    const now = new Date();
    const result: RoomResult = {
      p1: s1, p2: s2, winner, loser, roast, roastStyle,
      ...(rawDiff !== null ? { rawDiff } : {}),
      cachedSides: { p1: !fresh.has(h1), p2: !fresh.has(h2) || h1 === h2 },
      mock: ctx.mock,
      keepUntil: new Date(now.getTime() + SHARE_TTL_DAYS * 86400_000).toISOString(),
      rerolls: 0,
    };
    for (let i = 0; i < 3; i++) {
      const code = newCode();
      const ok = await createSharedRoom(db, {
        code,
        hostTokenHash: tokenHash(newToken()), // 공유 방은 방장 기능이 없어서 토큰은 버린다
        hostId: user?.id ?? null,
        hostName,
        hostShare: false,
        p1Hash: h1,
        p1Score: s1,
        p1Cached: result.cachedSides.p1,
        guestId: null,
        guestName: "2P",
        p2Hash: h2,
        result,
        isMock: ctx.mock,
        createdAt: now.toISOString(),
        finishedAt: now.toISOString(),
      }, p1, p2);
      if (ok) return NextResponse.json({ code, days: SHARE_TTL_DAYS });
    }
    return err("share_failed", 500);
  } catch (e) {
    const { code, status } = errorStatus(e);
    return err(code, status);
  }
}
