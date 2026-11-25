import Link from "next/link";
import Battle from "@/components/Battle";
import TopBar from "@/components/TopBar";
import { authConfigured } from "@/lib/supabase/config";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ login?: string }> }) {
  const user = await currentUser();
  const { login } = await searchParams;
  const name = user ? displayName(user.user_metadata) : null;
  return (
    <div className="wrap">
      <TopBar userName={name} authReady={authConfigured()} loginFailed={login === "failed"} />
      <header>
        <span className="sticker s1" aria-hidden="true">✨</span>
        <span className="sticker s2" aria-hidden="true">💅</span>
        <h1 className="wordart">옷빨 배틀</h1>
        <br />
        <p className="sub">두 장 찍든 올리든 하고 가운데 START 누르면 채점 들어감</p>
      </header>
      <div className="rank-entry">
        <Link className="rank-btn" href="/ranking">🏆 랭킹 <small>전체·주간</small></Link>
      </div>
      <Battle loggedIn={!!user} />
    </div>
  );
}

function displayName(meta: Record<string, unknown> | undefined) {
  const v = meta?.nickname ?? meta?.user_name ?? meta?.preferred_username ?? meta?.name ?? meta?.full_name;
  return typeof v === "string" && v.trim() ? v.trim().slice(0, 12) : "나";
}
