"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import Modal from "./Modal";
import ShareSheet from "./ShareSheet";

type Props = { userName: string | null; inviteCode: string | null; authReady: boolean; loginFailed: boolean };

const INVITE_TEXT = "옷빨 배틀 한판 ㄱ? 코디 사진 올리면 AI가 점수 매기고 진 사람 긁어줌 ㅋㅋ";
const REF_KEY = "ootd-ref";

export default function TopBar({ userName, inviteCode, authReady, loginFailed }: Props) {
  const [open, setOpen] = useState<null | "invite" | "login">(null);
  const [origin, setOrigin] = useState("");
  const [banner, setBanner] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    // 초대 링크(?ref=코드)로 들어오면 코드를 기억해 뒀다가, 로그인한 상태가 되면 친구로 추가한다
    const url = new URL(window.location.href);
    const ref = url.searchParams.get("ref");
    if (ref) {
      try { localStorage.setItem(REF_KEY, ref); } catch { /* 저장 못 해도 진행 */ }
      url.searchParams.delete("ref");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
    let stored: string | null = ref;
    try { stored = stored ?? localStorage.getItem(REF_KEY); } catch { /* 무시 */ }
    if (!stored) return;
    if (!userName) {
      setBanner("👯 친구 초대 받음! 오른쪽 위에서 로그인하면 바로 친구 추가됨");
      return;
    }
    fetch("/api/friends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: stored }) })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (r.ok) setBanner(`👯 ${d.name ?? "친구"} 님이랑 친구 됨! 친구 탭에서 점수 비교 ㄱ`);
        else if (d.error === "self") setBanner("");
        else if (d.error === "bad_code") setBanner("초대 링크가 이상함 ㅠ 친구한테 다시 받아줘");
        if (r.ok || d.error === "self" || d.error === "bad_code") {
          try { localStorage.removeItem(REF_KEY); } catch { /* 무시 */ }
        }
      })
      .catch(() => {});
  }, [userName]);

  const inviteUrl = origin ? origin + (inviteCode ? `/?ref=${inviteCode}` : "/") : "";

  return (
    <nav className="topbar" aria-label="상단 메뉴">
      <div className="left">
        {userName ? <Link className="chip friends" href="/friends">👯 친구</Link> : <span className="note">로그인하면 랭킹·친구 기능 열림</span>}
      </div>
      <div className="right">
        <button className="chip invite" type="button" onClick={() => setOpen("invite")} disabled={!origin}>💌 친구 초대</button>
        {userName ? (
          <>
            <span className="chip me" title={userName}>👤 {userName}</span>
            <form action="/auth/signout" method="post">
              <button className="chip" type="submit">로그아웃</button>
            </form>
          </>
        ) : (
          <button className="chip" type="button" onClick={() => setOpen("login")}>🔑 로그인</button>
        )}
      </div>
      {banner && <p className="status small banner" role="status">{banner}</p>}
      {open === "invite" && (
        <ShareSheet
          title="친구초대.exe"
          lead={inviteCode ? "이 링크로 들어온 친구가 로그인하면 자동으로 친구 추가됨. 서로 점수·사진 구경 가능 ㅋ" : "링크 보내서 친구 불러와. 로그인하고 보내면 친구 추가까지 자동으로 됨!"}
          text={INVITE_TEXT}
          url={inviteUrl}
          card={{ kind: "invite", url: inviteUrl, inviter: userName }}
          onClose={() => setOpen(null)}
        />
      )}
      {open === "login" && <LoginModal authReady={authReady} onClose={() => setOpen(null)} />}
      {loginFailed && !userName && open === null && <p className="status small" style={{ width: "100%" }}>로그인 실패함 ㅠ 다시 해봐</p>}
    </nav>
  );
}

function LoginModal({ authReady, onClose }: { authReady: boolean; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const login = async (provider: "google" | "kakao") => {
    const sb = browserClient();
    if (!sb) return setMsg("아직 로그인 설정 전이라 못 씀 (Supabase 키 넣어야 함)");
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) setMsg("로그인 창을 못 열었음 ㅠ 잠깐 뒤에 다시");
  };
  return (
    <Modal title="로그인.exe" onClose={onClose}>
      <p>로그인하면 1P(내 사진) 점수랑 승수가 랭킹에 올라가고, 친구들 점수도 볼 수 있음.</p>
      <div className="btnrow">
        <button className="btn98" type="button" onClick={() => login("google")} disabled={!authReady}>G 구글로</button>
        <button className="btn98" style={{ background: "#fee500" }} type="button" onClick={() => login("kakao")} disabled={!authReady}>💬 카카오로</button>
      </div>
      <p className="share-hint">카톡·인스타 안에서 열었으면 구글 로그인이 막힐 수 있음 → 카카오로 하거나 크롬·사파리에서 열어줘</p>
      {!authReady && <p className="rank-empty">지금은 로그인 설정 전이라 버튼이 꺼져 있음</p>}
      {msg && <p>{msg}</p>}
    </Modal>
  );
}
