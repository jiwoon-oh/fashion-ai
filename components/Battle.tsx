"use client";

import { useEffect, useRef, useState } from "react";
import { initBattle } from "@/lib/battle-client";
import type { BattleResult } from "@/lib/rubric";
import ShareSheet from "./ShareSheet";

const SHARE_PHOTO_KEY = "ootd-share-photo";

// 화면 뼈대는 프로토타입 그대로. 동작은 lib/battle-client.ts 가 붙인다.
export default function Battle({ loggedIn, inviteCode }: { loggedIn: boolean; inviteCode?: string | null }) {
  const [shareItem, setShareItem] = useState<{ result: BattleResult; photo: Blob | null } | null>(null);
  const [sharePhoto, setSharePhoto] = useState(true);
  const sharePhotoRef = useRef(true);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    try {
      const v = localStorage.getItem(SHARE_PHOTO_KEY);
      if (v === "0") { setSharePhoto(false); sharePhotoRef.current = false; }
    } catch { /* 기본값 사용 */ }
  }, []);
  const toggleShare = (v: boolean) => {
    setSharePhoto(v);
    sharePhotoRef.current = v;
    try { localStorage.setItem(SHARE_PHOTO_KEY, v ? "1" : "0"); } catch { /* 무시 */ }
  };

  useEffect(
    () => initBattle({ loggedIn, sharePhoto: () => sharePhotoRef.current, onShare: (result, photo) => setShareItem({ result, photo }) }),
    [loggedIn],
  );

  // 로그인했으면 내 초대 코드를 붙여서, 링크로 들어온 사람이 로그인하면 바로 친구가 되게
  const shareUrl = origin + (inviteCode ? `/?ref=${inviteCode}` : "/");

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

      {loggedIn && (
        <label className="share-toggle">
          <input type="checkbox" checked={sharePhoto} onChange={(e) => toggleShare(e.target.checked)} />
          친구한테 내 1P 사진이랑 점수 보여주기 <small>(끄면 점수만 보임 · 2P 사진은 저장 안 함)</small>
        </label>
      )}

      <div className="status" id="status" aria-live="polite">사진 두 장 올리고 START 누르셈</div>

      <div className="roast" id="roast" hidden aria-live="polite">
        <span className="roast-label" id="roast-label">AI 한줄평</span>
        <p className="roast-text" id="roast-text" />
        <p className="praise" id="praise" />
      </div>

      <div className="controls">
        <button className="bigbtn pink" type="button" id="btn-share" hidden>📤 결과 공유</button>
        <button className="bigbtn plain" type="button" id="btn-copy" hidden>📋 한줄평 복사</button>
        <button className="bigbtn plain" type="button" id="btn-reset">🗑 새 판</button>
        <button className="bigbtn plain" type="button" id="btn-sound" aria-pressed="true">🔊 소리 ON</button>
      </div>

      <footer>
        <span className="counter" id="counter">TOTAL BATTLE 000</span>
        <span className="note">
          채점할 때만 사진을 AI한테 보내고 버림. 얼굴·몸매는 안 보고 옷만 봄.
          {loggedIn
            ? " 1P가 내 사진으로 랭킹에 올라감. 위 체크를 켜면 1P 사진만 친구 공개용으로 저장됨 (친구 탭에서 언제든 삭제)."
            : " 로그인하면 1P 점수가 랭킹에 올라감."}
        </span>
      </footer>

      {shareItem && origin && (
        <ShareSheet
          title="결과공유.exe"
          lead={shareItem.result.winner === "p1" ? "이겼다 ㅋㅋ 자랑 ㄱㄱ" : "졌지만 공유하면 친구도 당할 수 있음 ㅋ"}
          text={`[옷빨 배틀] 나 ${shareItem.result.p1.total}점 vs 상대 ${shareItem.result.p2.total}점 — ${shareItem.result.winner === "p1" ? "내가 이김 👑" : shareItem.result.roast} 너도 붙어볼래?`}
          url={shareUrl}
          card={{ kind: "result", url: shareUrl, result: shareItem.result, photo: shareItem.photo }}
          onClose={() => setShareItem(null)}
        />
      )}
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
