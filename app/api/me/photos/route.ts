import { NextResponse } from "next/server";
import { adminClient, currentUser } from "@/lib/supabase/server";

// 내가 친구 공개용으로 올린 1P 사진을 전부 지운다 (점수 기록은 남음)
export async function DELETE() {
  const user = await currentUser();
  const db = adminClient();
  if (!db) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!user) return NextResponse.json({ error: "login_required" }, { status: 401 });

  const { data: files } = await db.storage.from("photos").list(user.id, { limit: 1000 });
  const paths = (files ?? []).map((f) => `${user.id}/${f.name}`);
  if (paths.length) {
    const { error } = await db.storage.from("photos").remove(paths);
    if (error) {
      console.error("photo remove", error.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
  }
  await db.from("battles").update({ p1_photo_path: null }).eq("user_id", user.id);
  return NextResponse.json({ ok: true, removed: paths.length });
}
