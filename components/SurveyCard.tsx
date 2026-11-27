"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isInternal, track } from "@/lib/track";
import {
  AGES, GENDERS, OTHER, REASONS, RESULT_EVENT, RESULT_LEAVE_EVENT, REVISIT, SK, SURVEY_DELAY_MS, SURVEY_EVERY_N_RESULTS,
  SURVEY_GUEST_FIRST, SURVEY_ID, SURVEY_MAX_REASONS, SURVEY_MAX_SHOWS, SURVEY_OTHER_MAX, TIPS_CLOSED_EVENT, type ResultDetail,
} from "@/lib/survey-config";

// 1차 설문 카드 (docs/survey-otbbal.md, 팀 확정안 2026-11-27)
// - 결과를 본 누적 횟수로 띄운다: 보통 2번째 결과, 도전장 게스트는 첫 결과. 닫으면 2번마다 다시, 최대 3번. 제출하면 끝.
// - 결과가 뜨면 📏 점수 올리는 법 창이 먼저 열린다. 그 창을 x 로 닫고 1.5초 뒤에 아래에서 올라온다.
//   창을 안 닫고 AGAIN · 새 판 · 공유로 넘어가면 이번 결과에서는 안 띄운다 (노출로 안 셈).
// - 구경만(challenge_viewer) · 가짜 채점(mock)은 안 센다. 팀 표시 폰은 첫 결과부터 뜨고, 횟수는 저장 안 함(메모리).
// - 응답은 로그(events)의 survey_view / survey_close / survey_submit. 저장이 실패해도 게임은 그대로.

type Shows = { n: number; at: number };

const store = {
  ok(): boolean {
    try {
      localStorage.setItem("otbbal_survey_probe", "1");
      localStorage.removeItem("otbbal_survey_probe");
      return true;
    } catch {
      return false;
    }
  },
  get(k: string): string | null {
    try { return localStorage.getItem(k); } catch { return null; }
  },
  set(k: string, v: string) {
    try { localStorage.setItem(k, v); } catch { /* 무시 */ }
  },
};

const readShows = (): Shows => {
  try {
    const d = JSON.parse(store.get(SK.shows) || "null");
    if (d && typeof d === "object") return { n: Math.max(0, +d.n || 0), at: Math.max(0, +d.at || 0) };
  } catch { /* 무시 */ }
  return { n: 0, at: 0 };
};

const shuffle = <T,>(a: T[]) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
};

/** Q3 보기 순서: 처음 섞은 순서를 저장해 두고 다시 띄울 때도 같은 순서 */
function reasonOrder(): string[] {
  const all = REASONS.map((r) => r.v);
  try {
    const saved = JSON.parse(store.get(SK.order) || "null");
    if (Array.isArray(saved) && saved.length === all.length && all.every((v) => saved.includes(v))) return saved;
  } catch { /* 무시 */ }
  const order = shuffle(all);
  store.set(SK.order, JSON.stringify(order));
  return order;
}

/** 이번 결과로 띄울 차례인가 (n = 지금까지 뜬 횟수, at = 마지막으로 뜬 때의 누적 결과 횟수) */
const due = (count: number, s: Shows, guest: boolean) => {
  if (s.n >= SURVEY_MAX_SHOWS) return false;
  if (s.n === 0) return count >= (guest && SURVEY_GUEST_FIRST ? 1 : SURVEY_EVERY_N_RESULTS);
  return count >= s.at + SURVEY_EVERY_N_RESULTS;
};

type Pending = { count: number; mode: string };

export default function SurveyCard() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0); // 0~3 = Q1~Q4
  const [age, setAge] = useState("");
  const [gender, setGender] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [other, setOther] = useState("");
  const [hint, setHint] = useState("");
  const [toast, setToast] = useState(false);
  const [order, setOrder] = useState<string[]>([]);

  const pending = useRef<Pending | null>(null); // 이번 결과에서 띄울 차례면 값이 있음
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const view = useRef({ showIndex: 0, count: 0, mode: "", at: 0 });
  const mem = useRef({ count: 0, shows: { n: 0, at: 0 } as Shows, done: false }); // 팀 표시 폰용 (저장 안 함)
  const openRef = useRef(false);
  useEffect(() => { openRef.current = open; }, [open]);

  const reset = () => { setStep(0); setAge(""); setGender(""); setReasons([]); setOther(""); setHint(""); };

  const show = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    if (!p || openRef.current) return;
    // 공유 시트 · 로그인 창이 떠 있으면 이번에는 안 띄움 (노출로 안 셈)
    if (document.querySelector(".modal-back")) return;
    const internal = isInternal();
    const s = internal ? mem.current.shows : readShows();
    const next: Shows = { n: s.n + 1, at: p.count };
    if (internal) mem.current.shows = next;
    else store.set(SK.shows, JSON.stringify(next));
    view.current = { showIndex: next.n, count: p.count, mode: p.mode, at: Date.now() };
    setOrder(reasonOrder());
    reset();
    setOpen(true);
    track("survey_view", { survey_id: SURVEY_ID, show_index: next.n, result_count: p.count, mode: p.mode }, 5);
  }, []);

  useEffect(() => {
    const onResult = (e: Event) => {
      const d = (e as CustomEvent<ResultDetail>).detail;
      clearTimeout(timer.current);
      pending.current = null;
      if (!d || d.viewer) return;
      const internal = isInternal();
      if (d.mock && !internal) return;
      const guest = d.mode === "challenge_guest";
      if (internal) {
        const m = mem.current;
        m.count += 1;
        if (!m.done && (m.shows.n === 0 || due(m.count, m.shows, guest))) pending.current = { count: m.count, mode: d.mode };
        return;
      }
      if (!store.ok()) return; // 저장소를 못 쓰면 설문 안 띄움
      const count = (Number(store.get(SK.count)) || 0) + 1;
      store.set(SK.count, String(count));
      if (store.get(SK.done) === "1") return;
      if (due(count, readShows(), guest)) pending.current = { count, mode: d.mode };
    };
    const onTipsClosed = () => {
      if (!pending.current || openRef.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(show, SURVEY_DELAY_MS);
    };
    const onLeave = () => {
      clearTimeout(timer.current);
      pending.current = null;
    };
    window.addEventListener(RESULT_EVENT, onResult);
    window.addEventListener(TIPS_CLOSED_EVENT, onTipsClosed);
    window.addEventListener(RESULT_LEAVE_EVENT, onLeave);
    return () => {
      window.removeEventListener(RESULT_EVENT, onResult);
      window.removeEventListener(TIPS_CLOSED_EVENT, onTipsClosed);
      window.removeEventListener(RESULT_LEAVE_EVENT, onLeave);
      clearTimeout(timer.current);
    };
  }, [show]);

  const close = useCallback(() => {
    const answered: Record<string, unknown> = {};
    if (age) answered.age = age;
    if (gender) answered.gender = gender;
    if (reasons.length) answered.reasons = reasons;
    track("survey_close", { survey_id: SURVEY_ID, show_index: view.current.showIndex, last_question: step + 1, answered_so_far: answered }, 5);
    setOpen(false);
    reset();
  }, [age, gender, reasons, step]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  const submit = (revisit: string) => {
    const hasOther = reasons.includes(OTHER.v);
    track("survey_submit", {
      survey_id: SURVEY_ID,
      show_index: view.current.showIndex,
      result_count: view.current.count,
      mode: view.current.mode,
      age,
      gender,
      reasons,
      reasons_other: hasOther ? other.trim().slice(0, SURVEY_OTHER_MAX) || null : null,
      revisit,
      option_order: order,
      seconds_to_submit: Math.round((Date.now() - view.current.at) / 1000),
    }, 5);
    if (isInternal()) mem.current.done = true;
    else store.set(SK.done, "1");
    setOpen(false);
    reset();
    setToast(true);
    setTimeout(() => setToast(false), 2000);
  };

  const toggleReason = (v: string) => {
    if (reasons.includes(v)) { setReasons(reasons.filter((x) => x !== v)); setHint(""); return; }
    if (reasons.length >= SURVEY_MAX_REASONS) {
      setHint("2개까지 고를 수 있어요");
      setTimeout(() => setHint(""), 1600);
      return;
    }
    setReasons([...reasons, v]);
    setHint("");
  };

  if (toast) return <p className="survey-toast" role="status">고마워요! 한 판 더? 👕</p>;
  if (!open) return null;

  const reasonOpts = [...order.map((v) => REASONS.find((r) => r.v === v)!).filter(Boolean), OTHER];
  const q3Ready = reasons.length >= 1 && reasons.length <= SURVEY_MAX_REASONS && (!reasons.includes(OTHER.v) || other.trim().length > 0);

  const pickOne = (opts: { v: string; t: string }[], value: string, onPick: (v: string) => void) => (
    <div className="survey-opts">
      {opts.map((o) => (
        <button key={o.v} type="button" className={"btn98 survey-opt" + (value === o.v ? " on" : "")} onClick={() => onPick(o.v)}>{o.t}</button>
      ))}
    </div>
  );

  return (
    <div className="survey-back" onClick={(e) => e.target === e.currentTarget && close()}>
      <section className="win98 survey" role="dialog" aria-modal="true" aria-label="설문">
        <div className="titlebar">
          <span className="name">설문.exe</span>
          <button type="button" className="survey-later" onClick={close}>나중에</button>
        </div>
        <div className="winbody">
          <div className="survey-dots" aria-label={`${step + 1} / 4`}>
            {[0, 1, 2, 3].map((i) => <span key={i} className={i <= step ? "on" : ""}>{i <= step ? "●" : "○"}</span>)}
          </div>

          {step === 0 && (
            <>
              <p className="survey-lead">4개만 물어볼게요 (30초)<br /><small>둘이 같이 했다면 폰 주인 기준으로 답해 주세요</small></p>
              <h3 className="survey-q">Q1. 나이대가 어떻게 되세요?</h3>
              {pickOne(AGES, age, (v) => { setAge(v); setStep(1); })}
            </>
          )}

          {step === 1 && (
            <>
              <h3 className="survey-q">Q2. 성별을 알려주세요</h3>
              {pickOne(GENDERS, gender, (v) => { setGender(v); setStep(2); })}
            </>
          )}

          {step === 2 && (
            <>
              <h3 className="survey-q">Q3. 옷빨 배틀을 해본 이유는? <small>(최대 2개)</small></h3>
              <div className="survey-opts">
                {reasonOpts.map((o) => (
                  <button key={o.v} type="button" aria-pressed={reasons.includes(o.v)} className={"btn98 survey-opt" + (reasons.includes(o.v) ? " on" : "")} onClick={() => toggleReason(o.v)}>
                    {reasons.includes(o.v) ? "☑ " : "☐ "}{o.t}
                  </button>
                ))}
              </div>
              {reasons.includes(OTHER.v) && (
                <input className="survey-other" value={other} maxLength={SURVEY_OTHER_MAX} onChange={(e) => setOther(e.target.value)} placeholder="이유를 적어 주세요 (30자)" aria-label="기타 이유" autoFocus />
              )}
              {hint && <p className="survey-hint" role="status">{hint}</p>}
              <button type="button" className="btn98 survey-next" disabled={!q3Ready} onClick={() => setStep(3)}>다음 ▶</button>
            </>
          )}

          {step === 3 && (
            <>
              <h3 className="survey-q">Q4. 다음에 또 할 것 같나요?</h3>
              {pickOne(REVISIT, "", submit)}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
