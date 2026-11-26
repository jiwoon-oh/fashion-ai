import { NextResponse } from "next/server";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// 주간 랭킹 한 줄: 닉네임(랭킹 등록 때 정한 것), 이번 주 최고 점수, 이번 주 승수
export type RankRow = { rank: number; name: string; best: number; wins: number; me: boolean };
export type RankingMe = { loggedIn: boolean; registered: boolean; name: string | null };
export type RankingResponse = {
  configured: boolean;
  dbError?: boolean;
  weekStart: string;
  rows: RankRow[];
  me: RankingMe;
};

// 한국 시간 기준 이번 주 월요일 0시
function startOfWeekKst() {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7;
  kst.setUTCDate(kst.getUTCDate() - daysSinceMonday);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600_000);
}

// GET /api/ranking → 이번 주 랭킹 (랭킹 등록한 사람만) + 내 등록 상태
export async function GET() {
  const weekStart = startOfWeekKst();
  const db = adminClient();
  const user = await currentUser();
  const guest: RankingMe = { loggedIn: !!user, registered: false, name: null };
  if (!db) {
    return NextResponse.json({ configured: false, weekStart: weekStart.toISOString(), rows: [], me: guest } satisfies RankingResponse);
  }

  const [ranking, profile] = await Promise.all([
    db.rpc("get_weekly_ranking", { since: weekStart.toISOString(), max_rows: 50 }),
    user ? db.from("profiles").select("rank_name").eq("id", user.id).maybeSingle() : Promise.resolve(null),
  ]);
  if (ranking.error) console.error("get_weekly_ranking", ranking.error.message);
  if (profile?.error) console.error("ranking me", profile.error.message);

  const rankName = (profile?.data?.rank_name as string | null | undefined) ?? null;
  const rows = ((ranking.data ?? []) as { rank: number; user_id: string; rank_name: string; best: number; wins: number }[]).map((r) => ({
    rank: Number(r.rank),
    name: r.rank_name,
    best: r.best,
    wins: r.wins,
    me: !!user && r.user_id === user.id,
  }));
  return NextResponse.json({
    configured: true,
    dbError: !!ranking.error || !!profile?.error,
    weekStart: weekStart.toISOString(),
    rows,
    me: { loggedIn: !!user, registered: !!rankName, name: rankName },
  } satisfies RankingResponse);
}
