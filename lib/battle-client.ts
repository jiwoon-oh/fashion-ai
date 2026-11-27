"use client";

import { RUBRIC, type BattleResult } from "./rubric";
import { RESULT_EVENT, RESULT_LEAVE_EVENT, TIPS_CLOSED_EVENT, type ResultDetail } from "./survey-config";
import * as T from "./track";

// 프로토타입의 화면 동작을 거의 그대로 옮겼다.
// 바뀐 점: 채점을 브라우저의 Claude 대신 우리 서버(/api/battle)에 맡긴다.

export type Side = "p1" | "p2";
type Photo = { blob: Blob; url: string };

const ERR: Record<string, string> = {
  login_required: "오늘 10판 다 함 ㅋ 로그인하면 20판까지 됨 → 오른쪽 위에서 로그인 ㄱ",
  daily_limit: "오늘 20판 다 함 ㅋ 내일 다시 와",
  rate_limited: "AI 숨 좀 쉬자… 잠깐 뒤에 다시 START 눌러줘",
  refused: "AI가 이 사진은 채점 거부함. 다른 사진 ㄱ",
  image_rejected: "사진 파일이 이상함. 다른 사진으로 ㄱ",
  too_big: "사진이 너무 큼. 다른 사진으로 ㄱ",
  invalid_json: "AI가 말을 더듬음 ㅋ 다시 START 눌러줘",
  not_configured: "서버에 AI 키가 아직 없음 (관리자 확인 필요)",
  room_taken: "이 도전장은 이미 누가 받아버림 ㅠ 새로고침하면 결과 보임",
  room_expired: "도전장 유효기간(24시간) 끝남 ㅠ 새로 보내달라고 해",
  own_room: "내가 보낸 도전장임 ㅋ 링크를 친구한테 보내셈",
  not_found: "없는 도전장이거나 지워진 방임",
  room_failed: "도전장 만들다 삐끗함. 다시 눌러줘",
};

// ---------- 최근 한줄평 (같은 문장 30판 안에 다시 안 나오게 서버에 알려줌) ----------
const RECENT_KEY = "ootd-recent-roasts";
const RECENT_MAX = 30;
function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(-RECENT_MAX) : [];
  } catch {
    return [];
  }
}
function pushRecent(roast: string) {
  if (!roast) return;
  const list = readRecent().filter((x) => x !== roast);
  list.push(roast);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(-RECENT_MAX))); } catch { /* 저장 못 해도 괜찮음 */ }
}

// ---------- 링크 대결방: 방장 토큰은 이 브라우저에만 ----------
const roomTokenKey = (code: string) => "ootd-room:" + code;
export function saveRoomToken(code: string, token: string) {
  try { localStorage.setItem(roomTokenKey(code), token); } catch { /* 무시 */ }
}
function readRoomToken(code: string) {
  try { return localStorage.getItem(roomTokenKey(code)); } catch { return null; }
}

/** 공유 카드는 "나" 기준이라 2P로 붙은 사람은 좌우를 바꿔서 넘긴다 */
export function asMine(r: BattleResult, me: Side): BattleResult {
  if (me === "p1") return r;
  const flip = (s: Side): Side => (s === "p1" ? "p2" : "p1");
  return { ...r, p1: r.p2, p2: r.p1, winner: flip(r.winner), loser: flip(r.loser), cachedSides: { p1: r.cachedSides.p2, p2: r.cachedSides.p1 } };
}

export type ShareLink = { url: string; image: string };
export type RoomInfo = { code: string; role: "host" | "guest" | "viewer"; status: "waiting" | "done" | "expired" | "missing"; hostName: string; guestName: string | null };
type RoomView = { status: "waiting" | "done" | "expired"; role: "host" | "guest" | "viewer"; hostName: string; guestName: string | null; expiresAt?: string; result: BattleResult | null };
const ROOM_TTL_MS = 24 * 3600_000; // 서버 lib/rooms.ts 의 유효시간과 같게

type InitOpts = {
  loggedIn: boolean;
  /**
   * 결과 공유: 결과는 "나"가 1P인 모양으로, 사진은 내 사진.
   * link = 이 대결을 그대로 다시 보여 주는 공유 링크(/r/<코드>)와 미리보기 그림 주소. 만들기 실패하면 null
   */
  onShare: (result: BattleResult, myPhoto: Blob | null, link: ShareLink | null) => void;
  /** 링크 대결방 화면이면 방 코드 */
  room?: string;
  /** 대결방 상태가 바뀔 때 (도전장 다시 보내기 버튼 등) */
  onRoom?: (info: RoomInfo) => void;
};

export function initBattle({ loggedIn, onShare, room, onRoom }: InitOpts): () => void {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const off = new AbortController();
  const on = <K extends keyof HTMLElementEventMap>(el: EventTarget, ev: K | string, fn: (e: Event) => void) =>
    el.addEventListener(ev, fn, { signal: off.signal });

  let shareCode: string | null = null; // 이 결과로 만든 공유 링크 코드 (다시 눌러도 같은 링크)
  const S: { p1: Photo | null; p2: Photo | null; ctl: AbortController | null; result: BattleResult | null; sound: boolean; running: boolean } = {
    p1: null, p2: null, ctl: null, result: null, sound: true, running: false,
  };
  // 링크 대결방 상태 (일반 배틀이면 role 은 null)
  let role: RoomInfo["role"] | null = null;
  let poll: ReturnType<typeof setInterval> | undefined;
  const token = room ? readRoomToken(room) : null;
  const roomHeaders = (): HeadersInit => (token ? { "x-room-token": token } : {});
  const mySide = (): Side => (role === "guest" ? "p2" : "p1");

  // ---------- 로그 (docs/log-design-otbbal.md) ----------
  type Method = "camera" | "album" | "slot_tap" | "drop" | "paste";
  const mode = () => !room ? "local" : role === "guest" ? "challenge_guest" : role === "host" ? "challenge_host" : role === "viewer" ? "challenge_viewer" : "challenge";
  let readyAt = 0; // 두 장(대결방 게스트는 내 사진 한 장)이 다 준비된 시각
  const secSince = (t: number) => (t ? Math.round((Date.now() - t) / 1000) : null);
  function logPlay(r: BattleResult, isAgain: boolean) {
    const me = mySide();
    const sc = (side: Side) => ({ color: r[side].color, fit: r[side].fit, harmony: r[side].harmony, trend: r[side].trend });
    T.play({
      mode: mode(), is_again: isAgain,
      p1_total: r.p1.total, p2_total: r.p2.total, diff: Math.abs(r.p1.total - r.p2.total),
      winner: r.winner, tie: r.p1.total === r.p2.total, me_won: r.winner === me,
      scores: { p1: sc("p1"), p2: sc("p2") },
      roast_style: r.roastStyle ?? null, mock: r.mock,
      same_mood: !!r.p1.mood && r.p1.mood === r.p2.mood, narrowed: r.rawDiff != null, raw_diff: r.rawDiff ?? null,
    });
  }
  function logScore(t0: number, ok: boolean, error: string | null, mock?: boolean) {
    T.track("score_done", { mode: mode(), ok, wait_ms: Date.now() - t0, error, mock: mock ?? null }, 4);
  }
  function logFail(code: string | undefined, context: string) {
    if (code === "login_required") T.loginPrompt(context);
  }

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

  async function setPhoto(side: Side, file: File, method: Method) {
    if (room && !(role === "guest" && side === "p2" && !S.result)) return; // 대결방에서는 2P(나)만 올림
    const base = { side, method, replace: !!S[side], sec_since_visit: T.secSinceVisit(), mode: mode() };
    if (!file || (file.type && !file.type.startsWith("image/"))) {
      T.track("photo_upload", { ...base, ok: false, fail: "not_image" });
      setStatus("이건 사진 파일이 아님 ㅋ 다른 거 ㄱ", "small"); return;
    }
    setStatus("사진 읽는 중…", "small");
    const blob = await prepImage(file);
    if (off.signal.aborted) return;
    if (!blob) {
      T.track("photo_upload", { ...base, ok: false, fail: "decode" });
      setStatus("이 사진 형식은 못 읽음 ㅠ 스크린샷 찍어서 그걸 올려줘", "small"); return;
    }
    T.track("photo_upload", { ...base, ok: true, fail: null });
    T.stage(2);
    if (room || (side === "p1" ? S.p2 : S.p1)) { T.stage(3); readyAt = Date.now(); }
    const old = S[side];
    if (old) URL.revokeObjectURL(old.url);
    const url = URL.createObjectURL(blob);
    S[side] = { blob, url };
    const img = document.createElement("img");
    img.src = url; img.alt = (side === "p1" ? "1P" : "2P") + " 코디 사진";
    $("media-" + side).replaceChildren(img);
    blip();
    clearResult();
    if (room) setStatus("준비 완료! START 누르면 1P 코디도 공개됨");
    else if (S.p1 && S.p2) setStatus("준비 완료! 가운데 START 눌러");
    else setStatus((S.p1 ? "2P" : "1P") + " 사진 기다리는 중… 빨리 내놔");
  }

  document.querySelectorAll<HTMLInputElement>("input.file-overlay").forEach((inp) => {
    on(inp, "click", () => { audio(); });
    on(inp, "change", () => {
      const f = inp.files && inp.files[0];
      const method: Method = inp.hasAttribute("capture") ? "camera" : inp.closest(".btnrow") ? "album" : "slot_tap";
      if (f) setPhoto(inp.dataset.side as Side, f, method);
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
      if (f) setPhoto(side, f, "drop");
    });
  });
  on(document, "paste", (e) => {
    const item = [...((e as ClipboardEvent).clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    const f = item?.getAsFile();
    if (f) setPhoto(room ? "p2" : !S.p1 ? "p1" : "p2", f, "paste");
  });

  // ---------- 화면 상태 ----------
  function setStatus(text: string, mode?: string) {
    const el = $("status");
    el.textContent = text;
    el.className = "status" + (mode ? " " + mode : "");
    el.hidden = !text;
  }
  function setStart() {
    const b = $("btn-start") as HTMLButtonElement;
    const both = !!(S.p1 && S.p2);
    b.classList.remove("ready", "busy");
    if (room) {
      const can = role === "guest" && !!S.p2 && !S.result && !S.running;
      const again = !!S.result && !S.running; // 끝난 대결: AGAIN = 한줄평만 다시 뽑기
      b.disabled = !(can || again);
      b.textContent = S.running ? "···" : again ? "AGAIN" : can ? "START" : role === "host" ? "⏳" : "VS";
      if (can || again) b.classList.add("ready");
      if (S.running) b.classList.add("busy");
      return;
    }
    if (S.running) { b.disabled = true; b.textContent = "···"; b.classList.add("busy"); }
    else if (both) { b.disabled = false; b.textContent = S.result ? "AGAIN" : "START"; b.classList.add("ready"); }
    else { b.disabled = true; b.textContent = "VS"; }
  }
  function clearResult() {
    S.ctl?.abort();
    S.ctl = null; S.result = null; shareCode = null;
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
    $("btn-share").hidden = true;
    $("tips").hidden = true;
    $("btn-tips").hidden = true;
    tipsAt = 0;
    window.dispatchEvent(new Event(RESULT_LEAVE_EVENT)); // 설문: 이번 결과에서는 안 띄움
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
    if (room) return joinRoom();
    if (!S.p1 || !S.p2) return;
    const isAgain = !!S.result;
    clearResult();
    T.track("battle_start", { mode: mode(), is_again: isAgain, sec_since_ready: secSince(readyAt) }, 4);
    T.stage(4);
    const t0 = Date.now();
    const ctl = new AbortController();
    S.ctl = ctl;
    S.running = true;
    setStart();
    setStatus("AI가 기준표 들고 째려보는 중", "judging");

    const fd = new FormData();
    fd.append("p1", S.p1.blob, "p1.jpg");
    fd.append("p2", S.p2.blob, "p2.jpg");
    fd.append("recent", JSON.stringify(readRecent()));
    let r: BattleResult;
    try {
      const res = await fetch("/api/battle", { method: "POST", body: fd, signal: ctl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw { code: data?.error };
      r = data as BattleResult;
    } catch (e) {
      if (ctl !== S.ctl || (e instanceof DOMException && e.name === "AbortError")) return;
      const code = (e as { code?: string })?.code;
      logScore(t0, false, code || "network");
      logFail(code, "battle");
      setStatus((code && ERR[code]) || "채점하다 서버가 삐끗함. 다시 START 눌러줘", "small");
      S.running = false; setStart();
      return;
    }
    logScore(t0, true, null, r.mock);
    if (ctl !== S.ctl) return;
    await tension(800, ctl);
    if (ctl !== S.ctl) return;
    reveal(r);
    logPlay(r, isAgain);
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
    // 승패 문구 배너는 없앰(사용자 요청 2026-11-26). 랭킹 안내만 작게 남기고, 없으면 배너 자체를 숨김
    const rankNote = role === "viewer" ? "끝난 대결 · AGAIN 누르면 한줄평만 새로 뽑음 · 나도 하려면 아래 🏠 새 판"
      : r.recorded ? "기록됨 · 🏆랭킹에서 등록하면 주간 랭킹에 뜸" : r.mock && loggedIn ? "가짜 점수라 랭킹엔 안 올라감" : loggedIn ? "" : "로그인하고 랭킹 등록하면 올라감";
    setStatus(rankNote, "small");
    $("roast-label").textContent = "AI 한줄평 ▶ " + (room ? sideName(r.loser) : L) + "에게";
    if (role !== "viewer") pushRecent(r.roast);
    roast.classList.add("to-" + r.loser);
    const praise = r[r.winner].praise;
    $("praise").textContent = praise ? "(" + (room ? sideName(r.winner) : W) + "한테는) " + praise : "";
    const mark = document.createElement("mark");
    mark.textContent = r.roast;
    $("roast-text").replaceChildren(mark);
    roast.hidden = false;
    $("btn-copy").hidden = false;
    $("btn-share").hidden = false;
    showTips(r, true);
    // 설문 카드(components/SurveyCard.tsx)에 "결과 하나 뜸" 알림. 구경만(viewer) · 가짜 채점은 설문 쪽에서 거른다
    window.dispatchEvent(new CustomEvent<ResultDetail>(RESULT_EVENT, { detail: { mode: mode(), mock: !!r.mock, viewer: role === "viewer" } }));
    S.running = false; setStart();
    confetti(r.winner);
    fanfare(); sadTrombone();
  }

  // ---------- 점수 올리는 법 (기준표) ----------
  // 결과가 뜨면 바로 보여 주고, 닫으면 아래 "📏 점수 올리는 법" 버튼으로 다시 연다.
  // 진 쪽(대결방에서는 나) 기준으로, 항목마다 "지금 몇 점 → 다음 단계 점수 받으려면" 을 보여 준다.
  let tipsAt = 0; // 기준표를 연 시각 (닫을 때 몇 초 봤는지 로그)
  const tipsSide = (r: BattleResult): Side => (room && role !== "viewer" ? mySide() : r.loser);
  function tipsLog(action: string, r: BattleResult, extra: Record<string, unknown> = {}) {
    const side = tipsSide(r), p = r[side];
    const weakest = RUBRIC.reduce((m, c) => (p[c.key] < p[m.key] ? c : m), RUBRIC[0]).key;
    T.track("score_guide", { action, side, lost: side === r.loser, total: p.total, weakest, mode: mode(), ...extra });
  }
  function showTips(r: BattleResult, auto: boolean) {
    const side = tipsSide(r), p = r[side];
    const who = room ? (side === mySide() ? "나" : sideName(side)) : side === "p1" ? "1P" : "2P";
    const el = (tag: string, cls = "", text = "") => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    };
    const body = $("tips-body");
    body.replaceChildren();
    body.append(el("p", "tips-lead", `${who} 지금 ${p.total}점 · 낮은 항목부터 한 단계씩 올리면 점수 오름`));

    const list = el("ol", "tips-list");
    [...RUBRIC].sort((a, b) => p[a.key] - p[b.key]).forEach((c, i) => {
      const now = p[c.key];
      const next = [...c.anchors].sort((a, b) => a[0] - b[0]).find(([pt]) => pt > now);
      const li = el("li", i === 0 ? "weak" : "");
      li.append(el("b", "", `${c.label} ${now}/25`));
      li.append(el("span", "", next ? ` → ${next[0]}점: ${next[1]}` : " → 이미 만점 👑"));
      list.append(li);
    });
    body.append(list);

    const more = el("details", "tips-more") as HTMLDetailsElement;
    more.append(el("summary", "", "전체 채점 기준표 보기"));
    RUBRIC.forEach((c) => {
      const box = el("div", "tips-rubric");
      box.append(el("b", "", `${c.label} (${c.name}) 25점`));
      const ul = el("ul");
      c.anchors.forEach(([pt, d]) => ul.append(el("li", "", `${pt}점 = ${d}`)));
      box.append(ul);
      more.append(box);
    });
    on(more, "toggle", () => { if (more.open) tipsLog("expand", r); });
    body.append(more);

    $("tips").hidden = false;
    $("btn-tips").hidden = true;
    tipsAt = Date.now();
    tipsLog(auto ? "show" : "reopen", r, { auto });
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


  // ---------- 링크 대결 ----------
  let names = { p1: "1P", p2: "2P" };
  function sideName(side: Side) {
    return names[side];
  }
  function showBlob(side: Side, blob: Blob) {
    const old = S[side];
    if (old) URL.revokeObjectURL(old.url);
    const url = URL.createObjectURL(blob);
    S[side] = { blob, url };
    const img = document.createElement("img");
    img.src = url; img.alt = sideName(side) + " 코디 사진";
    $("media-" + side).replaceChildren(img);
  }
  function showNote(side: Side, big: string, small: string) {
    const box = document.createElement("div"); box.className = "placeholder";
    const b = document.createElement("b"); b.textContent = big;
    const sm = document.createElement("small"); sm.textContent = small;
    box.append(b, sm);
    $("media-" + side).replaceChildren(box);
  }
  function lockSide(side: Side, locked: boolean) {
    document.querySelectorAll<HTMLInputElement>(`input.file-overlay[data-side=${side}]`).forEach((i) => { i.disabled = locked; });
    const row = document.getElementById("btns-" + side);
    if (row) row.hidden = locked;
  }
  async function fetchPhoto(side: Side): Promise<Blob | null> {
    try {
      const res = await fetch(`/api/rooms/${room}/photo?side=${side}`, { headers: roomHeaders(), cache: "no-store" });
      return res.ok ? await res.blob() : null;
    } catch {
      return null;
    }
  }
  function applyRoom(v: RoomView | null) {
    if (!room) return;
    if (!v) {
      role = "viewer";
      lockSide("p1", true); lockSide("p2", true);
      showNote("p1", "😵", "없는 도전장이거나 지워짐");
      showNote("p2", "😵", "새 판에서 다시 도전장 보내줘");
      setStatus(ERR.not_found, "small");
      onRoom?.({ code: room, role: "viewer", status: "missing", hostName: "", guestName: null });
      setStart();
      return;
    }
    role = v.role;
    names = { p1: v.hostName || "1P", p2: v.guestName || (v.role === "guest" ? "나" : "2P") };
    $("title-p1").textContent = `1P_${names.p1}.jpg - 그림판`;
    $("title-p2").textContent = `2P_${names.p2}.jpg - 그림판`;
    lockSide("p1", true);
    lockSide("p2", !(v.role === "guest" && v.status === "waiting"));
    onRoom?.({ code: room, role: v.role, status: v.status, hostName: v.hostName, guestName: v.guestName });
  }

  async function loadRoom() {
    if (!room) return;
    setStatus("도전장 여는 중…", "small");
    let v: RoomView | null = null;
    try {
      const res = await fetch(`/api/rooms/${room}`, { headers: roomHeaders(), cache: "no-store" });
      if (res.ok) v = await res.json();
    } catch { /* 아래에서 안내 */ }
    if (off.signal.aborted) return;
    applyRoom(v);
    T.track("room_open", { room, role: v?.role ?? null, status: v?.status ?? "not_found", mode: mode() });
    if (!v) return;
    if (v.status === "done" && v.result) {
      const [a, b] = await Promise.all([fetchPhoto("p1"), fetchPhoto("p2")]);
      if (a) showBlob("p1", a); else showNote("p1", "1P", "사진은 지워짐");
      if (b) showBlob("p2", b); else showNote("p2", "2P", "사진은 지워짐");
      reveal(v.result);
      return;
    }
    if (v.status === "expired") {
      showNote("p1", "⌛", "도전장 유효기간 끝남");
      showNote("p2", "⌛", "새로 보내달라고 해");
      setStatus(ERR.room_expired, "small");
      setStart();
      return;
    }
    if (v.role === "host") {
      const a = await fetchPhoto("p1");
      if (a) showBlob("p1", a);
      showNote("p2", "⏳", "친구가 링크 열고 사진 올리면 여기서 바로 결과 뜸");
      setStatus("도전장 보냄! 2P가 자기 폰에서 사진 올리면 이 화면에 결과 뜸 (24시간 유효)");
      startPolling();
    } else {
      showNote("p1", "🔒", `${names.p1} 님 코디는 START 누르면 공개`);
      setStatus(`${names.p1} 님이 옷빨 배틀 신청함! 2P 칸에 내 코디 올리고 START`);
    }
    setStart();
  }

  // 방장 폰: 2P가 붙었는지 몇 초마다 확인
  function startPolling() {
    if (poll) return;
    let busy = false;
    const check = async () => {
      if (busy || S.result || document.hidden) return;
      busy = true;
      try {
        const res = await fetch(`/api/rooms/${room}`, { headers: roomHeaders(), cache: "no-store" });
        const v: RoomView | null = res.ok ? await res.json() : null;
        if (v?.status === "done" && v.result && !S.result) {
          clearInterval(poll); poll = undefined;
          applyRoom(v);
          const b = await fetchPhoto("p2");
          if (b) showBlob("p2", b);
          const ctl = new AbortController();
          S.ctl = ctl; S.running = true; setStart();
          await tension(800, ctl);
          if (ctl === S.ctl) {
            reveal(v.result);
            const created = v.expiresAt ? new Date(v.expiresAt).getTime() - ROOM_TTL_MS : 0;
            T.track("room_result", { room, min_since_create: created ? Math.round((Date.now() - created) / 60000) : null, mode: mode() });
            logPlay(v.result, false);
          }
        } else if (v?.status === "expired") {
          clearInterval(poll); poll = undefined;
          setStatus(ERR.room_expired, "small");
        }
      } catch { /* 다음에 다시 */ }
      busy = false;
    };
    poll = setInterval(check, 2500);
    on(document, "visibilitychange", () => { if (!document.hidden) check(); });
  }

  // 2P 폰: 내 사진 보내고 결과 받기
  async function joinRoom() {
    if (!S.p2 || S.result || S.running) return;
    T.track("battle_start", { mode: mode(), is_again: false, sec_since_ready: secSince(readyAt) }, 4);
    T.stage(4);
    const t0 = Date.now();
    const ctl = new AbortController();
    S.ctl = ctl; S.running = true; setStart();
    setStatus("AI가 기준표 들고 째려보는 중", "judging");
    const fd = new FormData();
    fd.append("p2", S.p2.blob, "p2.jpg");
    fd.append("recent", JSON.stringify(readRecent()));
    let v: RoomView;
    try {
      const res = await fetch(`/api/rooms/${room}`, { method: "POST", body: fd, headers: roomHeaders(), signal: ctl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw { code: data?.error };
      v = data as RoomView;
    } catch (e) {
      if (ctl !== S.ctl || (e instanceof DOMException && e.name === "AbortError")) return;
      const code = (e as { code?: string })?.code;
      logScore(t0, false, code || "network");
      logFail(code, "room_join");
      S.running = false;
      if (code === "room_taken") { loadRoom(); return; }
      setStatus((code && ERR[code]) || "채점하다 서버가 삐끗함. 다시 START 눌러줘", "small");
      setStart();
      return;
    }
    logScore(t0, true, null, v.result?.mock);
    if (ctl !== S.ctl || !v.result) return;
    applyRoom(v);
    const a = await fetchPhoto("p1");
    if (a) showBlob("p1", a);
    await tension(800, ctl);
    if (ctl !== S.ctl) return;
    reveal(v.result);
    logPlay(v.result, false);
  }

  // 메인 화면: 1P 사진으로 도전장(링크 대결방) 만들기 → 대결방 화면으로 이동
  async function makeChallenge() {
    if (!S.p1) { setStatus("1P 칸에 내 코디 먼저 올리고 도전장 보내기 눌러", "small"); return; }
    const btn = document.getElementById("btn-challenge") as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    setStatus("내 코디 먼저 채점해 두는 중… (2P는 자기 폰에서 붙음)", "judging");
    const fd = new FormData();
    fd.append("p1", S.p1.blob, "p1.jpg");
    const t0 = Date.now();
    try {
      const res = await fetch("/api/rooms", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.code) throw { code: data?.error || "room_failed" };
      saveRoomToken(data.code, data.token);
      T.track("room_create", { ok: true, room: data.code, wait_ms: Date.now() - t0, error: null }, 3);
      T.stage(3);
      T.flush(true); // 바로 다른 화면으로 넘어가니 지금 보낸다
      window.location.href = `/r/${data.code}?new=1`;
    } catch (e) {
      const code = (e as { code?: string })?.code;
      T.track("room_create", { ok: false, wait_ms: Date.now() - t0, error: code || "network" }, 3);
      logFail(code, "room_create");
      setStatus((code && ERR[code]) || ERR.room_failed, "small");
      if (btn) btn.disabled = false;
    }
  }

  // ---------- 버튼 ----------
  const challengeBtn = document.getElementById("btn-challenge");
  if (challengeBtn) on(challengeBtn, "click", () => { audio(); makeChallenge(); });
  on($("btn-start"), "click", () => {
    audio();
    if (room && S.result) { rerollRoast(); return; }
    if (!room && S.result && !S.running) { T.track("replay", { button: "again", mode: mode() }, 6); T.stage(6); }
    startBattle();
  });

  // 끝난 대결방(공유 링크·도전장)에서 AGAIN: 점수·승패는 그대로, 한줄평만 새로 받아 바꾼다 (방에는 저장 안 함)
  async function rerollRoast() {
    if (!room || !S.result || S.running) return;
    S.running = true; setStart();
    setStatus("한줄평 다시 뽑는 중…", "judging");
    T.track("replay", { button: "again_roast", mode: mode() }, 6);
    try {
      const res = await fetch(`/api/rooms/${room}/again`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recent: readRecent() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.roast) throw { code: data?.error };
      S.result = { ...S.result, roast: data.roast, roastStyle: data.roastStyle };
      const mark = document.createElement("mark");
      mark.textContent = data.roast;
      $("roast-text").replaceChildren(mark);
      const box = $("roast"); box.classList.remove("rerolled"); void box.offsetWidth; box.classList.add("rerolled");
      pushRecent(data.roast);
      setStatus("한줄평 새로 뽑음 ㅋ 점수는 그대로", "small");
      blip();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      setStatus(code === "reroll_limit" ? "이 대결은 한줄평 다시 뽑기를 너무 많이 함 ㅋ 새 판 ㄱ" : code === "room_expired" ? "공유 기간이 끝난 대결임" : "다시 뽑다 삐끗함. 한 번 더 눌러줘", "small");
    }
    S.running = false; setStart();
  }
  on($("tips-close"), "click", () => {
    $("tips").hidden = true;
    if (S.result) {
      tipsLog("close", S.result, { sec_open: tipsAt ? Math.round((Date.now() - tipsAt) / 1000) : null });
      $("btn-tips").hidden = false;
      window.dispatchEvent(new Event(TIPS_CLOSED_EVENT)); // 설문: 닫고 1.5초 뒤에 뜰 수 있음
    }
    tipsAt = 0;
  });
  on($("btn-tips"), "click", () => { if (S.result) showTips(S.result, false); });
  on($("btn-reset"), "click", () => {
    T.track("replay", { button: room ? "room_home" : "new_round", mode: mode(), after_result: !!S.result }, 6);
    if (S.result) T.stage(6);
    if (room) { T.flush(true); window.location.href = "/"; return; }
    readyAt = 0;
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
  on($("btn-share"), "click", async () => {
    window.dispatchEvent(new Event(RESULT_LEAVE_EVENT));
    const r = S.result;
    if (!r) return;
    // 공유 링크: 대결방이면 그 방 링크, 한 폰 배틀이면 두 사진·결과를 저장해서 링크를 새로 만든다 (한 결과에 한 번)
    let code = room ?? shareCode;
    if (!code && S.p1 && S.p2) {
      const btn = $("btn-share") as HTMLButtonElement;
      const label = btn.textContent;
      btn.disabled = true; btn.textContent = "🔗 링크 만드는 중…";
      try {
        const fd = new FormData();
        fd.append("p1", S.p1.blob, "p1.jpg");
        fd.append("p2", S.p2.blob, "p2.jpg");
        fd.append("roast", r.roast);
        if (r.roastStyle) fd.append("roastStyle", r.roastStyle);
        const res = await fetch("/api/share", { method: "POST", body: fd });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.code && S.result === r) code = shareCode = data.code;
        else setStatus(`공유 링크를 못 만들어서 홈 링크로 공유함 (${data?.error || res.status})`, "small");
      } catch {
        setStatus("공유 링크를 못 만들어서 홈 링크로 공유함 (network)", "small");
      }
      btn.disabled = false; btn.textContent = label;
    }
    const link = code ? { url: `${location.origin}/r/${code}`, image: `${location.origin}/r/${code}/og` } : null;
    onShare(asMine(r, mySide()), S[mySide()]?.blob ?? null, link);
  });
  on($("btn-copy"), "click", async () => {
    const r = S.result; if (!r) return;
    T.track("share", { channel: "copy_roast", context: "result", roast_style: r.roastStyle ?? null, me_won: r.winner === mySide(), mode: mode() }, 6);
    T.stage(6);
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
    T.track("setting_change", { key: "sound", value: S.sound });
    if (S.sound) blip();
  });

  T.stage(1);
  if (room) loadRoom();

  return () => {
    if (poll) clearInterval(poll);
    off.abort();
    S.ctl?.abort();
    (["p1", "p2"] as const).forEach((side) => { const ph = S[side]; if (ph) URL.revokeObjectURL(ph.url); });
    document.body.classList.remove("tension");
    ac?.close().catch(() => {});
  };
}
