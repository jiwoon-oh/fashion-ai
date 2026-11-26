import { NextResponse } from "next/server";
import { adminClient, currentUser, sessionClient } from "@/lib/supabase/server";

// DELETE /api/me → 회원 탈퇴: 저장된 내 사진 삭제 → 로그아웃 → 계정 삭제
// 계정을 지우면 profiles·battles·friendships 는 DB 규칙(on delete cascade)으로 같이 지워지고,
// 점수 캐시(photo_scores)·도전장의 회원 연결은 끊긴다(on delete set null).
export async function DELETE() {
  const user = await currentUser({ strict: true });
  const db = adminClient();
  if (!db) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!user) return NextResponse.json({ error: "login_required" }, { status: 401 });

  for (let page = 0; page < 20; page++) {
    const { data: files, error } = await db.storage.from("photos").list(user.id, { limit: 1000 });
    if (error) {
      console.error("withdraw list", error.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
    if (!files?.length) break;
    const { error: rmErr } = await db.storage.from("photos").remove(files.map((f) => `${user.id}/${f.name}`));
    if (rmErr) {
      console.error("withdraw photos", rmErr.message);
      return NextResponse.json({ error: "db_error" }, { status: 500 });
    }
  }

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("withdraw user", error.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
  // 브라우저의 로그인 쿠키 정리
  await (await sessionClient())?.auth.signOut().catch(() => {});
  return NextResponse.json({ ok: true });
}
