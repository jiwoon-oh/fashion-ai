import { ImageResponse } from "next/og";
import type { NextRequest } from "next/server";
import { getPhoto, getRoom, isExpired } from "@/lib/rooms";
import { adminClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

// GET /r/<코드>/og → 링크 미리보기 그림 (1200×630). 끝난 대결이면 두 사진 + 점수 + WIN, 아니면 기본 그림으로.
// 카톡·X·디스코드 등이 링크를 붙여 넣을 때 이 주소를 가져간다 (app/r/[code]/page.tsx generateMetadata).

const W = 1200, H = 630;

// 한글 글꼴: 그림에 쓰는 글자만 골라 구글 폰트에서 받아 온다 (ttf). 실패하면 글자 없이 그림만
async function loadFont(text: string): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Black+Han+Sans&text=${encodeURIComponent(text)}`)).text();
    const url = css.match(/src:\s*url\(([^)]+)\)\s*format\('(?:opentype|truetype)'\)/)?.[1];
    if (!url) return null;
    const res = await fetch(url);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const db = adminClient();
  const room = await getRoom(db, code).catch(() => null);
  const r = room?.result;
  if (!room || !r || isExpired(room)) return Response.redirect(new URL("/og.png", request.url), 302);

  const [a, b] = await Promise.all([getPhoto(db, code, "p1"), getPhoto(db, code, "p2")]);
  const src = (buf: Buffer | null) => (buf ? `data:image/jpeg;base64,${buf.toString("base64")}` : null);
  const photos = { p1: src(a), p2: src(b) };
  const TAGLINE = "옷빨배틀 · AI가 코디 채점하고 진 쪽 긁어줌 ㅋㅋ";
  const label = TAGLINE + " WIN VS 점 0123456789";
  const font = await loadFont(label);
  const fam = font ? "BHS" : undefined;

  const Panel = ({ side }: { side: "p1" | "p2" }) => {
    const win = r.winner === side;
    const s = r[side];
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, position: "relative" }}>
        <div
          style={{
            display: "flex", width: 380, height: 430, borderRadius: 14, overflow: "hidden", background: "#eee",
            border: win ? "10px solid #fff200" : "10px solid #ffffff", boxShadow: "8px 8px 0 #1a0033",
            filter: win ? "none" : "grayscale(0.6)",
          }}
        >
          {photos[side]
            ? <img src={photos[side]!} width={380} height={430} style={{ objectFit: "cover", width: "100%", height: "100%" }} />
            : <div style={{ display: "flex", width: "100%", height: "100%" }} />}
        </div>
        <div
          style={{
            display: "flex", alignItems: "baseline", gap: 6, padding: "4px 22px", borderRadius: 12,
            background: win ? "#ff1aa3" : "#1a0033", color: "#fff", fontFamily: fam, fontSize: 64, lineHeight: 1.1,
          }}
        >
          {String(s.total)}
          {font ? <span style={{ fontSize: 30 }}>점</span> : null}
        </div>
        {win && (
          <div
            style={{
              position: "absolute", top: -26, left: -24, display: "flex", padding: "6px 18px", background: "#fff200",
              color: "#1a0033", border: "5px solid #1a0033", fontFamily: fam, fontSize: 44, transform: "rotate(-10deg)",
            }}
          >
            WIN
          </div>
        )}
      </div>
    );
  };

  const img = new ImageResponse(
    (
      <div
        style={{
          width: W, height: H, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "linear-gradient(135deg, #ffd6f2 0%, #fff6a8 100%)", gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 46 }}>
          <Panel side="p1" />
          <div
            style={{
              display: "flex", width: 120, height: 120, borderRadius: 60, alignItems: "center", justifyContent: "center",
              background: "#ff1aa3", color: "#fff200", border: "8px solid #1a0033", fontFamily: fam, fontSize: 50,
            }}
          >
            VS
          </div>
          <Panel side="p2" />
        </div>
        {font && (
          <div style={{ display: "flex", fontFamily: fam, fontSize: 30, color: "#1a0033", marginTop: 6 }}>
            {TAGLINE}
          </div>
        )}
      </div>
    ),
    { width: W, height: H, ...(font ? { fonts: [{ name: "BHS", data: font, style: "normal" as const, weight: 400 as const }] } : {}) },
  );
  img.headers.set("Cache-Control", "public, max-age=3600, s-maxage=86400");
  return img;
}
