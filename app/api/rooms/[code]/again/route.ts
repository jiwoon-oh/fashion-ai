import { NextResponse, type NextRequest } from "next/server";
import { isMock } from "@/lib/scoring";
import { cleanRecent } from "@/lib/roaster";
import { ipHashOf, pickRoast, type Ctx } from "@/lib/battle-core";
import { bumpReroll, getPhoto, getRoom, isExpired } from "@/lib/rooms";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const err = (code: string, status: number) => NextResponse.json({ error: code }, { status });

// POST /api/rooms/<코드>/again { recent } → 끝난 대결(공유 링크·도전장)에서 한줄평만 다시 뽑는다.
// 점수·승패는 그대로. 새 한줄평은 이 사람 화면에만 보여 주고 방에는 저장하지 않는다 (링크는 처음 결과 그대로).
export async function POST(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = adminClient();
  const room = await getRoom(db, code);
  if (!room || !room.result) return err("not_found", 404);
  if (isExpired(room)) return err("room_expired", 410);

  const body = await request.json().catch(() => ({}));
  const user = await currentUser();
  const ctx: Ctx = { user, ipHash: ipHashOf(request.headers), mock: isMock() || room.isMock, db, recent: cleanRecent(body?.recent) };
  if (!(await bumpReroll(db, room))) return err("reroll_limit", 429);

  const r = room.result;
  const img = await getPhoto(db, code, r.loser);
  if (!img) return err("not_found", 404);
  const loser = r.loser === "p1" ? r.p1 : r.p2;
  const winner = r.winner === "p1" ? r.p1 : r.p2;
  try {
    const { roast, style } = await pickRoast(ctx, { img, score: loser }, winner);
    return NextResponse.json({ roast, roastStyle: style });
  } catch (e) {
    console.error("room again", e);
    return err("upstream", 502);
  }
}
