"use client";

import { useEffect, useState } from "react";
import { initBattle, type RoomInfo } from "@/lib/battle-client";
import type { BattleResult } from "@/lib/rubric";
import ShareSheet from "./ShareSheet";
import SurveyCard from "./SurveyCard";

// 화면 뼈대는 프로토타입 그대로. 동작은 lib/battle-client.ts 가 붙인다.
type Props = {
  loggedIn: boolean;
  inviteCode?: string | null;
  /** 링크 대결방 코드 (/r/<코드> 화면) */
  room?: string;
  /** 방금 만든 방이면 도전장 공유창을 바로 띄움 */
  roomNew?: boolean;
};

export default function Battle({ loggedIn, inviteCode, room, roomNew }: Props) {
  const [shareItem, setShareItem] = useState<{ result: BattleResult; photo: Blob | null } | null>(null);
  const [roomInfo, setRoomInfo] = useState<RoomInfo | null>(null);
  const [inviting, setInviting] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(
    () => initBattle({
      loggedIn,
      room,
      onShare: (result, photo) => setShareItem({ result, photo }),
      onRoom: (info) => {
        setRoomInfo(info);
        if (info.status !== "waiting") setInviting(false); // 결과 뜨면 도전장 공유창은 닫기
        // 방금 만든 도전장이면 공유창 바로 열기 (새로고침해도 다시 안 열리게 주소에서 new 빼기)
        if (roomNew && info.role === "host" && info.status === "waiting") {
          setInviting(true);
          window.history.replaceState(null, "", window.location.pathname);
        }
      },
    }),
    [loggedIn, room, roomNew],
  );

  // 로그인했으면 내 초대 코드를 붙여서, 링크로 들어온 사람이 로그인하면 바로 친구가 되게
  const shareUrl = origin + (inviteCode ? `/?ref=${inviteCode}` : "/");
  const roomUrl = room ? origin + `/r/${room}` + (inviteCode ? `?ref=${inviteCode}` : "") : "";
  const hostWaiting = roomInfo?.role === "host" && roomInfo.status === "waiting";

  return (
    <>
      <main className="arena" id="arena">
        <button className="vs" id="btn-start" type="button" disabled aria-label="배틀 시작">VS</button>
        {(["p1", "p2"] as const).map((side) => (
          <section key={side} className={`win98 ${side}`} id={`panel-${side}`} aria-label={side === "p1" ? "1P" : "2P"}>
            <div className="titlebar">
              <span className="name" id={`title-${side}`}>{side === "p1" ? "1P_내코디.jpg - 그림판" : "2P_상대코디.jpg - 그림판"}</span>
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
              <div className="btnrow" id={`btns-${side}`}>
                <label className="btn98">📸 찍기<input type="file" className="file-overlay" accept="image/*" capture="environment" data-side={side} aria-label="카메라로 찍기" /></label>
                <label className="btn98">🖼 앨범<input type="file" className="file-overlay" accept="image/*" data-side={side} aria-label="앨범에서 고르기" /></label>
              </div>
            </div>
          </section>
        ))}
      </main>

      <div className="status" id="status" aria-live="polite">{room ? "도전장 여는 중…" : "사진 두 장 올리고 START 누르셈"}</div>

      <div className="roast" id="roast" hidden aria-live="polite">
        <span className="roast-label" id="roast-label">AI 한줄평</span>
        <p className="roast-text" id="roast-text" />
        <p className="praise" id="praise" />
      </div>

      <SurveyCard />

      {/* 점수 올리는 법: 결과가 뜨면 바로 보이고, x 로 닫으면 아래 📏 버튼으로 다시 열 수 있음 (lib/battle-client.ts showTips) */}
      <section className="win98 tips" id="tips" hidden aria-label="점수 올리는 법">
        <div className="titlebar">
          <span className="name">점수올리는법.exe</span>
          <button type="button" className="tips-x" id="tips-close" aria-label="점수 올리는 법 닫기">x</button>
        </div>
        <div className="winbody" id="tips-body" />
      </section>

      <div className="controls">
        {!room && (
          <button className="bigbtn pink" type="button" id="btn-challenge" title="1P 칸에 내 코디 올리고 누르면, 친구가 자기 폰에서 2P로 붙을 수 있는 링크가 만들어짐">
            🔗 도전장 보내기 <small>(친구는 자기 폰으로)</small>
          </button>
        )}
        {hostWaiting && (
          <button className="bigbtn pink" type="button" onClick={() => setInviting(true)}>📨 도전장 다시 보내기</button>
        )}
        <button className="bigbtn pink" type="button" id="btn-share" hidden>📤 결과 공유</button>
        <button className="bigbtn plain" type="button" id="btn-copy" hidden>📋 한줄평 복사</button>
        <button className="bigbtn plain" type="button" id="btn-tips" hidden>📏 점수 올리는 법</button>
        <button className="bigbtn plain" type="button" id="btn-reset">{room ? "🏠 새 판 하러 가기" : "🗑 새 판"}</button>
        <button className="bigbtn plain" type="button" id="btn-sound" aria-pressed="true">🔊 소리 ON</button>
      </div>


      {inviting && roomUrl && roomInfo && (
        <ShareSheet
          title="도전장.exe"
          lead="이 링크 받은 친구가 자기 폰에서 사진 올리면 이 화면에 바로 결과 뜸"
          text={`[옷빨 배틀] ${roomInfo.hostName} 님이 옷빨 배틀 신청함 ㅋㅋ 링크 열고 네 코디 올려서 붙어봐`}
          url={roomUrl}
          card={{ kind: "invite", url: roomUrl, inviter: roomInfo.hostName }}
          onClose={() => setInviting(false)}
          context="challenge"
        />
      )}

      {shareItem && origin && (
        <ShareSheet
          title="결과공유.exe"
          lead={shareItem.result.winner === "p1" ? "이겼다 ㅋㅋ 자랑 ㄱㄱ" : "졌지만 공유하면 친구도 당할 수 있음 ㅋ"}
          text={`[옷빨 배틀] 나 ${shareItem.result.p1.total}점 vs 상대 ${shareItem.result.p2.total}점 — ${shareItem.result.winner === "p1" ? "내가 이김 👑" : shareItem.result.roast} 너도 붙어볼래?`}
          url={shareUrl}
          card={{ kind: "result", url: shareUrl, result: shareItem.result, photo: shareItem.photo }}
          onClose={() => setShareItem(null)}
          context="result"
          logProps={{ me_won: shareItem.result.winner === "p1", roast_style: shareItem.result.roastStyle ?? null, mode: room ? "challenge" : "local" }}
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
