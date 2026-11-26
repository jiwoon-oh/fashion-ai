import { NextResponse, type NextRequest } from "next/server";
import { getPhoto, getRoom, isExpired, isHost } from "@/lib/rooms";
import { adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /api/rooms/<코드>/photo?side=p1|p2 → 대결방 사진
// 1P 사진: 방장은 언제든, 다른 사람은 결과가 난 뒤에만 (2P가 상대 사진 보고 고르지 못하게)
// 2P 사진: 결과가 난 뒤에만
export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const side = request.nextUrl.searchParams.get("side");
  if (side !== "p1" && side !== "p2") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const db = adminClient();
  const room = await getRoom(db, code);
  if (!room || isExpired(room)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const host = isHost(room, request.headers.get("x-room-token"));
  if (!room.result && !(side === "p1" && host)) return NextResponse.json({ error: "locked" }, { status: 403 });
  const img = await getPhoto(db, code, side);
  if (!img) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return new NextResponse(new Uint8Array(img), {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" },
  });
}
