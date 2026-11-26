"use client";

import type { BattleResult } from "./rubric";

// 인스타·페북 스토리용 세로 카드 (1080×1920)
const W = 1080, H = 1920;
const C = { hot: "#ff2bd6", ink: "#1a0033", lime: "#b6ff00", yellow: "#fff200", paper: "#ffffff", a: "#fff6a8", b: "#ffd6f5", red: "#ff1a1a", gray: "#c0c0c0" };
const DISPLAY = '"Black Han Sans", "Jua", "Malgun Gothic", sans-serif';
const BODY = '"Jua", "Malgun Gothic", sans-serif';

export type CardInput =
  | { kind: "invite"; url: string; inviter?: string | null }
  | { kind: "result"; url: string; result: BattleResult; photo?: Blob | null };

async function fontsReady() {
  try {
    await Promise.all([
      document.fonts.load(`120px ${DISPLAY}`, "옷빨배틀점"),
      document.fonts.load(`60px ${BODY}`, "옷빨배틀점"),
    ]);
  } catch { /* 글꼴 못 불러와도 기본 글꼴로 그림 */ }
}

function background(g: CanvasRenderingContext2D) {
  g.fillStyle = C.b; g.fillRect(0, 0, W, H);
  g.fillStyle = C.a;
  for (let y = 0; y < H / 120; y++) for (let x = 0; x < W / 120; x++) if ((x + y) % 2 === 0) g.fillRect(x * 120, y * 120, 120, 120);
  g.fillStyle = "rgba(255,138,226,.55)";
  for (let y = 30; y < H; y += 60) for (let x = 30; x < W; x += 60) { g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.fill(); }
}

function wordart(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, rot = -0.07) {
  g.save();
  g.translate(cx, cy); g.rotate(rot);
  g.font = `${size}px ${DISPLAY}`; g.textAlign = "center"; g.textBaseline = "middle";
  const w = g.measureText(text).width;
  const grad = g.createLinearGradient(-w / 2, 0, w / 2, 0);
  ["#ff0000", "#ff9900", C.yellow, C.lime, "#00e5ff", "#7a5cff", C.hot].forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), c));
  g.lineJoin = "round";
  g.fillStyle = C.ink; g.fillText(text, 12, 12);
  g.strokeStyle = C.ink; g.lineWidth = size * 0.12; g.strokeText(text, 0, 0);
  g.fillStyle = grad; g.fillText(text, 0, 0);
  g.restore();
}

function box(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string, shadow = C.ink, r = 0) {
  g.fillStyle = shadow; roundRect(g, x + 14, y + 14, w, h, r); g.fill();
  g.fillStyle = fill; roundRect(g, x, y, w, h, r); g.fill();
  g.lineWidth = 8; g.strokeStyle = C.ink; roundRect(g, x, y, w, h, r); g.stroke();
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const ch of [...text]) {
    const test = line + ch;
    if (g.measureText(test).width > maxW && line) { lines.push(line); line = ch.trimStart(); }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function centerText(g: CanvasRenderingContext2D, text: string, cx: number, y: number, font: string, color: string, maxW: number, lineH: number) {
  g.font = font; g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "top";
  const lines = wrap(g, text, maxW).slice(0, 4);
  lines.forEach((l, i) => g.fillText(l, cx, y + i * lineH));
  return lines.length * lineH;
}

function urlBar(g: CanvasRenderingContext2D, url: string, y: number) {
  const host = url.replace(/^https?:\/\//, "").replace(/\/$/, "").split("?")[0];
  box(g, 120, y, W - 240, 120, C.paper, C.hot);
  g.font = `52px ${BODY}`; g.fillStyle = C.ink; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("🔗 " + host, W / 2, y + 62);
}

async function loadImage(blob: Blob): Promise<HTMLImageElement | null> {
  const u = URL.createObjectURL(blob);
  try {
    const im = new Image();
    im.src = u;
    await im.decode();
    return im;
  } catch {
    return null;
  } finally {
    setTimeout(() => URL.revokeObjectURL(u), 1000);
  }
}

export async function makeShareCard(input: CardInput): Promise<Blob> {
  await fontsReady();
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  background(g);
  wordart(g, "옷빨 배틀", W / 2, 190, 190);

  if (input.kind === "invite") {
    box(g, 110, 420, W - 220, 760, C.paper, C.hot, 40);
    centerText(g, input.inviter ? `${input.inviter} 님이` : "너한테", W / 2, 490, `64px ${BODY}`, C.hot, W - 320, 80);
    centerText(g, "옷빨 배틀 신청함", W / 2, 580, `110px ${DISPLAY}`, C.ink, W - 300, 130);
    centerText(g, "코디 사진 올리면 AI가 100점 만점으로 채점하고 진 쪽을 킹받게 긁어줌 ㅋㅋ", W / 2, 760, `56px ${BODY}`, C.ink, W - 340, 74);
    centerText(g, "👑 vs 💀", W / 2, 1010, `120px ${BODY}`, C.ink, W, 130);
    box(g, 200, 1300, W - 400, 170, C.lime, C.ink, 0);
    centerText(g, "나랑 붙자 ㄱㄱ", W / 2, 1340, `96px ${DISPLAY}`, C.ink, W - 440, 110);
    urlBar(g, input.url, 1620);
  } else {
    const r = input.result;
    const me = r.p1, other = r.p2;
    const won = r.winner === "p1";
    const photo = input.photo ? await loadImage(input.photo) : null;
    // 내 사진 (그림판 창)
    const fx = 170, fy = 380, fw = W - 340, fh = 900;
    box(g, fx, fy, fw, fh, C.gray, C.ink, 0);
    g.fillStyle = "#000080"; g.fillRect(fx + 8, fy + 8, fw - 16, 64);
    g.font = `40px ${BODY}`; g.fillStyle = C.paper; g.textAlign = "left"; g.textBaseline = "middle";
    g.fillText("1P_내코디.jpg - 그림판", fx + 28, fy + 42);
    const ix = fx + 24, iy = fy + 90, iw = fw - 48, ih = fh - 114;
    g.fillStyle = C.paper; g.fillRect(ix, iy, iw, ih);
    if (photo) {
      const k = Math.max(iw / photo.naturalWidth, ih / photo.naturalHeight);
      const dw = photo.naturalWidth * k, dh = photo.naturalHeight * k;
      g.save(); g.beginPath(); g.rect(ix, iy, iw, ih); g.clip();
      if (!won) g.filter = "grayscale(1)";
      g.drawImage(photo, ix + (iw - dw) / 2, iy + (ih - dh) / 2, dw, dh);
      g.restore();
    } else {
      centerText(g, "👕", W / 2, iy + ih / 2 - 120, `220px ${BODY}`, C.ink, iw, 240);
    }
    // 점수 도장
    g.save();
    g.translate(W / 2, iy + ih - 120);
    g.font = `200px ${DISPLAY}`; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
    g.strokeStyle = C.ink; g.lineWidth = 26; g.strokeText(`${me.total}점`, 0, 0);
    g.fillStyle = C.yellow; g.fillText(`${me.total}점`, 0, 0);
    g.restore();
    // 승패 도장
    g.save();
    g.translate(W / 2, iy + 150); g.rotate(won ? 0.08 : -0.3);
    g.font = `150px ${DISPLAY}`; g.textAlign = "center"; g.textBaseline = "middle"; g.lineJoin = "round";
    if (won) { g.strokeStyle = C.ink; g.lineWidth = 20; g.strokeText("👑 WIN!!", 0, 0); g.fillStyle = C.lime; g.fillText("👑 WIN!!", 0, 0); }
    else { g.strokeStyle = C.red; g.lineWidth = 14; g.strokeRect(-230, -95, 460, 190); g.fillStyle = C.red; g.fillText("패배", 0, 0); }
    g.restore();

    // 점수판 + 한줄평
    centerText(g, `나 ${me.total}점  vs  상대 ${other.total}점`, W / 2, 1335, `76px ${DISPLAY}`, C.ink, W - 160, 90);
    if (me.nickname) centerText(g, `별명: ${me.nickname}`, W / 2, 1430, `52px ${BODY}`, C.hot, W - 200, 64);
    const line = won ? (me.praise || "옷빨 인정") : r.roast;
    box(g, 110, 1520, W - 220, 230, C.paper, C.hot, 60);
    centerText(g, (won ? "AI: " : "AI 한줄평: ") + line, W / 2, 1560, `58px ${BODY}`, C.ink, W - 320, 72);
    urlBar(g, input.url, 1785);
  }

  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png"));
}
