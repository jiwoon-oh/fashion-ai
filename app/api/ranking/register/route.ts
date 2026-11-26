import { NextResponse, type NextRequest } from "next/server";
import { ensureProfile } from "@/lib/friends";
import { hasBannedWord } from "@/lib/roaster";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const err = (code: string, status: number) => NextResponse.json({ error: code }, { status });

// 랭킹 닉네임: 2~10자, 한글·영문·숫자·_ 만
const NAME_RE = /^[가-힣a-zA-Z0-9_]{2,10}$/;

// POST /api/ranking/register { name } → 랭킹 등록(처음) 또는 닉네임 바꾸기
export async function POST(request: NextRequest) {
  const db = adminClient();
  if (!db) return err("not_configured", 503);
  const user = await currentUser();
  if (!user) return err("login_required", 401);

  const body = await request.json().catch(() => null);
  const name = String(body?.name ?? "").trim();
  if (!NAME_RE.test(name)) return err("bad_name", 400);
  if (hasBannedWord(name)) return err("banned_name", 400);

  await ensureProfile(db, user).catch(() => null);
  const { data: before } = await db.from("profiles").select("ranked_at").eq("id", user.id).maybeSingle();
  const { error } = await db
    .from("profiles")
    .update({ rank_name: name, ranked_at: before?.ranked_at ?? new Date().toISOString() })
    .eq("id", user.id);
  if (error) {
    if (error.code === "23505") return err("name_taken", 409);
    console.error("ranking register", error.message);
    return err("db_error", 500);
  }
  return NextResponse.json({ ok: true, name });
}
