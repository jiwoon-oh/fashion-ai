"use client";

import { RUBRIC, type BattleResult } from "./rubric";

// 프로토타입의 화면 동작을 거의 그대로 옮겼다.
// 바뀐 점: 채점을 브라우저의 Claude 대신 우리 서버(/api/battle)에 맡긴다.

type Side = "p1" | "p2";
type Photo = { blob: Blob; url: string };

const ERR: Record<string, string> = {
  login_required: "로그인 안 하면 하루에 몇 판만 됨 ㅠ 오른쪽 위에서 로그인 ㄱ",
  daily_limit: "오늘 채점 다 씀 ㅋ 내일 다시 와",
  rate_limited: "AI 숨 좀 쉬자… 잠깐 뒤에 다시 START 눌러줘",
  refused: "AI가 이 사진은 채점 거부함. 다른 사진 ㄱ",
  image_rejected: "사진 파일이 이상함. 다른 사진으로 ㄱ",
  too_big: "사진이 너무 큼. 다른 사진으로 ㄱ",
  invalid_json: "AI가 말을 더듬음 ㅋ 다시 START 눌러줘",
  not_configured: "서버에 AI 키가 아직 없음 (관리자 확인 필요)",
};

export function initBattle({ loggedIn }: { loggedIn: boolean }): () => void {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const off = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, ev: K | string, fn: (e: Event) => void) =>
    el.addEventListener(ev, fn, { signal: off.signal });

  const S: { p1: Photo | null; p2: Photo | null; ctl: AbortController | null; result: BattleResult | null; sound: boolean; running: boolean } = {
    p1: null, p2: null, ctl: null, result: null, sound: true, running: false,
  };

  // ---------- 소리 ----------
  let ac: AudioContext | null = null;
  function audio() {
    if (!S.sound) return null;
    try {
      if (!ac) ac = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      if (ac.state === "suspended") ac.resume();
      return ac;
    } catch {
      return null;
    }
  }
  function tone(freq: number, start: number, dur: number, type: OscillatorType = "square", vol = 0.08, slideTo?: number) {
    const a = audio(); if (!a) return;
    const t0 = a.currentTime + start;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function drumroll(ms: number) {
    let t = 0, gap = 0.07;
    while (t < ms / 1000) { tone(110 + Math.random() * 40, t, 0.05, "triangle", 0.12); t += gap; gap = Math.max(0.03, gap * 0.9); }
  }
  const fanfare = () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.18, "square", 0.07));
  const sadTrombone = () => { [392, 370, 349].forEach((f, i) => tone(f, 0.45 + i * 0.32, 0.3, "sawtooth", 0.05)); tone(330, 1.41, 0.8, "sawtooth", 0.05, 300); };
  const blip = () => tone(880, 0, 0.06, "square", 0.05);

  // ---------- 사진 받기: 1024px JPEG로 다시 그림 ----------
  function toJpeg(source: CanvasImageSource, w: number, h: number): Promise<Blob | null> {
    const max = 1024, k = Math.min(1, max / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
    c.getContext("2d")!.drawImage(source, 0, 0, c.width, c.height);
    return new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
  }
  function loadViaImg(file: File): Promise<{ im: HTMLImageElement; u: string }> {
    return new Promise((resolve, reject) => {
      const u = URL.createObjectURL(file);
      const im = new Image();
      im.onload = () => resolve({ im, u });
      im.onerror = () => { URL.revokeObjectURL(u); reject(new Error("decode")); };
      im.src = u;
    });
  }
  async function prepImage(file: File) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      const blob = await toJpeg(bmp, bmp.width, bmp.height);
      bmp.close?.();
      if (blob) return blob;
    } catch { /* 다음 방법 시도 */ }
    try {
      const { im, u } = await loadViaImg(file);
      const blob = await toJpeg(im, im.naturalWidth, im.naturalHeight);
      URL.revokeObjectURL(u);
      if (blob) return blob;
    } catch { /* 못 읽음 */ }
    return null;
  }

  async function setPhoto(side: Side, file: File) {
    if (!file || (file.type && !file.type.startsWith("image/"))) { setStatus("이건 사진 파일이 아님 ㅋ 다른 거 ㄱ", "small"); return; }
    setStatus("사진 읽는 중…", "small");
    const blob = await prepImage(file);
    if (off.signal.aborted) return;
    if (!blob) { setStatus("이 사진 형식은 못 읽음 ㅠ 스크린샷 찍어서 그걸 올려줘", "small"); return; }
    const old = S[side];
    if (old) URL.revokeObjectURL(old.url);
    const url = URL.createObjectURL(blob);
    S[side] = { blob, url };
    const img = document.createElement("img");
    img.src = url; img.alt = (side === "p1" ? "1P" : "2P") + " 코디 사진";
    $("media-" + side).replaceChildren(img);
    blip();
    clearResult();
    if (S.p1 && S.p2) setStatus("준비 완료! 가운데 START 눌러");
    else setStatus((S.p1 ? "2P" : "1P") + " 사진 기다리는 중… 빨리 내놔");
  }

  document.querySelectorAll<HTMLInputElement>("input.file-overlay").forEach((inp) => {
    on(inp, "click", () => { audio(); });
    on(inp, "change", () => {
      const f = inp.files && inp.files[0];
      if (f) setPhoto(inp.dataset.side as Side, f);
      inp.value = "";
    });
  });
  (["p1", "p2"] as const).forEach((side) => {
    const d = $("drop-" + side);
    on(d, "dragover", (e) => { e.preventDefault(); d.classList.add("dragover"); });
    on(d, "dragleave", () => d.classList.remove("dragover"));
    on(d, "drop", (e) => {
      e.preventDefault(); d.classList.remove("dragover");
      const f = (e as DragEvent).dataTransfer?.files?.[0];
      if (f) setPhoto(side, f);
    });
  });
  on(document, "paste", (e) => {
    const item = [...((e as ClipboardEvent).clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) setPhoto(!S.p1 ? "p1" : "p2", f);
  });

  // ---------- 화면 상태 ----------
  function setStatus(text: string, mode?: string) {
    const el = $("status");
    el.textContent = text;
    el.className = "status" + (mode ? " " + mode : "");
  }
  function setStart() {
    const b = $("btn-start") as HTMLButtonElement;
    const both = !!(S.p1 && S.p2);
    b.classList.remove("ready", "busy");
    if (S.running) { b.disabled = true; b.textContent = "···"; b.classList.add("busy"); }
    else if (both) { b.disabled = false; b.textContent = S.result ? "AGAIN" : "START"; b.classList.add("ready"); }
    else { b.disabled = true; b.textContent = "VS"; }
  }
  function clearResult() {
    S.ctl?.abort();
    S.ctl = null; S.result = null;
    document.body.classList.remove("tension");
    (["p1", "p2"] as const).forEach((side) => {
      const panel = $("panel-" + side);
      panel.classList.remove("is-win", "is-lose");
      panel.querySelectorAll(".score,.stamp,.pin").forEach((n) => n.remove());
      $("nick-" + side).textContent = "";
      const bars = $("bars-" + side); bars.hidden = true; bars.replaceChildren();
    });
    $("roast").hidden = true;
    $("btn-copy").hidden = true;
    S.running = false;
    setStart();
  }
  function scoreEl(side: Side) {
    const drop = $("drop-" + side);
    let el = drop.querySelector<HTMLElement>(".score");
    if (!el) { el = document.createElement("div"); el.className = "score"; drop.append(el); }
    return el;
  }

  // ---------- 채점: 서버에 두 장 보내기 ----------
  async function startBattle() {
    if (!S.p1 || !S.p2) return;
    clearResult();
    const ctl = new AbortController();
    S.ctl = ctl;
    S.running = true;
    setStart();
    setStatus("AI가 기준표 들고 째려보는 중", "judging");

    const fd = new FormData();
    fd.append("p1", S.p1.blob, "p1.jpg");
    fd.append("p2", S.p2.blob, "p2.jpg");
    let r: BattleResult;
    try {
      const res = await fetch("/api/battle", { method: "POST", body: fd, signal: ctl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw { code: data?.error };
      r = data as BattleResult;
    } catch (e) {
      if (ctl !== S.ctl || (e instanceof DOMException && e.name === "AbortError")) return;
      const code = (e as { code?: string })?.code;
      setStatus((code && ERR[code]) || "채점하다 서버가 삐끗함. 다시 START 눌러줘", "small");
      S.running = false; setStart();
      return;
    }
    if (ctl !== S.ctl) return;
    await tension(800, ctl);
    if (ctl !== S.ctl) return;
    reveal(r);
  }

  function tension(ms: number, ctl: AbortController) {
    return new Promise<void>((resolve) => {
      setStatus("두구두구두구…");
      document.body.classList.add("tension");
      drumroll(ms);
      const els = [scoreEl("p1"), scoreEl("p2")];
      const iv = setInterval(() => {
        els.forEach((el) => { el.textContent = String(Math.floor(Math.random() * 100)).padStart(2, "0"); });
      }, 45);
      setTimeout(() => {
        clearInterval(iv);
        document.body.classList.remove("tension");
        if (ctl !== S.ctl) els.forEach((el) => el.remove());
        resolve();
      }, ms);
    });
  }

  function addStamp(side: Side, cls: string, text: string) {
    const s = document.createElement("div");
    s.className = "stamp " + cls;
    s.textContent = text;
    $("drop-" + side).append(s);
  }

  function reveal(r: BattleResult) {
    S.result = r;
    (["p1", "p2"] as const).forEach((side) => {
      const p = r[side];
      const el = scoreEl(side);
      el.replaceChildren(document.createTextNode(String(p.total)), Object.assign(document.createElement("small"), { textContent: "점" }));
      el.classList.remove("slam"); void el.offsetWidth; el.classList.add("slam");
      if (r.cachedSides[side]) {
        const pin = document.createElement("div");
        pin.className = "pin"; pin.textContent = "📌 저장된 점수";
        $("drop-" + side).append(pin);
      }
      $("nick-" + side).textContent = p.nickname ? "별명: " + p.nickname : "";
      const bars = $("bars-" + side);
      bars.replaceChildren();
      RUBRIC.forEach((c) => {
        const row = document.createElement("div"); row.className = "bar";
        const l = document.createElement("span"); l.textContent = c.label;
        const tr = document.createElement("span"); tr.className = "track";
        const f = document.createElement("span"); f.className = "fill"; f.style.display = "block"; tr.append(f);
        const n = document.createElement("span"); n.className = "num"; n.textContent = p[c.key] + "/25";
        row.append(l, tr, n); bars.append(row);
        requestAnimationFrame(() => requestAnimationFrame(() => { f.style.width = (p[c.key] / 25 * 100) + "%"; }));
      });
      bars.hidden = false;
    });

    const W = r.winner === "p1" ? "1P" : "2P", L = r.loser === "p1" ? "1P" : "2P";
    const roast = $("roast");
    roast.classList.remove("to-p1", "to-p2", "to-both");
    $("panel-" + r.winner).classList.add("is-win");
    $("panel-" + r.loser).classList.add("is-lose");
    addStamp(r.winner, "crown", "👑");
    addStamp(r.winner, "win-label", "WIN!!");
    addStamp(r.loser, "lose", "패배");
    const tie = r.p1.total === r.p2.total;
    const rankNote = r.recorded ? " (랭킹 반영됨)" : loggedIn ? "" : " · 로그인하면 랭킹 올라감";
    setStatus((tie ? "동점인데 " + W + "가 세부 점수로 이김 ㅋ" : W + " 승리 ㅋㅋㅋ " + L + " 반성하셈") + rankNote);
    $("roast-label").textContent = "AI 한줄평 ▶ " + L + "에게";
    roast.classList.add("to-" + r.loser);
    const praise = r[r.winner].praise;
    $("praise").textContent = praise ? "(" + W + "한테는) " + praise : "";
    const mark = document.createElement("mark");
    mark.textContent = r.roast;
    $("roast-text").replaceChildren(mark);
    roast.hidden = false;
    $("btn-copy").hidden = false;
    S.running = false; setStart();
    confetti(r.winner);
    fanfare(); sadTrombone();
    bumpCounter();
  }

  function confetti(side: Side) {
    const rain = document.getElementById("rain");
    if (!rain || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const box = $("panel-" + side).getBoundingClientRect();
    const glyphs = ["✨", "💖", "⭐", "🔥", "💅", "👑"];
    for (let i = 0; i < 26; i++) {
      const s = document.createElement("span");
      s.textContent = glyphs[i % glyphs.length];
      s.style.left = (box.left + Math.random() * box.width) + "px";
      s.style.animationDuration = (1.4 + Math.random() * 1.4) + "s";
      s.style.animationDelay = (Math.random() * 0.5) + "s";
      rain.append(s);
      setTimeout(() => s.remove(), 3500);
    }
  }

  // ---------- 카운터 (이 브라우저 기준) ----------
  const readCount = () => { try { return Number(localStorage.getItem("ootd-battle-count")) || 0; } catch { return 0; } };
  const showCount = (n: number) => { $("counter").textContent = "TOTAL BATTLE " + String(n).padStart(3, "0"); };
  function bumpCounter() {
    const n = readCount() + 1;
    try { localStorage.setItem("ootd-battle-count", String(n)); } catch { /* 저장 못 해도 괜찮음 */ }
    showCount(n);
  }
  showCount(readCount());

  // ---------- 버튼 ----------
  on($("btn-start"), "click", () => { audio(); startBattle(); });
  on($("btn-reset"), "click", () => {
    clearResult();
    (["p1", "p2"] as const).forEach((side) => {
      const ph = S[side];
      if (ph) URL.revokeObjectURL(ph.url);
      S[side] = null;
      const box = document.createElement("div"); box.className = "placeholder";
      const b = document.createElement("b"); b.textContent = side === "p1" ? "1P" : "2P";
      box.append(b, document.createTextNode(side === "p1" ? "여기다 내 코디 사진 던지셈" : "상대 코디 사진 여기 ㄱ"));
      const sm = document.createElement("small"); sm.textContent = "탭하면 찍기·앨범 / 끌어다 놓기 OK"; box.append(sm);
      $("media-" + side).replaceChildren(box);
    });
    setStart();
    setStatus("사진 두 장 올리고 START 누르셈");
  });
  on($("btn-copy"), "click", async () => {
    const r = S.result; if (!r) return;
    const btn = $("btn-copy");
    const line = "[옷빨 배틀] 1P " + r.p1.total + "점 vs 2P " + r.p2.total + "점 — " + r.roast + " " + location.origin;
    try { await navigator.clipboard.writeText(line); btn.textContent = "✅ 복사됨"; }
    catch {
      const sel = window.getSelection(), range = document.createRange();
      range.selectNodeContents($("roast-text")); sel?.removeAllRanges(); sel?.addRange(range);
      btn.textContent = "👆 선택해둠 복사 ㄱ";
    }
    setTimeout(() => { btn.textContent = "📋 한줄평 복사"; }, 1600);
  });
  on($("btn-sound"), "click", (e) => {
    S.sound = !S.sound;
    const b = e.currentTarget as HTMLElement;
    b.textContent = S.sound ? "🔊 소리 ON" : "🔇 소리 OFF";
    b.setAttribute("aria-pressed", String(S.sound));
    if (S.sound) blip();
  });

  return () => {
    off.abort();
    S.ctl?.abort();
    (["p1", "p2"] as const).forEach((side) => { const ph = S[side]; if (ph) URL.revokeObjectURL(ph.url); });
    document.body.classList.remove("tension");
    ac?.close().catch(() => {});
  };
}
