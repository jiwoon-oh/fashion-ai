import type { Metadata } from "next";
import Link from "next/link";
import RankingBoard from "@/components/RankingBoard";
import { authConfigured } from "@/lib/supabase/config";

export const metadata: Metadata = { title: "랭킹 · 옷빨 배틀" };

export default function RankingPage() {
  return (
    <div className="wrap">
      <nav className="topbar" aria-label="상단 메뉴">
        <div className="left"><Link className="chip" href="/">◀ 배틀하러 가기</Link></div>
      </nav>
      <header>
        <h1 className="wordart">명예의 전당</h1>
        <br />
        <p className="sub">이번 주 랭킹. 랭킹 등록한 사람만 닉네임으로 올라감</p>
      </header>
      <RankingBoard authReady={authConfigured()} />
    </div>
  );
}
