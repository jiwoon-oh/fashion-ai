"use client";

import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

type Props = { userName: string | null; authReady: boolean; loginFailed: boolean };

const INVITE_TEXT = "옷빨 배틀 한판 ㄱ? 코디 사진 올리면 AI가 점수 매기고 진 사람 긁어줌 ㅋㅋ";

export default function TopBar({ userName, authReady, loginFailed }: Props) {
  const [open, setOpen] = useState<null | "invite" | "login">(null);

  return (
    <nav className="topbar" aria-label="상단 메뉴">
      <div className="left">
        {!userName && <span className="note">로그인하면 랭킹 등록됨</span>}
      </div>
      <div className="right">
        <button className="chip invite" type="button" onClick={() => setOpen("invite")}>💌 친구 초대</button>
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
      {open === "invite" && <InviteModal onClose={() => setOpen(null)} />}
      {open === "login" && <LoginModal authReady={authReady} onClose={() => setOpen(null)} />}
      {loginFailed && !userName && open === null && <p className="status small" style={{ width: "100%" }}>로그인 실패함 ㅠ 다시 해봐</p>}
    </nav>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="win98 modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="titlebar">
          <span className="name">{title}</span>
          <span className="tb-btns"><button type="button" onClick={onClose} aria-label="닫기"><i>x</i></button></span>
        </div>
        <div className="winbody">{children}</div>
      </section>
    </div>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [link, setLink] = useState("");
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  useEffect(() => setLink(window.location.origin), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${INVITE_TEXT}\n${link}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: "옷빨 배틀", text: INVITE_TEXT, url: link });
    } catch {
      /* 사용자가 공유 창을 닫음 */
    }
  };

  return (
    <Modal title="친구초대.exe" onClose={onClose}>
      <p>이 링크 보내서 친구 불러와. 누가 옷빨왕인지 랭킹으로 박제하자 ㅋ</p>
      <div className="linkbox">{INVITE_TEXT}<br />{link}</div>
      <div className="btnrow">
        <button className="btn98" type="button" onClick={copy}>{copied ? "✅ 복사됨" : "📋 링크 복사"}</button>
        <button className="btn98" type="button" onClick={share} disabled={!canShare}>📤 공유하기</button>
      </div>
    </Modal>
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
      <p>로그인하면 1P(내 사진) 점수랑 승수가 랭킹에 올라감.</p>
      <div className="btnrow">
        <button className="btn98" type="button" onClick={() => login("google")} disabled={!authReady}>G 구글로</button>
        <button className="btn98" style={{ background: "#fee500" }} type="button" onClick={() => login("kakao")} disabled={!authReady}>💬 카카오로</button>
      </div>
      {!authReady && <p className="rank-empty">지금은 로그인 설정 전이라 버튼이 꺼져 있음</p>}
      {msg && <p>{msg}</p>}
    </Modal>
  );
}
