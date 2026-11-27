import type { Metadata } from "next";
import Link from "next/link";
import Battle from "@/components/Battle";
import TopBar from "@/components/TopBar";
import { ensureProfile, nameFromMeta } from "@/lib/friends";
import { getRoom, isExpired } from "@/lib/rooms";
import { authConfigured } from "@/lib/supabase/config";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ code: string }>; searchParams: Promise<{ new?: string }> };

// 카톡·인스타·X 로 링크 보냈을 때 미리보기.
// 끝난 대결(결과 공유 링크 포함)이면 두 사진 그림(/r/<코드>/og) + 점수 + 한줄평, 아니면 도전장 안내
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const room = await getRoom(adminClient(), code).catch(() => null);
  const r = room?.result && !isExpired(room) ? room.result : null;
  const title = r
    ? `${room!.hostName} ${r.p1.total}점 vs ${room!.guestName || "2P"} ${r.p2.total}점 · 옷빨 배틀`
    : room ? `${room.hostName} 님의 옷빨 배틀 도전장` : "옷빨 배틀 도전장";
  const description = r
    ? `AI 한줄평: ${r.roast.replace(/^\(가짜 점수\)\s*/, "")} — 너도 붙어볼래?`
    : "링크 열고 내 코디 사진 올리면 AI가 바로 채점해서 승패 가림 ㅋㅋ";
  const image = r ? `/r/${code}/og` : "/og.png";
  return {
    title,
    description,
    openGraph: { title, description, url: `/r/${code}`, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    robots: { index: false },
  };
}

export default async function RoomPage({ params, searchParams }: Props) {
  const { code } = await params;
  const { new: isNew } = await searchParams;
  const user = await currentUser();
  const db = adminClient();
  const profile = user && db ? await ensureProfile(db, user).catch(() => null) : null;
  const name = user ? (profile?.name ?? nameFromMeta(user.user_metadata)).slice(0, 12) : null;
  const room = await getRoom(db, code).catch(() => null);
  const shared = !!room?.result?.keepUntil;
  return (
    <div className="wrap">
      <TopBar userName={name} inviteCode={profile?.inviteCode || null} authReady={authConfigured()} loginFailed={false} />
      <header>
        <h1 className="wordart">옷빨 배틀</h1>
        <br />
        <p className="sub">{shared ? "🔗 공유된 대결 · AGAIN 누르면 한줄평만 새로 뽑힘" : "📨 도전장 대결 · 각자 폰에서 사진 올리면 양쪽에 결과 뜸"}</p>
      </header>
      <div className="rank-entry">
        <Link className="rank-btn" href="/ranking">🏆 랭킹 <small>주간</small></Link>
      </div>
      <Battle loggedIn={!!user} inviteCode={profile?.inviteCode || null} room={code.toLowerCase()} roomNew={isNew === "1"} />
    </div>
  );
}
