import { NextResponse, type NextRequest } from "next/server";
import { isMock } from "@/lib/scoring";
import { errorStatus, getScores, ipHashOf, photoHash, readJpeg, type Ctx } from "@/lib/battle-core";
import { cleanupRooms, createRoom, newCode, newToken, tokenHash, ROOM_TTL_H } from "@/lib/rooms";
import { ensureProfile, nameFromMeta } from "@/lib/friends";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const err = (code: string, status: number) => NextResponse.json({ error: code }, { status });

// POST /api/rooms → 1P가 자기 사진으로 도전장(링크 대결방) 만들기
// 1P 사진은 여기서 미리 채점해 둔다 (2P가 붙으면 바로 결과가 나오게)
export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("bad_request", 400);
  }
  const p1 = await readJpeg(form.get("p1"));
  if (typeof p1 === "string") return err(p1, p1 === "too_big" ? 413 : 400);
  const hash = photoHash(p1);

  const user = await currentUser();
  const db = adminClient();
  const ctx: Ctx = { user, ipHash: ipHashOf(request.headers), mock: isMock(), db, recent: [] };

  let score;
  let cached = false;
  try {
    const r = await getScores([{ img: p1, hash }], ctx);
    score = r.scores.get(hash)!;
    cached = !r.fresh.has(hash);
  } catch (e) {
    const { code, status } = errorStatus(e);
    return err(code, status);
  }

  let hostName = "익명의 도전자";
  if (user) {
    const profile = db ? await ensureProfile(db, user).catch(() => null) : null;
    hostName = (profile?.name ?? nameFromMeta(user.user_metadata)).slice(0, 12) || hostName;
  }

  const token = newToken();
  cleanupRooms(db).catch((e) => console.error("room cleanup", e));
  for (let i = 0; i < 3; i++) {
    const code = newCode();
    const ok = await createRoom(db, {
      code,
      hostTokenHash: tokenHash(token),
      hostId: user?.id ?? null,
      hostName,
      hostShare: !!user && form.get("share_photo") === "1",
      p1Hash: hash,
      p1Score: score,
      p1Cached: cached,
      guestId: null,
      guestName: null,
      p2Hash: null,
      result: null,
      isMock: ctx.mock,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    }, p1);
    if (ok) return NextResponse.json({ code, token, hostName, ttlHours: ROOM_TTL_H });
  }
  return err("room_failed", 500);
}
