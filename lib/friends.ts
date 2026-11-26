import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";

export type FriendBattle = { total: number; nickname: string; won: boolean; at: string; photoUrl: string | null; mock: boolean };
export type FriendSummary = {
  id: string;
  name: string;
  me: boolean;
  best: FriendBattle | null; // 최고 점수 판 (가짜 점수 판은 제외, 없으면 가짜 포함 최고)
  wins: number; // 이긴 판 수 (같은 사진 조합은 1승)
  battles: number;
  recent: FriendBattle[];
};
export type FriendsResponse = { inviteCode: string; me: FriendSummary; friends: FriendSummary[] };

export const MAX_FRIENDS = 200;

export function nameFromMeta(meta: Record<string, unknown> | undefined) {
  const v = meta?.nickname ?? meta?.user_name ?? meta?.preferred_username ?? meta?.name ?? meta?.full_name;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 20) : "익명";
}

// 프로필이 없으면 만들고(트리거보다 먼저 가입한 사람 대비) 초대 코드를 돌려준다
export async function ensureProfile(db: SupabaseClient, user: User): Promise<{ inviteCode: string; name: string }> {
  const read = () => db.from("profiles").select("invite_code, display_name").eq("id", user.id).maybeSingle();
  let { data } = await read();
  if (!data) {
    await db.from("profiles").upsert({ id: user.id, display_name: nameFromMeta(user.user_metadata) }, { onConflict: "id", ignoreDuplicates: true });
    ({ data } = await read());
  }
  return { inviteCode: data?.invite_code ?? "", name: data?.display_name ?? nameFromMeta(user.user_metadata) };
}

type BattleRow = { user_id: string; p1_hash: string; p2_hash: string; p1_total: number; p1_won: boolean; p1_nickname: string; p1_photo_path: string | null; is_mock: boolean; hidden: boolean; created_at: string };

export async function loadFriends(db: SupabaseClient, user: User): Promise<FriendsResponse> {
  const { inviteCode } = await ensureProfile(db, user);

  const { data: links } = await db.from("friendships").select("friend_id").eq("user_id", user.id).limit(MAX_FRIENDS);
  const ids = [user.id, ...(links ?? []).map((l) => l.friend_id as string)];

  const [{ data: profiles }, { data: rows }] = await Promise.all([
    db.from("profiles").select("id, display_name").in("id", ids),
    db
      .from("battles")
      .select("user_id, p1_hash, p2_hash, p1_total, p1_won, p1_nickname, p1_photo_path, is_mock, hidden, created_at")
      .in("user_id", ids)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const battles = (rows ?? []) as BattleRow[];

  // 사진은 비공개 저장소에 있으므로 1시간짜리 임시 링크를 만든다
  const paths = [...new Set(battles.map((b) => b.p1_photo_path).filter((p): p is string => !!p))];
  const urlOf = new Map<string, string>();
  if (paths.length) {
    const { data: signed } = await db.storage.from("photos").createSignedUrls(paths, 3600);
    for (const s of signed ?? []) if (s.path && s.signedUrl) urlOf.set(s.path, s.signedUrl);
  }
  const toItem = (b: BattleRow): FriendBattle => ({
    total: b.p1_total,
    nickname: b.p1_nickname,
    won: b.p1_won,
    at: b.created_at,
    photoUrl: b.p1_photo_path ? urlOf.get(b.p1_photo_path) ?? null : null,
    mock: b.is_mock,
  });

  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));
  const summary = (id: string): FriendSummary => {
    const mine = battles.filter((b) => b.user_id === id);
    const real = mine.filter((b) => !b.is_mock);
    const pool = real.length ? real : mine;
    const best = pool.reduce<BattleRow | null>((m, b) => (!m || b.p1_total > m.p1_total ? b : m), null);
    const wins = new Set(real.filter((b) => b.p1_won).map((b) => b.p1_hash + ":" + b.p2_hash)).size;
    // 같은 사진은 한 번만 (최근 판 기준)
    const seen = new Set<string>();
    const recent: FriendBattle[] = [];
    for (const b of mine) {
      if (seen.has(b.p1_hash)) continue;
      seen.add(b.p1_hash);
      recent.push(toItem(b));
      if (recent.length >= 8) break;
    }
    return { id, name: nameOf.get(id) ?? "익명", me: id === user.id, best: best ? toItem(best) : null, wins, battles: mine.length, recent };
  };

  const friends = ids.slice(1).map(summary).sort((a, b) => (b.best?.total ?? -1) - (a.best?.total ?? -1));
  return { inviteCode, me: summary(user.id), friends };
}
