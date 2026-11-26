import type { Metadata } from "next";
import Link from "next/link";
import FriendsBoard from "@/components/FriendsBoard";
import { currentUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "친구 · 옷빨 배틀" };
export const dynamic = "force-dynamic";

export default async function FriendsPage() {
  const user = await currentUser();
  return (
    <div className="wrap">
      <nav className="topbar" aria-label="상단 메뉴">
        <div className="left"><Link className="chip" href="/">◀ 배틀하러 가기</Link></div>
        <div className="right"><Link className="chip" href="/ranking">🏆 랭킹</Link></div>
      </nav>
      <header>
        <h1 className="wordart">친구들 옷빨</h1>
        <br />
        <p className="sub">내 친구들이 어떤 코디로 몇 점 받았는지 구경하셈</p>
      </header>
      {user ? (
        <FriendsBoard />
      ) : (
        <p className="status small">로그인해야 친구 기능 씀 ㅠ <Link href="/">배틀 화면</Link> 오른쪽 위에서 로그인 ㄱ</p>
      )}
    </div>
  );
}
