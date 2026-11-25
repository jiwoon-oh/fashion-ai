import { NextResponse, type NextRequest } from "next/server";
import { sessionClient } from "@/lib/supabase/server";

// 구글·카카오 로그인 후 Supabase 가 돌려보내는 곳
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (code) {
    const sb = await sessionClient();
    const { error } = (await sb?.auth.exchangeCodeForSession(code)) ?? { error: new Error("not configured") };
    if (!error) return NextResponse.redirect(`${origin}${dest}`);
  }
  return NextResponse.redirect(`${origin}/?login=failed`);
}
