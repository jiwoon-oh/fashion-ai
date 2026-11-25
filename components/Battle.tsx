"use client";

import { useEffect } from "react";
import { initBattle } from "@/lib/battle-client";

// 화면 뼈대는 프로토타입 그대로. 동작은 lib/battle-client.ts 가 붙인다.
export default function Battle({ loggedIn }: { loggedIn: boolean }) {
  useEffect(() => initBattle({ loggedIn }), [loggedIn]);

  return (
    <>
      <main className="arena" id="arena">
        <button className="vs" id="btn-start" type="button" disabled aria-label="배틀 시작">VS</button>
        {(["p1", "p2"] as const).map((side) => (
          <section key={side} className={`win98 ${side}`} id={`panel-${side}`} aria-label={side === "p1" ? "1P" : "2P"}>
            <div className="titlebar">
              <span className="name">{side === "p1" ? "1P_내코디.jpg - 그림판" : "2P_상대코디.jpg - 그림판"}</span>
              <span className="tb-btns" aria-hidden="true"><i>_</i><i>□</i><i>x</i></span>
            </div>
            <div className="winbody">
              <div className="slot-drop" id={`drop-${side}`}>
                <div className="slot-media" id={`media-${side}`}>
                  <Placeholder side={side} />
                </div>
                <input type="file" className="file-overlay" accept="image/*" data-side={side} aria-label={`${side === "p1" ? "1P" : "2P"} 사진 올리기`} />
              </div>
              <div className="nick" id={`nick-${side}`} />
              <div className="bars" id={`bars-${side}`} hidden />
              <div className="btnrow">
                <label className="btn98">📸 찍기<input type="file" className="file-overlay" accept="image/*" capture="environment" data-side={side} aria-label="카메라로 찍기" /></label>
                <label className="btn98">🖼 앨범<input type="file" className="file-overlay" accept="image/*" data-side={side} aria-label="앨범에서 고르기" /></label>
              </div>
            </div>
          </section>
        ))}
      </main>

      <div className="status" id="status" aria-live="polite">사진 두 장 올리고 START 누르셈</div>

      <div className="roast" id="roast" hidden aria-live="polite">
        <span className="roast-label" id="roast-label">AI 한줄평</span>
        <p className="roast-text" id="roast-text" />
        <p className="praise" id="praise" />
      </div>

      <div className="controls">
        <button className="bigbtn pink" type="button" id="btn-copy" hidden>📋 한줄평 복사</button>
        <button className="bigbtn plain" type="button" id="btn-reset">🗑 새 판</button>
        <button className="bigbtn plain" type="button" id="btn-sound" aria-pressed="true">🔊 소리 ON</button>
      </div>

      <footer>
        <span className="counter" id="counter">TOTAL BATTLE 000</span>
        <span className="note">
          사진은 저장 안 함. 채점할 때만 AI한테 보내고 버림 (점수만 남음). 얼굴·몸매는 안 보고 옷만 봄.
          {loggedIn ? " 1P가 내 사진으로 랭킹에 올라감." : " 로그인하면 1P 점수가 랭킹에 올라감."}
        </span>
      </footer>
    </>
  );
}

export function Placeholder({ side }: { side: "p1" | "p2" }) {
  return (
    <div className="placeholder">
      <b>{side === "p1" ? "1P" : "2P"}</b>
      {side === "p1" ? <>여기다 내 코디 사진<br />던지셈</> : <>상대 코디 사진<br />여기 ㄱ</>}
      <small>탭하면 찍기·앨범 / 끌어다 놓기 OK</small>
    </div>
  );
}
