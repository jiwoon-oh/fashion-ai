"use client";

import { useCallback, useEffect, useState } from "react";
import type { RankRow, RankingResponse } from "@/app/api/ranking/route";
import { track } from "@/lib/track";
import { LoginModal } from "./TopBar";

// 주간 랭킹만 보여준다 (전체 랭킹·승수 탭은 2026-11-26에 없앰).
// 로그인만으로는 안 뜨고, '랭킹 등록' → 닉네임 정한 사람만 닉네임·점수·승수로 올라간다.
type View = "list" | "name";

const NAME_ERRORS: Record<string, string> = {
  bad_name: "2~10자, 한글·영문·숫자·_ 만 됨",
  banned_name: "그 닉네임은 못 씀. 다른 걸로 ㄱ",
  name_taken: "누가 이미 쓰는 중 ㅠ 다른 거 ㄱ",
  login_required: "로그인이 풀렸음. 다시 로그인해줘",
  not_configured: "아직 DB 연결 전이라 등록 못 함",
};

export default function RankingBoard({ authReady }: { authReady: boolean }) {
  const [data, setData] = useState<RankingResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<View>("list");
  const [login, setLogin] = useState(false);

  const load = useCallback(() => {
    return fetch("/api/ranking", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: RankingResponse) => { setData(d); setFailed(false); })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  // 로그: 랭킹을 연 뒤 데이터가 오면 한 번
  useEffect(() => {
    if (!data && !failed) return;
    const mine = data?.rows.find((r) => r.me);
    track("ranking_view", { tab: "weekly", my_rank: mine?.rank ?? null, failed });
  }, [data, failed]);

  const me = data?.me;
  const startRegister = () => (me?.loggedIn ? setView("name") : setLogin(true));

  if (view === "name" && me?.loggedIn) {
    return (
      <NameForm
        current={me.name}
        onCancel={() => setView("list")}
        onDone={async () => { await load(); setView("list"); }}
      />
    );
  }

  return (
    <div className="rank-weekly">
      {data && (
        <div className="rank-reg">
          {me?.registered ? (
            <p className="rank-myname">
              내 닉네임 <b>{me.name}</b>
              <button type="button" className="linkish" onClick={() => setView("name")}>바꾸기</button>
            </p>
          ) : (
            <>
              <button type="button" className="rank-btn rank-register" onClick={startRegister}>🏁 랭킹 등록하기</button>
              <p className="rank-reg-hint">{me?.loggedIn ? "닉네임만 정하면 이번 주 랭킹에 바로 올라감" : "로그인하고 닉네임 정하면 올라감"}</p>
            </>
          )}
        </div>
      )}

      <section className="win98 p2" aria-label="주간 랭킹">
        <div className="titlebar">
          <span className="name">주간_랭킹.exe{data ? ` ${weekRange(data.weekStart)}` : ""}</span>
          <span className="tb-btns" aria-hidden="true"><i>_</i><i>□</i><i>x</i></span>
        </div>
        <div className="winbody">
          <RankTable rows={data?.rows} loading={!data && !failed} />
        </div>
      </section>

      <p className="rank-note">
        <span>
          {failed ? "랭킹 불러오다 삐끗함 ㅠ 새로고침 ㄱ"
            : data && !data.configured ? "아직 DB 연결 전이라 랭킹이 비어 있음"
            : data?.dbError ? "랭킹 DB가 아직 준비 중인 듯 (관리자: schema.sql 7번 실행)"
            : "점수: 이번 주 1P 사진 최고 점수 · 승수: 이번 주 이긴 판 (같은 사진끼리 반복은 1승) · 월요일 0시(한국 시간) 초기화"}
        </span>
      </p>

      {login && <LoginModal authReady={authReady} onClose={() => setLogin(false)} />}
    </div>
  );
}

function RankTable({ rows, loading }: { rows?: RankRow[]; loading: boolean }) {
  return (
    <ol className="rank-list rank-table">
      <li className="rank-head" aria-hidden="true">
        <span className="no">#</span><span className="who">닉네임</span><span className="val">점수</span><span className="val">승수</span>
      </li>
      {loading ? <li className="rank-empty" style={{ display: "block" }}>불러오는 중…</li>
        : !rows || rows.length === 0 ? <li className="rank-empty" style={{ display: "block" }}>아직 아무도 없음.<br />1등 자리 비어 있음 ㄱㄱ</li>
        : rows.map((r, i) => (
          <li key={i} className={(r.rank <= 3 ? "top " : "") + (r.me ? "me" : "")}>
            <span className="no">{r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}</span>
            <span className="who">{r.name}{r.me ? " (나)" : ""}</span>
            <span className="val">{r.best}점</span>
            <span className="val">{r.wins}승</span>
          </li>
        ))}
    </ol>
  );
}

function NameForm({ current, onCancel, onDone }: { current: string | null; onCancel: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState(current ?? "");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = name.trim();
    if (!/^[가-힣a-zA-Z0-9_]{2,10}$/.test(v)) return setMsg(NAME_ERRORS.bad_name);
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch("/api/ranking/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: v }) });
      const d = await r.json().catch(() => ({}));
      track("ranking_register", { ok: r.ok, first: !current, error: r.ok ? null : String(d.error ?? r.status) });
      if (!r.ok) return setMsg(NAME_ERRORS[d.error] ?? "등록하다 삐끗함 ㅠ 잠깐 뒤에 다시");
      await onDone();
    } catch {
      track("ranking_register", { ok: false, first: !current, error: "network" });
      setMsg("등록하다 삐끗함 ㅠ 잠깐 뒤에 다시");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="win98 p1 rank-nameform" aria-label="닉네임 설정">
      <div className="titlebar">
        <span className="name">닉네임설정.exe</span>
        <span className="tb-btns" aria-hidden="true"><i>_</i><i>□</i><i>x</i></span>
      </div>
      <form className="winbody" onSubmit={submit}>
        <p>{current ? "랭킹에 보일 닉네임 바꾸기" : "랭킹에 보일 닉네임 정하기"}</p>
        <input
          className="rank-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={10}
          placeholder="예: 옷장털이범"
          autoFocus
          enterKeyHint="done"
          aria-label="닉네임"
        />
        <p className="rank-reg-hint">2~10자 · 한글·영문·숫자·_ · 실명 말고 별명 추천</p>
        {msg && <p className="share-hint" role="alert">{msg}</p>}
        <div className="btnrow">
          <button className="btn98" type="button" onClick={onCancel} disabled={busy}>취소</button>
          <button className="btn98 primary" type="submit" disabled={busy}>{busy ? "등록 중…" : current ? "바꾸기" : "등록하기"}</button>
        </div>
      </form>
    </section>
  );
}

function weekRange(iso: string) {
  const start = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const end = new Date(start.getTime() + 6 * 86400_000);
  const f = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `(${f(start)}~${f(end)})`;
}
