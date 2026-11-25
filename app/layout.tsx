import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "옷빨 배틀",
  description: "코디 사진 두 장 올리면 AI가 점수 매기고 진 쪽을 긁어줌",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Jua&family=Press+Start+2P&display=swap" />
      </head>
      <body>
        <div className="marquee" aria-hidden="true">
          <div className="marquee-track">
            <span>★☆ 오늘의 옷빨왕은 누구냐 ☆★</span>
            <span>사진 두 장 올리면 AI가 점수 매김</span>
            <span>♥ 진 사람 울어도 책임 안 짐 ♥</span>
            <span>얼평 아님 옷평임 ㅇㅇ</span>
            <span>★ 1촌 신청 환영 ★</span>
          </div>
        </div>
        {children}
        <div className="rain" id="rain" aria-hidden="true" />
      </body>
    </html>
  );
}
