import { NextResponse } from "next/server";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export type RankRow = { rank: number; name: string; value: number; detail: string | null; me: boolean };
export type RankingResponse = {
  configured: boolean;
  weekStart: string;
  all: { best: RankRow[]; wins: RankRow[] };
  weekly: { best: RankRow[]; wins: RankRow[] };
};

// 한국 시간 기준 이번 주 월요일 0시
function startOfWeekKst() {
  const kst = new Date(Date.now() + 9 * 3600_000);
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7;
  kst.setUTCDate(kst.getUTCDate() - daysSinceMonday);
  kst.setUTCHours(0, 0, 0, 0);
  return new Date(kst.getTime() - 9 * 3600_000);
}

export async function GET() {
  const weekStart = startOfWeekKst();
  const empty = { best: [], wins: [] };
  const db = adminClient();
  if (!db) {
    return NextResponse.json({ configured: false, weekStart: weekStart.toISOString(), all: empty, weekly: empty } satisfies RankingResponse);
  }
  const user = await currentUser();

  const load = async (kind: "best" | "wins", since: Date | null): Promise<RankRow[]> => {
    const { data, error } = await db.rpc("get_ranking", { kind, since: since?.toISOString() ?? null, max_rows: 50 });
    if (error) {
      console.error("get_ranking", error.message);
      return [];
    }
    return (data ?? []).map((r: { rank: number; user_id: string; display_name: string; value: number; detail: string | null }) => ({
      rank: Number(r.rank),
      name: r.display_name,
      value: r.value,
      detail: r.detail,
      me: !!user && r.user_id === user.id,
    }));
  };

  const [allBest, allWins, wkBest, wkWins] = await Promise.all([
    load("best", null),
    load("wins", null),
    load("best", weekStart),
    load("wins", weekStart),
  ]);
  return NextResponse.json({
    configured: true,
    weekStart: weekStart.toISOString(),
    all: { best: allBest, wins: allWins },
    weekly: { best: wkBest, wins: wkWins },
  } satisfies RankingResponse);
}
