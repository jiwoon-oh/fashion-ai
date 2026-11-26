import { NextResponse, type NextRequest } from "next/server";
import { MAX_FRIENDS, ensureProfile, loadFriends } from "@/lib/friends";
import { adminClient, currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const err = (code: string, status: number) => NextResponse.json({ error: code }, { status });

async function ctx() {
  const user = await currentUser();
  const db = adminClient();
  return { user, db };
}

// 내 초대 코드 + 친구들 점수·사진
export async function GET() {
  const { user, db } = await ctx();
  if (!db) return err("not_configured", 503);
  if (!user) return err("login_required", 401);
  return NextResponse.json(await loadFriends(db, user));
}

// 초대 코드로 친구 추가 (양쪽 모두 친구가 됨)
export async function POST(request: NextRequest) {
  const { user, db } = await ctx();
  if (!db) return err("not_configured", 503);
  if (!user) return err("login_required", 401);
  const body = await request.json().catch(() => ({}));
  const code = String(body?.code ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16);
  if (!code) return err("bad_code", 400);

  await ensureProfile(db, user);
  const { data: other } = await db.from("profiles").select("id, display_name").eq("invite_code", code).maybeSingle();
  if (!other) return err("bad_code", 404);
  if (other.id === user.id) return err("self", 400);

  const { count } = await db.from("friendships").select("friend_id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) >= MAX_FRIENDS) return err("too_many", 400);

  const { error } = await db.from("friendships").upsert(
    [
      { user_id: user.id, friend_id: other.id },
      { user_id: other.id, friend_id: user.id },
    ],
    { onConflict: "user_id,friend_id", ignoreDuplicates: true },
  );
  if (error) {
    console.error("friendships write", error.message);
    return err("db_error", 500);
  }
  return NextResponse.json({ ok: true, name: other.display_name });
}

// 친구 끊기 (양쪽 모두)
export async function DELETE(request: NextRequest) {
  const { user, db } = await ctx();
  if (!db) return err("not_configured", 503);
  if (!user) return err("login_required", 401);
  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return err("bad_request", 400);
  await db.from("friendships").delete().eq("user_id", user.id).eq("friend_id", id);
  await db.from("friendships").delete().eq("user_id", id).eq("friend_id", user.id);
  return NextResponse.json({ ok: true });
}
