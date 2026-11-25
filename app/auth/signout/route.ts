import { NextResponse, type NextRequest } from "next/server";
import { sessionClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const sb = await sessionClient();
  await sb?.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
