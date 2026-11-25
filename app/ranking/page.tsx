import type { Metadata } from "next";
import Link from "next/link";
import RankingBoard from "@/components/RankingBoard";

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
        <p className="sub">왼쪽은 전체, 오른쪽은 이번 주. 로그인한 사람의 1P 사진만 올라감</p>
      </header>
      <RankingBoard />
    </div>
  );
}
