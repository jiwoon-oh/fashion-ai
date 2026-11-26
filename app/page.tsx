import Link from "next/link";
import Battle from "@/components/Battle";
import TopBar from "@/components/TopBar";
import { ensureProfile, nameFromMeta } from "@/lib/friends";
import { authConfigured } from "@/lib/supabase/config";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ login?: string }> }) {
  const user = await currentUser();
  const { login } = await searchParams;
  const db = adminClient();
  const profile = user && db ? await ensureProfile(db, user).catch(() => null) : null;
  const name = user ? (profile?.name ?? nameFromMeta(user.user_metadata)).slice(0, 12) : null;
  return (
    <div className="wrap">
      <TopBar userName={name} inviteCode={profile?.inviteCode || null} authReady={authConfigured()} loginFailed={login === "failed"} />
      <header>
        <span className="sticker s1" aria-hidden="true">✨</span>
        <span className="sticker s2" aria-hidden="true">💅</span>
        <h1 className="wordart">옷빨 배틀</h1>
      </header>
      <div className="rank-entry">
        <Link className="rank-btn" href="/ranking">🏆 랭킹 <small>주간</small></Link>
      </div>
      <Battle loggedIn={!!user} inviteCode={profile?.inviteCode || null} />
    </div>
  );
}
