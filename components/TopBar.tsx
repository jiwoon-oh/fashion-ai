"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";
import Modal from "./Modal";
import ShareSheet from "./ShareSheet";
import { withdrawAccount } from "@/lib/account-client";
import { loginIntent } from "@/lib/track";

type Props = { userName: string | null; inviteCode: string | null; authReady: boolean; loginFailed: boolean };

const INVITE_TEXT = "옷빨 배틀 한판 ㄱ? 코디 사진 올리면 AI가 점수 매기고 진 사람 긁어줌 ㅋㅋ";
const REF_KEY = "ootd-ref";

export default function TopBar({ userName, inviteCode, authReady, loginFailed }: Props) {
  const [open, setOpen] = useState<null | "invite" | "login" | "account">(null);
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
            <button className="chip me" type="button" title="내 계정 (로그아웃·회원 탈퇴)" onClick={() => setOpen("account")}>👤 {userName} ▾</button>
          </>
        ) : (
          <button className="chip" type="button" onClick={() => setOpen("login")}>🔑 로그인</button>
        )}
      </div>
      {banner && <p className="status small banner" role="status">{banner}</p>}
      {open === "invite" && (
        <ShareSheet
          title="친구초대.exe"
          lead={inviteCode ? "이 링크로 들어온 사람이 로그인하면 자동으로 친구 추가됨. 서로 최고 점수·승수 구경 가능 ㅋ" : "링크 보내서 친구 불러와. 로그인하고 보내면 친구 추가까지 자동으로 됨!"}
          text={INVITE_TEXT}
          url={inviteUrl}
          card={{ kind: "invite", url: inviteUrl, inviter: userName }}
          onClose={() => setOpen(null)}
          context="invite"
        />
      )}
      {open === "account" && userName && <AccountModal name={userName} onClose={() => setOpen(null)} />}
      {open === "login" && <LoginModal authReady={authReady} onClose={() => setOpen(null)} />}
      {loginFailed && !userName && open === null && <p className="status small" style={{ width: "100%" }}>로그인 실패함 ㅠ 다시 해봐</p>}
    </nav>
  );
}

// X 는 Supabase 의 "X / Twitter (OAuth 2.0)" 방식 (provider 이름 "x")
type Provider = "google" | "kakao" | "x";

/** next: 로그인 뒤 돌아갈 주소 (예: 랭킹 등록 → "/ranking?register=1"). 없으면 메인 */
export function LoginModal({ authReady, onClose, next }: { authReady: boolean; onClose: () => void; next?: string }) {
  const [msg, setMsg] = useState("");
  const login = async (provider: Provider) => {
    const sb = browserClient();
    if (!sb) return setMsg("아직 로그인 설정 전이라 못 씀 (Supabase 키 넣어야 함)");
    loginIntent(provider);
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}` },
    });
    if (error) setMsg("로그인 창을 못 열었음 ㅠ 잠깐 뒤에 다시");
  };
  return (
    <Modal title="로그인.exe" onClose={onClose}>
      <p>로그인하고 랭킹 등록(닉네임 정하기)하면 1P(내 사진) 점수랑 승수가 주간 랭킹에 올라가고, 친구들 점수도 볼 수 있음.</p>
      <div className="btnrow">
        <button className="btn98" type="button" onClick={() => login("google")} disabled={!authReady}>G 구글로</button>
        <button className="btn98" style={{ background: "#fee500" }} type="button" onClick={() => login("kakao")} disabled={!authReady}>💬 카카오로</button>
        <button className="btn98" style={{ background: "#000", color: "#fff" }} type="button" onClick={() => login("x")} disabled={!authReady}>𝕏 X로</button>
      </div>
      <p className="login-fine">
        카톡·인스타 앱 안에서는 구글 로그인이 안 될 수 있어요. 카카오로 하시거나 브라우저에서 열어 주세요.
      </p>
      <p className="login-fine">
        로그인하면 <a href="/terms" target="_blank">이용약관</a>과 <a href="/privacy" target="_blank">개인정보처리방침</a>에 동의하는 것으로 봅니다. 만 14세 이상부터 가입할 수 있어요.
      </p>
      {!authReady && <p className="rank-empty">지금은 로그인 설정 전이라 버튼이 꺼져 있음</p>}
      {msg && <p>{msg}</p>}
    </Modal>
  );
}

function AccountModal({ name, onClose }: { name: string; onClose: () => void }) {
  const [msg, setMsg] = useState("");
  const withdraw = async () => {
    if ((await withdrawAccount()) === "failed") setMsg("탈퇴하다 삐끗함 ㅠ 잠시 뒤 다시 해줘");
  };
  return (
    <Modal title="내계정.exe" onClose={onClose}>
      <p>👤 <b>{name}</b> 님으로 로그인 중</p>
      <div className="btnrow">
        <Link className="btn98" href="/friends">👯 친구 탭</Link>
        <form action="/auth/signout" method="post"><button className="btn98" type="submit" style={{ width: "100%" }}>🚪 로그아웃</button></form>
      </div>
      <p className="legal-consent"><a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a></p>
      <p className="withdraw" style={{ textAlign: "right", marginTop: 8 }}>
        <button type="button" className="linkish" onClick={withdraw}>회원 탈퇴</button>
      </p>
      {msg && <p className="share-hint">{msg}</p>}
    </Modal>
  );
}
