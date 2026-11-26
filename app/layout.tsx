import type { Metadata, Viewport } from "next";
import "./globals.css";
import Tracker from "@/components/Tracker";
import { currentUser } from "@/lib/supabase/server";

// 링크 미리보기(카톡·페북·X 등)에 쓰는 사이트 주소. Vercel이 실제 서비스 주소를 넣어 준다
const SITE = process.env.NEXT_PUBLIC_SITE_URL
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
const DESC = "코디 사진 두 장 올리면 AI가 점수 매기고 진 쪽을 긁어줌 ㅋㅋ 친구랑 옷빨 배틀 ㄱ";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: "옷빨 배틀",
  description: DESC,
  openGraph: {
    title: "옷빨 배틀",
    description: DESC,
    url: "/",
    siteName: "옷빨 배틀",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "옷빨 배틀" }],
  },
  twitter: { card: "summary_large_image", title: "옷빨 배틀", description: DESC, images: ["/og.png"] },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser().catch(() => null);
  return (
    <html lang="ko">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=Jua&family=Press+Start+2P&display=swap" />
      </head>
      <body>
        <Tracker loggedIn={!!user} />
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
        <nav className="legal-links" aria-label="약관">
          <a href="/terms">이용약관</a> · <a href="/privacy"><b>개인정보처리방침</b></a> · 로그인은 만 14세 이상
        </nav>
        <div className="rain" id="rain" aria-hidden="true" />
      </body>
    </html>
  );
}
