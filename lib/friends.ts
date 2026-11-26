import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";

// 친구 탭은 한 줄 요약만: 최고 점수, 승수, 판 수 (어떤 사진으로 몇 점인지는 안 보여줌)
export type FriendSummary = {
  id: string;
  name: string;
  me: boolean;
  best: { total: number; nickname: string; mock: boolean } | null; // 최고 점수 (가짜 점수 판 제외, 없으면 가짜 포함)
  wins: number; // 이긴 판 수 (같은 사진 조합은 1승)
  battles: number;
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

type BattleRow = { user_id: string; p1_hash: string; p2_hash: string; p1_total: number; p1_won: boolean; p1_nickname: string; is_mock: boolean };

export async function loadFriends(db: SupabaseClient, user: User): Promise<FriendsResponse> {
  const { inviteCode } = await ensureProfile(db, user);

  const { data: links } = await db.from("friendships").select("friend_id").eq("user_id", user.id).limit(MAX_FRIENDS);
  const ids = [user.id, ...(links ?? []).map((l) => l.friend_id as string)];

  const [{ data: profiles }, { data: rows }] = await Promise.all([
    db.from("profiles").select("id, display_name").in("id", ids),
    db
      .from("battles")
      .select("user_id, p1_hash, p2_hash, p1_total, p1_won, p1_nickname, is_mock")
      .in("user_id", ids)
      .eq("hidden", false)
      .order("created_at", { ascending: false })
      .limit(5000),
  ]);

  const battles = (rows ?? []) as BattleRow[];
  const nameOf = new Map((profiles ?? []).map((p) => [p.id as string, p.display_name as string]));
  const summary = (id: string): FriendSummary => {
    const mine = battles.filter((b) => b.user_id === id);
    const real = mine.filter((b) => !b.is_mock);
    const pool = real.length ? real : mine;
    const best = pool.reduce<BattleRow | null>((m, b) => (!m || b.p1_total > m.p1_total ? b : m), null);
    const wins = new Set(real.filter((b) => b.p1_won).map((b) => b.p1_hash + ":" + b.p2_hash)).size;
    return {
      id,
      name: nameOf.get(id) ?? "익명",
      me: id === user.id,
      best: best ? { total: best.p1_total, nickname: best.p1_nickname, mock: best.is_mock } : null,
      wins,
      battles: mine.length,
    };
  };

  const friends = ids.slice(1).map(summary).sort((a, b) => (b.best?.total ?? -1) - (a.best?.total ?? -1) || b.wins - a.wins);
  return { inviteCode, me: summary(user.id), friends };
}
