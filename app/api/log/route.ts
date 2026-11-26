import { NextResponse, type NextRequest } from "next/server";
import { APPS, allowedEvent, type App } from "@/lib/track-events";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// POST /api/log → 행동 로그 묶음 저장 (docs/log-design-otbbal.md)
// 브라우저는 fetch(keepalive) 또는 sendBeacon(text/plain)으로 { events: [...] } 를 보낸다.
// 돌수제비처럼 다른 주소의 웹은 LOG_ALLOWED_ORIGINS(쉼표 구분)에 주소를 넣으면 받는다.

const MAX_EVENTS = 50;
const MAX_PROPS = 2000; // props JSON 글자 수
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const allowedOrigins = () =>
  (process.env.LOG_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);

function cors(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Credentials": "true",
    Vary: "Origin",
  };
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

const str = (v: unknown, max: number) => (typeof v === "string" && v ? v.slice(0, max) : null);
const word = (v: unknown, max = 40) => {
  const s = str(v, max);
  return s && /^[a-z0-9_.:-]+$/i.test(s) ? s : null;
};

function clean(e: unknown) {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  const app = o.app as App;
  if (!APPS.includes(app)) return null;
  const name = String(o.event_name ?? "");
  if (!allowedEvent(app, name)) return null;
  const eventId = String(o.event_id ?? "");
  const userId = word(o.user_id, 64);
  const sessionId = word(o.session_id, 64);
  if (!UUID.test(eventId) || !userId || !sessionId) return null;

  let props: Record<string, unknown> = {};
  if (o.props && typeof o.props === "object" && !Array.isArray(o.props)) {
    const json = JSON.stringify(o.props);
    props = json.length <= MAX_PROPS ? (o.props as Record<string, unknown>) : { truncated: true };
  }
  const ct = typeof o.client_time === "string" ? new Date(o.client_time) : null;
  const stage = Number.isInteger(o.stage) && (o.stage as number) >= 0 && (o.stage as number) <= 20 ? (o.stage as number) : null;

  return {
    event_id: eventId,
    client_time: ct && !Number.isNaN(ct.getTime()) ? ct.toISOString() : null,
    app,
    user_id: userId,
    session_id: sessionId,
    event_name: name,
    stage,
    device: word(o.device, 16),
    browser: word(o.browser, 24),
    source: word(o.source, 24),
    source_detail: word(o.source_detail, 60),
    is_internal: o.is_internal === true,
    props,
  };
}

export async function POST(request: NextRequest) {
  const headers = cors(request);
  const db = adminClient();

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 120_000) return NextResponse.json({ error: "too_big" }, { status: 413, headers });
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400, headers });
  }
  const list = Array.isArray((body as { events?: unknown })?.events) ? (body as { events: unknown[] }).events : [];
  const rows = list.slice(0, MAX_EVENTS).map(clean).filter((r): r is NonNullable<ReturnType<typeof clean>> => !!r);
  if (!rows.length) return new NextResponse(null, { status: 204, headers });
  if (!db) {
    // DB 설정 전: 개발 중에는 서버 콘솔에 찍어서 확인만, 배포에서는 조용히 버림
    if (process.env.NODE_ENV !== "production") {
      for (const r of rows) console.log("[log]", r.event_name, r.stage ?? "-", r.source, r.source_detail ?? "", r.browser, JSON.stringify(r.props));
    }
    return new NextResponse(null, { status: 204, headers });
  }

  // 로그인 쿠키가 있으면 계정 id를 붙인다 (다른 주소 웹에서 온 요청은 보통 없음)
  const user = await currentUser().catch(() => null);
  const auth_uid = user?.id ?? null;

  const { error } = await db
    .from("events")
    .upsert(rows.map((r) => ({ ...r, auth_uid })), { onConflict: "event_id", ignoreDuplicates: true });
  if (error) {
    console.error("events write", error.message);
    return NextResponse.json({ error: "db_error" }, { status: 500, headers });
  }
  return new NextResponse(null, { status: 204, headers });
}
