"use client";

import { useCallback, useEffect, useState } from "react";
import type { FriendSummary, FriendsResponse } from "@/lib/friends";
import ShareSheet from "./ShareSheet";

const INVITE_TEXT = "옷빨 배틀 친구하자 ㅋㅋ 이 링크로 들어와서 로그인하면 서로 코디 점수 볼 수 있음";

export default function FriendsBoard() {
  const [data, setData] = useState<FriendsResponse | null>(null);
  const [failed, setFailed] = useState("");
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");
  const [sharing, setSharing] = useState(false);
  const [origin, setOrigin] = useState("");

  const load = useCallback(() => {
    fetch("/api/friends", { cache: "no-store" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error ?? "error");
        setData(d as FriendsResponse);
      })
      .catch((e: Error) => setFailed(e.message === "not_configured" ? "아직 DB 연결 전이라 친구 기능을 못 씀" : "친구 목록 불러오다 삐끗함 ㅠ 새로고침 ㄱ"));
  }, []);

  useEffect(() => { setOrigin(window.location.origin); load(); }, [load]);

  const addFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = code.trim();
    let c = raw;
    if (raw.includes("ref=")) {
      try { c = new URL(raw, window.location.origin).searchParams.get("ref") ?? ""; } catch { c = raw; }
    }
    if (!c) return;
    const r = await fetch("/api/friends", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: c }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setMsg(`👯 ${d.name ?? "친구"} 님 추가됨!`); setCode(""); load(); }
    else setMsg(d.error === "self" ? "그건 내 코드임 ㅋ" : d.error === "too_many" ? "친구가 너무 많음 (최대 200명)" : "그런 코드 없음. 다시 확인 ㄱ");
  };

  const removeFriend = async (f: FriendSummary) => {
    if (!confirm(`${f.name} 님이랑 친구 끊을까? (서로 목록에서 사라짐)`)) return;
    await fetch(`/api/friends?id=${encodeURIComponent(f.id)}`, { method: "DELETE" });
    load();
  };

  // 예전 버전에서 친구 공개용으로 저장됐던 사진 지우기 (지금은 사진을 저장하지 않음)
  const deletePhotos = async () => {
    if (!confirm("예전에 친구 공개용으로 저장된 내 사진이 있으면 전부 지울까? 점수 기록은 남음. 되돌릴 수 없음!")) return;
    const r = await fetch("/api/me/photos", { method: "DELETE" });
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? `🗑 사진 ${d.removed ?? 0}장 지움` : "지우다 삐끗함 ㅠ 다시 해줘");
    load();
  };

  const withdraw = async () => {
    if (!confirm("정말 탈퇴할까? 내 계정, 배틀 기록, 랭킹, 친구 관계, 저장된 사진이 전부 바로 지워짐. 되돌릴 수 없음!")) return;
    if (!confirm("마지막 확인: 진짜 탈퇴?")) return;
    const r = await fetch("/api/me", { method: "DELETE" });
    if (r.ok) {
      try { ["ootd-ref", "ootd-share-photo"].forEach((k) => localStorage.removeItem(k)); } catch { /* 무시 */ }
      alert("탈퇴 완료. 그동안 고마웠음 ㅠ");
      window.location.href = "/";
    } else setMsg("탈퇴하다 삐끗함 ㅠ 잠시 뒤 다시 하거나 개인정보처리방침의 연락처로 알려줘");
  };

  if (failed) return <p className="status small">{failed}</p>;
  if (!data) return <p className="status small">불러오는 중…</p>;

  const inviteUrl = origin && data.inviteCode ? `${origin}/?ref=${data.inviteCode}` : origin;

  return (
    <>
      <section className="win98 friends-invite" aria-label="친구 추가">
        <div className="titlebar"><span className="name">친구추가.exe</span><span className="tb-btns" aria-hidden="true"><i>_</i><i>□</i><i>x</i></span></div>
        <div className="winbody">
          <p>내 친구 코드: <b className="code">{data.inviteCode || "…"}</b></p>
          <div className="btnrow">
            <button className="btn98" type="button" onClick={() => setSharing(true)} disabled={!inviteUrl}>💌 초대 링크 보내기</button>
          </div>
          <form className="code-form" onSubmit={addFriend}>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="친구 코드나 초대 링크 붙여넣기" aria-label="친구 코드" maxLength={200} />
            <button className="btn98" type="submit">추가</button>
          </form>
          {msg && <p className="share-hint">{msg}</p>}
        </div>
      </section>

      <FriendList me={data.me} friends={data.friends} onRemove={removeFriend} />

      <p className="withdraw">
        <a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a> ·{" "}
        <button type="button" className="linkish plain" onClick={deletePhotos}>예전 저장 사진 지우기</button> ·{" "}
        <button type="button" className="linkish" onClick={withdraw}>회원 탈퇴</button>
      </p>

      {sharing && (
        <ShareSheet
          title="친구초대.exe"
          lead="이 링크로 들어와서 로그인하면 자동으로 친구 추가됨"
          text={INVITE_TEXT}
          url={inviteUrl}
          card={{ kind: "invite", url: inviteUrl, inviter: data.me.name }}
          onClose={() => setSharing(false)}
        />
      )}
    </>
  );
}

// 친구 순위: 한 줄에 한 명 (나 포함, 최고 점수 순)
function FriendList({ me, friends, onRemove }: { me: FriendSummary; friends: FriendSummary[]; onRemove: (f: FriendSummary) => void }) {
  const rows = [me, ...friends].sort((a, b) => (b.best?.total ?? -1) - (a.best?.total ?? -1) || b.wins - a.wins);
  return (
    <section className="win98 friend-list" aria-label="친구 순위">
      <div className="titlebar"><span className="name">친구순위.exe ({friends.length}명)</span><span className="tb-btns" aria-hidden="true"><i>_</i><i>□</i><i>x</i></span></div>
      <div className="winbody">
        {friends.length === 0 && (
          <p className="rank-empty">아직 친구 없음 ㅠ 위에서 초대 링크 보내면, 그 링크로 들어온 친구가 로그인할 때 자동으로 친구 됨</p>
        )}
        <ol className="flist">
          {rows.map((p, i) => (
            <li key={p.id} className={p.me ? "me" : ""}>
              <span className="fl-rank">{i + 1}</span>
              <span className="fl-name">{p.name}{p.me ? " (나)" : ""}</span>
              <span className="fl-best" title={p.best?.nickname ? `최고 점수 코디: ${p.best.nickname}` : undefined}>
                {p.best ? <>{p.best.total}<small>점</small>{p.best.mock ? <small className="fl-mock">가짜</small> : null}</> : "-"}
              </span>
              <span className="fl-wins">{p.wins}<small>승</small></span>
              <span className="fl-games">{p.battles}<small>판</small></span>
              {p.me ? <span className="fl-x" /> : (
                <button type="button" className="fl-x" onClick={() => onRemove(p)} aria-label={`${p.name} 친구 끊기`} title="친구 끊기">✕</button>
              )}
            </li>
          ))}
        </ol>
        <p className="share-hint">점수·승수만 보임. 어떤 사진으로 몇 점 받았는지는 안 보여줌. 전체 사용자 순위는 🏆 랭킹에서.</p>
      </div>
    </section>
  );
}
