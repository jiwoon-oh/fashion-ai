"use client";

import { useEffect, useState } from "react";
import type { RankRow, RankingResponse } from "@/app/api/ranking/route";

type Kind = "best" | "wins";
const KINDS: { kind: Kind; label: string }[] = [
  { kind: "best", label: "🏆 최고 점수" },
  { kind: "wins", label: "⚔️ 승수" },
];

export default function RankingBoard() {
  const [kind, setKind] = useState<Kind>("best");
  const [data, setData] = useState<RankingResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/ranking", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d: RankingResponse) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  const weekLabel = data ? weekRange(data.weekStart) : "";

  return (
    <>
      <div className="rank-tabs" role="group" aria-label="랭킹 기준">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" aria-pressed={kind === k.kind} onClick={() => setKind(k.kind)}>{k.label}</button>
        ))}
      </div>
      <div className="rank-grid">
        <Column title="전체_랭킹.exe" side="p1" rows={data?.all[kind]} kind={kind} loading={!data && !failed} />
        <Column title="주간_랭킹.exe" side="p2" rows={data?.weekly[kind]} kind={kind} loading={!data && !failed} />
      </div>
      <p className="rank-note">
        <span>
          {failed ? "랭킹 불러오다 삐끗함 ㅠ 새로고침 ㄱ"
            : data && !data.configured ? "아직 DB 연결 전이라 랭킹이 비어 있음"
            : kind === "best" ? "최고 점수: 내가 1P로 올린 사진 중 제일 높은 점수"
            : "승수: 1P로 이긴 판 수 (같은 사진끼리 반복해서 이긴 건 1승만 셈)"}
          {` · 주간${weekLabel ? " " + weekLabel : ""}은 월요일 0시(한국 시간)에 초기화`}
        </span>
      </p>
    </>
  );
}

function Column({ title, side, rows, kind, loading }: { title: string; side: "p1" | "p2"; rows?: RankRow[]; kind: Kind; loading: boolean }) {
  return (
    <section className={`win98 ${side}`} aria-label={title}>
      <div className="titlebar">
        <span className="name">{title}</span>
        <span className="tb-btns" aria-hidden="true"><i>_</i><i>□</i><i>x</i></span>
      </div>
      <div className="winbody">
        <ol className="rank-list">
          {loading ? <li className="rank-empty" style={{ display: "block" }}>불러오는 중…</li>
            : !rows || rows.length === 0 ? <li className="rank-empty" style={{ display: "block" }}>아직 아무도 없음.<br />1등 자리 비어 있음 ㄱㄱ</li>
            : rows.map((r, i) => (
              <li key={i} className={(r.rank <= 3 ? "top " : "") + (r.me ? "me" : "")}>
                <span className="no">{r.rank === 1 ? "🥇" : r.rank === 2 ? "🥈" : r.rank === 3 ? "🥉" : r.rank}</span>
                <span className="who">
                  {r.name}{r.me ? " (나)" : ""}
                  {kind === "best" && r.detail ? <small>{r.detail}</small> : null}
                </span>
                <span className="val">{kind === "best" ? `${r.value}점` : `${r.value}승`}</span>
              </li>
            ))}
        </ol>
      </div>
    </section>
  );
}

function weekRange(iso: string) {
  const start = new Date(new Date(iso).getTime() + 9 * 3600_000);
  const end = new Date(start.getTime() + 6 * 86400_000);
  const f = (d: Date) => `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
  return `(${f(start)}~${f(end)})`;
}
