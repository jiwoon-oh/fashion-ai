import { NextResponse, type NextRequest } from "next/server";
import type { User } from "@supabase/supabase-js";
import type { BattleResult } from "@/lib/rubric";
import { isMock } from "@/lib/scoring";
import { cleanRecent } from "@/lib/roaster";
import { errorStatus, getScores, ipHashOf, judge, photoHash, pickRoast, readJpeg, recordBattle, type Ctx } from "@/lib/battle-core";
import { finishRoom, getPhoto, getRoom, isExpired, isHost, ROOM_TTL_H, type Room } from "@/lib/rooms";
import { ensureProfile, nameFromMeta } from "@/lib/friends";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Params = { params: Promise<{ code: string }> };
const err = (code: string, status: number) => NextResponse.json({ error: code }, { status });

export type RoomView = {
  status: "waiting" | "done" | "expired";
  role: "host" | "guest" | "viewer";
  hostName: string;
  guestName: string | null;
  expiresAt: string;
  result: BattleResult | null;
};

function view(room: Room, role: RoomView["role"], loggedIn: boolean, own?: { recorded: boolean; photoShared: boolean }): RoomView {
  const expiresAt = new Date(new Date(room.createdAt).getTime() + ROOM_TTL_H * 3600_000).toISOString();
  const status = room.result ? "done" : isExpired(room) ? "expired" : "waiting";
  let result: BattleResult | null = null;
  if (room.result) {
    // 방장(1P)이 보면: 로그인해서 만든 방이고 가짜 점수가 아니면 랭킹 반영됨
    const hostRec = role === "host" && !!room.hostId && !room.isMock && room.p1Hash !== room.p2Hash;
    const rec = own ?? { recorded: hostRec, photoShared: hostRec && room.hostShare };
    result = { ...room.result, ...rec, loggedIn };
  }
  return { status, role, hostName: room.hostName, guestName: room.guestName, expiresAt, result };
}

// GET /api/rooms/<코드> (헤더 x-room-token: 방장 토큰) → 방 상태. 방장 폰은 이걸 몇 초마다 확인한다
export async function GET(request: NextRequest, { params }: Params) {
  const { code } = await params;
  const db = adminClient();
  const room = await getRoom(db, code);
  if (!room) return err("not_found", 404);
  const host = isHost(room, request.headers.get("x-room-token"));
  const user = await currentUser();
  const role = host ? "host" : room.result ? "viewer" : "guest";
  return NextResponse.json(view(room, role, !!user), { headers: { "Cache-Control": "no-store" } });
}

// POST /api/rooms/<코드> → 2P가 자기 사진으로 붙기. 결과를 바로 돌려주고 방에도 저장 (방장 폰이 확인해 감)
export async function POST(request: NextRequest, { params }: Params) {
  const { code } = await params;
  const db = adminClient();
  const room = await getRoom(db, code);
  if (!room) return err("not_found", 404);
  if (room.result) return err("room_taken", 409);
  if (isExpired(room)) return err("room_expired", 410);
  if (isHost(room, request.headers.get("x-room-token"))) return err("own_room", 400);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return err("bad_request", 400);
  }
  const p2 = await readJpeg(form.get("p2"));
  if (typeof p2 === "string") return err(p2, p2 === "too_big" ? 413 : 400);
  const h2 = photoHash(p2);

  const user = await currentUser();
  const ctx: Ctx = { user, ipHash: ipHashOf(request.headers), mock: isMock() || room.isMock, db, recent: cleanRecent(form.get("recent")) };

  try {
    const { scores, fresh, roasts } = await getScores([{ img: p2, hash: h2 }], ctx);
    const s1 = room.p1Score, s2 = scores.get(h2)!;
    const { winner, loser } = judge(s1, s2, room.p1Hash, h2);

    // 한줄평은 진 쪽 사진을 보고 만든다. 1P가 졌으면 저장해 둔 1P 사진을 꺼낸다
    const p1 = loser === "p1" || room.hostShare ? await getPhoto(db, code, "p1") : null;
    const roast = loser === "p2" || !p1
      ? await pickRoast(ctx, { img: p2, score: s2, fresh: roasts.get(h2) }, s1)
      : await pickRoast(ctx, { img: p1, score: s1 }, s2);

    let guestName = "익명의 상대";
    if (user) {
      const profile = db ? await ensureProfile(db, user).catch(() => null) : null;
      guestName = (profile?.name ?? nameFromMeta(user.user_metadata)).slice(0, 12) || guestName;
    }

    const result = {
      p1: s1, p2: s2, winner, loser, roast,
      cachedSides: { p1: room.p1Cached, p2: !fresh.has(h2) || h2 === room.p1Hash },
      mock: ctx.mock,
    };
    const ok = await finishRoom(db, code, { guestId: user?.id ?? null, guestName, p2Hash: h2, result }, p2);
    if (!ok) return err("room_taken", 409);

    // 기록: 각자 자기 사진이 1P 자리인 배틀로 남긴다 (랭킹·친구 화면)
    const mine = user
      ? await recordBattle(ctx, user, { img: p2, hash: h2, score: s2 }, { hash: room.p1Hash, score: s1 }, winner === "p2", form.get("share_photo") === "1")
      : { recorded: false, photoShared: false };
    if (room.hostId && room.hostId !== user?.id) {
      const hostImg = p1 ?? (await getPhoto(db, code, "p1"));
      if (hostImg) {
        await recordBattle(ctx, { id: room.hostId } as User, { img: hostImg, hash: room.p1Hash, score: s1 }, { hash: h2, score: s2 }, winner === "p1", room.hostShare);
      }
    }

    const done = { ...room, guestId: user?.id ?? null, guestName, p2Hash: h2, result, finishedAt: new Date().toISOString() };
    return NextResponse.json(view(done, "guest", !!user, mine));
  } catch (e) {
    const { code: c, status } = errorStatus(e);
    return err(c, status);
  }
}
