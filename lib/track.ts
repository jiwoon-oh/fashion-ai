"use client";

import type { EventName } from "./track-events";

// 행동 로그 (docs/log-design-otbbal.md)
// - 이벤트를 모아 2초마다 /api/log 로 보낸다. 화면이 숨겨지거나 페이지를 떠날 때는 sendBeacon 으로 남은 걸 보낸다.
// - user_id(익명) · 세션 · 처음 들어온 경로는 localStorage 에 둔다. 저장이 막혀도 게임은 그대로 돌아간다.
// - 사진·사진 지문·닉네임·한줄평 원문은 절대 넣지 않는다.

const APP = "otbbal";
const SESSION_GAP_MS = 15 * 60 * 1000; // 15분 동안 이벤트 없으면 새 세션
const FLUSH_MS = 2000;
const K = {
  user: "ootd-trk-user",
  session: "ootd-trk-session",
  firstTouch: "ootd-trk-ft",
  internal: "ootd-trk-internal",
  playedEver: "ootd-trk-played",
  today: "ootd-trk-today",
  loginIntent: "ootd-trk-login",
  loginPrompt: "ootd-trk-login-prompt",
  visits: "ootd-trk-visits",
};

type Props = Record<string, unknown>;
type Session = { id: string; start: number; last: number; stages: number[]; plays: number; lastStage: number; source: string; detail: string | null };
type Row = {
  event_id: string; client_time: string; app: string; user_id: string; session_id: string; event_name: EventName;
  stage: number | null; device: string; browser: string; source: string; source_detail: string | null; is_internal: boolean; props: Props;
};

const isBrowser = typeof window !== "undefined";

// ---------- 저장소 (막혀 있으면 메모리로) ----------
const mem = new Map<string, string>();
function get(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return mem.get(key) ?? null; }
}
function set(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { mem.set(key, v); }
}
function del(key: string) {
  try { localStorage.removeItem(key); } catch { mem.delete(key); }
}
function getJson<T>(key: string): T | null {
  try { return JSON.parse(get(key) || "null") as T; } catch { return null; }
}

const uuid = (): string => {
  if (isBrowser && typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

// ---------- 기기 · 브라우저 · 유입 경로 ----------
function deviceOf(ua: string) {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? "mobile" : "pc";
}
function browserOf(ua: string) {
  if (/Barcelona/i.test(ua)) return "threads_inapp";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "facebook_inapp";
  if (/\bLine\//.test(ua)) return "line_inapp";
  if (/Instagram/i.test(ua)) return "insta_inapp";
  if (/KAKAOTALK/i.test(ua)) return "kakao_inapp";
  if (/NAVER\(inapp|NAVER/i.test(ua)) return "naver_inapp";
  if (/SamsungBrowser|Edg\/|OPR\//i.test(ua)) return "other";
  if (/CriOS|Chrome/i.test(ua)) return "chrome";
  if (/Safari/i.test(ua)) return "safari";
  return "other";
}

// twitter · community 는 돌수제비 홍보 링크(?from=)와 이름을 맞춘 값
const SRC_VALUES = ["threads", "insta", "twitter", "community", "friend", "challenge", "share", "direct", "other"];

/** 판정 규칙 (위에서부터): 도전장 주소 → via → ref → src(또는 from) → 인앱 브라우저 → referrer → direct */
function sourceOf(url: URL, ua: string, referrer: string): { source: string; detail: string | null } {
  if (/^\/r\/[^/]+/.test(url.pathname)) return { source: "challenge", detail: null };
  const via = url.searchParams.get("via");
  if (via) return { source: "share", detail: via.slice(0, 30) };
  if (url.searchParams.get("ref")) return { source: "friend", detail: null };
  const src = url.searchParams.get("src") || url.searchParams.get("from"); // from = 돌수제비식 링크도 받음
  if (src) {
    const s = src.toLowerCase();
    if (s.startsWith("share_")) return { source: "share", detail: s.slice(6, 36) || null }; // 돌수제비식 공유 링크
    return { source: SRC_VALUES.includes(s) ? s : "other", detail: (url.searchParams.get("c") || (SRC_VALUES.includes(s) ? "" : s)).slice(0, 30) || null };
  }
  const b = browserOf(ua);
  if (b === "threads_inapp") return { source: "threads", detail: "inapp" };
  if (b === "insta_inapp") return { source: "insta", detail: "inapp" };
  if (b === "kakao_inapp") return { source: "friend", detail: "kakao_inapp" };
  if (b === "facebook_inapp" || b === "line_inapp") return { source: "other", detail: b };
  if (referrer) {
    try {
      const h = new URL(referrer).hostname.replace(/^www\./, "");
      if (h !== url.hostname) {
        if (/threads\.(net|com)$/.test(h)) return { source: "threads", detail: "referrer" };
        if (/instagram\.com$/.test(h)) return { source: "insta", detail: "referrer" };
        return { source: "other", detail: h.slice(0, 40) };
      }
    } catch { /* 무시 */ }
  }
  return { source: "direct", detail: null };
}

// 첫 화면의 주소는 다른 코드가 ?ref 등을 지우기 전에 붙잡아 둔다 (모듈이 읽힐 때 = 화면 그리기 전)
const landingUrl = isBrowser ? new URL(window.location.href) : null;
const landingRef = isBrowser ? document.referrer : "";
const pageStart = isBrowser ? Date.now() : 0;

// ---------- 상태 ----------
let ctx = { loggedIn: null as boolean | null };
let queue: Row[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let started = false;

// 내 컴퓨터에서 띄운 개발 서버는 항상 팀 트래픽으로 본다 (DB 키가 있어도 실제 숫자에 안 섞이게)
const isLocalHost = isBrowser && /^(localhost|127\.0\.0\.1|\[::1\])$|\.local$/.test(window.location.hostname);

function internalFlag(): boolean {
  if (landingUrl) {
    const v = landingUrl.searchParams.get("internal") ?? landingUrl.searchParams.get("test"); // test = 돌수제비식
    if (v === "1") set(K.internal, "1");
    if (v === "0") del(K.internal);
  }
  return isLocalHost || get(K.internal) === "1";
}

/** 이 브라우저의 몇 번째 방문인지, 지난 방문 뒤 며칠 지났는지 (새 세션이 생길 때 한 번) */
function countVisit(now: number): { visit_n: number; days_since_last: number | null } {
  const v = getJson<{ n: number; last: number }>(K.visits);
  const n = (v?.n ?? 0) + 1;
  set(K.visits, JSON.stringify({ n, last: now }));
  return { visit_n: n, days_since_last: v?.last ? Math.floor((now - v.last) / 86_400_000) : null };
}

/** 직전 사이트 도메인만 (주소 전체는 안 남김) */
function refDomain(referrer: string, own: string): string | null {
  try {
    const h = new URL(referrer).hostname.replace(/^www\./, "");
    return h && h !== own ? h.slice(0, 60) : null;
  } catch {
    return null;
  }
}

function userId(): { id: string; isNew: boolean } {
  let id = get(K.user);
  if (id) return { id, isNew: false };
  id = uuid();
  set(K.user, id);
  return { id, isNew: true };
}

function saveSession(s: Session) { set(K.session, JSON.stringify(s)); }

/** 지금 세션. 15분 넘게 비었으면 새 세션을 만들고 visit 을 먼저 남긴다 */
function session(): Session {
  const now = Date.now();
  const old = getJson<Session>(K.session);
  if (old && old.id && now - old.last < SESSION_GAP_MS) {
    old.last = now;
    saveSession(old);
    return old;
  }
  const ua = navigator.userAgent;
  const url = !started && landingUrl ? landingUrl : new URL(window.location.href);
  const { source, detail } = sourceOf(url, ua, !started ? landingRef : "");
  const s: Session = { id: uuid(), start: now, last: now, stages: [], plays: 0, lastStage: 0, source, detail };
  saveSession(s);
  const u = userId();
  let ft = getJson<{ source: string; detail: string | null }>(K.firstTouch);
  if (!ft) { ft = { source, detail }; set(K.firstTouch, JSON.stringify(ft)); }
  const path = url.pathname;
  const landing = path.startsWith("/r/") ? "room" : path.startsWith("/ranking") ? "ranking" : path.startsWith("/friends") ? "friends" : path === "/" ? "home" : "other";
  push(s, "visit", null, {
    is_return: !u.isNew,
    ...countVisit(now),
    landing,
    logged_in: ctx.loggedIn,
    ref_domain: !started ? refDomain(landingRef, url.hostname) : null,
    ft_source: ft.source,
    ft_detail: ft.detail,
  });
  return s;
}

function push(s: Session, name: EventName, stage: number | null, props: Props) {
  const ua = navigator.userAgent;
  queue.push({
    event_id: uuid(),
    client_time: new Date().toISOString(),
    app: APP,
    user_id: userId().id,
    session_id: s.id,
    event_name: name,
    stage,
    device: deviceOf(ua),
    browser: browserOf(ua),
    source: s.source,
    source_detail: s.detail,
    is_internal: internalFlag(),
    props,
  });
  if (queue.length > 200) queue = queue.slice(-200);
  if (!timer) timer = setTimeout(() => flush(false), FLUSH_MS);
}

/** 모은 이벤트 보내기. beacon=true 면 페이지가 닫혀도 가게 sendBeacon */
export function flush(beacon: boolean) {
  if (!isBrowser) return;
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (!queue.length) return;
  const batch = queue.splice(0, 50);
  const body = JSON.stringify({ events: batch });
  let sent = false;
  if (beacon && navigator.sendBeacon) {
    try { sent = navigator.sendBeacon("/api/log", new Blob([body], { type: "text/plain" })); } catch { sent = false; }
  }
  if (!sent) {
    fetch("/api/log", { method: "POST", body, headers: { "Content-Type": "text/plain" }, keepalive: true })
      .then((r) => { if (r.status >= 500) queue.unshift(...batch); })
      .catch(() => { queue.unshift(...batch); });
  }
  if (queue.length) timer = setTimeout(() => flush(beacon), beacon ? 0 : FLUSH_MS);
}

// ---------- 공개 함수 ----------

/** 일반 이벤트 */
export function track(name: EventName, props: Props = {}, stage: number | null = null) {
  if (!isBrowser) return;
  try {
    const s = session();
    push(s, name, stage, props);
  } catch { /* 로그 때문에 게임이 멈추면 안 됨 */ }
}

/** 단계 도달: 세션마다 단계별로 한 번만 stage_enter */
export function stage(n: number) {
  if (!isBrowser) return;
  try {
    const s = session();
    if (n > s.lastStage) s.lastStage = n;
    if (!s.stages.includes(n)) {
      s.stages.push(n);
      push(s, "stage_enter", n, { stage: n });
    }
    saveSession(s);
  } catch { /* 무시 */ }
}

/** 페이지를 연 뒤 몇 초 지났는지 */
export const secSinceVisit = () => Math.round((Date.now() - pageStart) / 1000);

/** 플레이 1회 완료. 세션 첫 플레이면 first_play 를 먼저 남긴다. 반환값 = 세션 내 몇 번째 */
export function play(props: Props): number {
  if (!isBrowser) return 0;
  try {
    const s = session();
    s.plays += 1;
    if (s.lastStage < 5) s.lastStage = 5;
    saveSession(s);
    if (s.plays === 1) {
      const ever = get(K.playedEver) === "1";
      set(K.playedEver, "1");
      push(s, "first_play", null, { sec_since_visit: secSinceVisit(), is_first_ever: !ever, mode: props.mode });
    }
    if (!props.is_again) bumpToday();
    push(s, "play", 5, { nth: s.plays, ...props });
    if (!s.stages.includes(5)) { s.stages.push(5); saveSession(s); push(s, "stage_enter", 5, { stage: 5 }); }
    return s.plays;
  } catch {
    return 0;
  }
}

// 오늘 새 사진으로 한 판 수 (login_prompt 의 plays_today 용, 브라우저 기준)
function bumpToday() {
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const t = getJson<{ day: string; n: number }>(K.today);
  set(K.today, JSON.stringify({ day, n: t?.day === day ? t.n + 1 : 1 }));
}
export function playsToday(): number {
  const day = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
  const t = getJson<{ day: string; n: number }>(K.today);
  return t?.day === day ? t.n : 0;
}

/** 비로그인 제한 안내가 떴을 때 */
export function loginPrompt(context: string) {
  set(K.loginPrompt, String(Date.now()));
  track("login_prompt", { context, plays_today: playsToday() });
}

/** 로그인 버튼을 눌렀을 때 (구글·카카오 화면으로 나가기 직전) */
export function loginIntent(provider: string) {
  const at = Number(get(K.loginPrompt)) || 0;
  const from = Date.now() - at < 10 * 60 * 1000 ? "prompt" : "topbar";
  set(K.loginIntent, JSON.stringify({ provider, from }));
  flush(true);
}

/** 앱이 처음 뜰 때 한 번 (layout 의 Tracker). 로그인 상태 · 로그인 완료 · 화면 떠남을 챙긴다 */
export function startTracking(opts: { loggedIn: boolean }) {
  if (!isBrowser || started) { ctx = { loggedIn: opts.loggedIn }; return; }
  ctx = { loggedIn: opts.loggedIn };
  session(); // 새 세션이면 여기서 visit
  started = true;

  const intent = getJson<{ provider: string; from: string }>(K.loginIntent);
  if (intent && opts.loggedIn) {
    del(K.loginIntent);
    track("login", { provider: intent.provider, from: intent.from });
  }

  // 홍보용 표시(src·from·c·via·internal·test)는 주소창에서 지운다 (사람들이 주소를 복사해 퍼뜨려도 경로가 섞이지 않게)
  try {
    const u = new URL(window.location.href);
    let changed = false;
    for (const k of ["src", "from", "c", "via", "internal", "test"]) if (u.searchParams.has(k)) { u.searchParams.delete(k); changed = true; }
    if (changed) window.history.replaceState(window.history.state, "", u.pathname + u.search + u.hash);
  } catch { /* 무시 */ }

  let left = false; // visibilitychange 와 pagehide 가 같이 와도 exit 은 한 번만 (다시 보이면 풀림)
  const leave = () => {
    if (left) return;
    left = true;
    try {
      const s = getJson<Session>(K.session);
      if (s) push(s, "exit", null, { last_stage: s.lastStage, dwell_sec: Math.round((Date.now() - s.start) / 1000), plays: s.plays });
    } catch { /* 무시 */ }
    flush(true);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") leave();
    else left = false;
  });
  window.addEventListener("pagehide", leave);
}

/** 공유 링크에 어느 채널로 공유했는지 붙인다 (그 링크로 들어온 사람 = source "share") */
export function withVia(url: string, channel: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set("via", channel);
    return u.toString();
  } catch {
    return url;
  }
}
