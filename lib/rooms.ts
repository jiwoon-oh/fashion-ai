import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BattleResult, Score } from "./rubric";
import { sha } from "./battle-core";

// 링크 대결방: 1P가 자기 폰에서 사진을 올려 방을 만들고 링크를 보내면,
// 2P가 자기 폰에서 그 링크를 열어 사진을 올린다. 결과는 양쪽 폰에 같이 뜬다.
// 사진은 결과를 양쪽이 볼 수 있게 비공개 저장소 'photos' 의 rooms/<코드>/ 아래에 ROOM_TTL_H 시간만 둔다.

export const ROOM_TTL_H = 24;
const TTL_MS = ROOM_TTL_H * 3600_000;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // 헷갈리는 글자(i l o 0 1) 뺌

export type RoomResult = Pick<BattleResult, "p1" | "p2" | "winner" | "loser" | "roast" | "cachedSides" | "mock">;

export type Room = {
  code: string;
  hostTokenHash: string;
  hostId: string | null;
  hostName: string;
  hostShare: boolean;
  p1Hash: string;
  p1Score: Score;
  p1Cached: boolean;
  guestId: string | null;
  guestName: string | null;
  p2Hash: string | null;
  result: RoomResult | null;
  isMock: boolean;
  createdAt: string;
  finishedAt: string | null;
};

export const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
export const newToken = () => randomBytes(18).toString("base64url");
export const tokenHash = (t: string) => sha("room:" + t).slice(0, 40);
export const validCode = (c: string) => /^[a-z0-9]{8}$/.test(c);
export const isExpired = (r: Room) => Date.now() - new Date(r.createdAt).getTime() > TTL_MS;
export const isHost = (r: Room, token: string | null | undefined) => !!token && tokenHash(token) === r.hostTokenHash;

const photoPath = (code: string, side: "p1" | "p2") => `rooms/${code}/${side}.jpg`;

// ---------- DB 행 <-> Room ----------
type Row = {
  code: string; host_token_hash: string; host_id: string | null; host_name: string; host_share: boolean;
  p1_hash: string; p1_score: Score; p1_cached: boolean; guest_id: string | null; guest_name: string | null;
  p2_hash: string | null; result: RoomResult | null; is_mock: boolean; created_at: string; finished_at: string | null;
};
const fromRow = (r: Row): Room => ({
  code: r.code, hostTokenHash: r.host_token_hash, hostId: r.host_id, hostName: r.host_name, hostShare: r.host_share,
  p1Hash: r.p1_hash, p1Score: r.p1_score, p1Cached: r.p1_cached, guestId: r.guest_id, guestName: r.guest_name,
  p2Hash: r.p2_hash, result: r.result, isMock: r.is_mock, createdAt: r.created_at, finishedAt: r.finished_at,
});

// DB 가 없을 때(로컬 시험) 쓰는 임시 저장소
// 라우트끼리 같은 저장소를 보도록 전역에 둔다
const g = globalThis as unknown as { __ootdRooms?: Map<string, { room: Room; photos: Partial<Record<"p1" | "p2", Buffer>> }> };
const mem = (g.__ootdRooms ??= new Map());

export async function createRoom(db: SupabaseClient | null, room: Room, p1: Buffer): Promise<boolean> {
  if (!db) {
    mem.set(room.code, { room, photos: { p1 } });
    return true;
  }
  const up = await db.storage.from("photos").upload(photoPath(room.code, "p1"), p1, { contentType: "image/jpeg", upsert: true });
  if (up.error) {
    console.error("room photo upload", up.error.message);
    return false;
  }
  const { error } = await db.from("battle_rooms").insert({
    code: room.code, host_token_hash: room.hostTokenHash, host_id: room.hostId, host_name: room.hostName, host_share: room.hostShare,
    p1_hash: room.p1Hash, p1_score: room.p1Score, p1_cached: room.p1Cached, is_mock: room.isMock, created_at: room.createdAt,
  });
  if (error) {
    console.error("room insert", error.message);
    await db.storage.from("photos").remove([photoPath(room.code, "p1")]);
    return false;
  }
  return true;
}

export async function getRoom(db: SupabaseClient | null, code: string): Promise<Room | null> {
  if (!validCode(code)) return null;
  if (!db) return mem.get(code)?.room ?? null;
  const { data, error } = await db.from("battle_rooms").select("*").eq("code", code).maybeSingle();
  if (error) console.error("room read", error.message);
  return data ? fromRow(data as Row) : null;
}

export async function getPhoto(db: SupabaseClient | null, code: string, side: "p1" | "p2"): Promise<Buffer | null> {
  if (!db) return mem.get(code)?.photos[side] ?? null;
  const { data, error } = await db.storage.from("photos").download(photoPath(code, side));
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/**
 * 2P 결과 저장. 아직 아무도 안 붙은 방일 때만 성공한다 (동시에 두 명이 붙으면 먼저 온 사람만).
 */
export async function finishRoom(
  db: SupabaseClient | null,
  code: string,
  patch: { guestId: string | null; guestName: string; p2Hash: string; result: RoomResult },
  p2: Buffer,
): Promise<boolean> {
  const finishedAt = new Date().toISOString();
  if (!db) {
    const m = mem.get(code);
    if (!m || m.room.p2Hash) return false;
    m.room = { ...m.room, ...patch, finishedAt };
    m.photos.p2 = p2;
    return true;
  }
  const { data, error } = await db
    .from("battle_rooms")
    .update({ guest_id: patch.guestId, guest_name: patch.guestName, p2_hash: patch.p2Hash, result: patch.result, finished_at: finishedAt })
    .eq("code", code)
    .is("p2_hash", null)
    .select("code");
  if (error) console.error("room finish", error.message);
  if (error || !data?.length) return false;
  const up = await db.storage.from("photos").upload(photoPath(code, "p2"), p2, { contentType: "image/jpeg", upsert: true });
  if (up.error) console.error("room p2 upload", up.error.message);
  return true;
}

/** 만료된 방 정리 (방 만들 때 가끔 같이 돈다): 사진 지우고 행 삭제 */
export async function cleanupRooms(db: SupabaseClient | null) {
  const cutoff = new Date(Date.now() - TTL_MS).toISOString();
  if (!db) {
    for (const [k, v] of mem) if (v.room.createdAt < cutoff) mem.delete(k);
    return;
  }
  const { data } = await db.from("battle_rooms").select("code").lt("created_at", cutoff).limit(50);
  const codes = (data ?? []).map((r: { code: string }) => r.code);
  if (!codes.length) return;
  await db.storage.from("photos").remove(codes.flatMap((c) => [photoPath(c, "p1"), photoPath(c, "p2")]));
  await db.from("battle_rooms").delete().in("code", codes);
}
