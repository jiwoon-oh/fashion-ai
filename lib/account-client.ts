"use client";

// 회원 탈퇴 (상단 👤 내 계정 창, 친구 탭 맨 아래에서 같이 씀)
export async function withdrawAccount(): Promise<"done" | "cancel" | "failed"> {
  if (!confirm("정말 탈퇴할까? 내 계정, 배틀 기록, 랭킹, 친구 관계가 전부 바로 지워짐. 되돌릴 수 없음!")) return "cancel";
  if (!confirm("마지막 확인: 진짜 탈퇴?")) return "cancel";
  const r = await fetch("/api/me", { method: "DELETE" }).catch(() => null);
  if (!r?.ok) return "failed";
  try { ["ootd-ref", "ootd-share-photo"].forEach((k) => localStorage.removeItem(k)); } catch { /* 무시 */ }
  alert("탈퇴 완료. 그동안 고마웠음 ㅠ");
  window.location.href = "/";
  return "done";
}
