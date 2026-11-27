"use client";

import { useEffect, useRef, useState } from "react";
import { KAKAO_JS_KEY, kakaoShare, preloadKakao } from "@/lib/kakao";
import { makeShareCard, type CardInput } from "@/lib/share-card";
import Modal from "./Modal";
import { shareGen, stage, track, withVia } from "@/lib/track";

type Props = {
  title: string; // 창 제목
  lead: string; // 창 안내 문구
  text: string; // 같이 보낼 문장
  url: string; // 보낼 링크
  card: CardInput; // 스토리용 이미지 내용
  onClose: () => void;
  /** 로그용: result = 결과 공유, challenge = 도전장, invite = 친구 초대 */
  context: "result" | "challenge" | "invite";
  /** 로그용: 공유 이벤트에 같이 남길 값 (me_won, roast_style 등) */
  logProps?: Record<string, unknown>;
};

export default function ShareSheet({ title, lead, text, url: baseUrl, card, onClose, context, logProps }: Props) {
  // 채널마다 링크에 via=<채널> 을 붙인다 → 그 링크로 들어온 사람은 로그에서 source "share"
  const url = baseUrl;
  const urlFor = (ch: string) => withVia(baseUrl, ch);
  const log = (channel: string) => {
    track("share", { channel, context, gen_out: shareGen(), ...logProps }, context === "result" ? 6 : null);
    if (context === "result") stage(6);
  };
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<Promise<Blob> | null>(null);
  const getCard = () => (cardRef.current ??= makeShareCard(card));

  const opened = useRef(false); // 개발 모드에서 effect 가 두 번 돌아도 한 번만 남기게
  useEffect(() => {
    if (!opened.current) { opened.current = true; track("share_open", { context, ...logProps }); }
    preloadKakao();
    getCard().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(""), 3200); };
  const enc = encodeURIComponent;
  const open = (u: string) => window.open(u, "_blank", "noopener,noreferrer");

  const copy = async (msg = "✅ 복사됨! 붙여넣기 하면 돼", ch = "copy_link") => {
    try { await navigator.clipboard.writeText(`${text}\n${urlFor(ch)}`); flash(msg); }
    catch { flash("복사가 막힘 ㅠ 위 글을 길게 눌러서 복사해줘"); }
  };

  const kakao = async () => {
    log("kakao");
    if (!KAKAO_JS_KEY) return copy("카톡 공유 준비 전이라 링크를 복사했어 → 카톡 채팅방에 붙여넣기", "kakao");
    await preloadKakao();
    const ok = kakaoShare({
      title: "옷빨 배틀",
      description: text,
      url: urlFor("kakao"),
      imageUrl: new URL("/og.png", window.location.origin).toString(),
      buttonTitle: card.kind === "result" ? "나도 붙어보기" : "배틀 하러 가기",
    });
    if (!ok) copy("카톡을 못 열었어 → 링크 복사했으니 카톡에 붙여넣기", "kakao");
  };

  // 인스타그램: 웹에서는 인스타 글쓰기·스토리 화면을 링크로 직접 여는 공식 방법이 없다.
  // 그래서 카드 이미지를 폰 공유창으로 넘기고(인스타 → 스토리/게시물/메시지 선택),
  // 같은 순간 링크를 복사해 둬서 스토리의 🔗 링크 스티커에 붙여넣게 한다.
  const [insta, setInsta] = useState<{ img: string; file: File; canShare: boolean } | null>(null);
  useEffect(() => () => { if (insta) URL.revokeObjectURL(insta.img); }, [insta]);

  const openInsta = async () => {
    log("insta_preview");
    setBusy(true);
    try {
      const blob = await getCard();
      const file = new File([blob], "otbbal-battle.png", { type: "image/png" });
      setInsta({ img: URL.createObjectURL(blob), file, canShare: !!navigator.canShare?.({ files: [file] }) });
    } catch {
      flash("이미지 만들다 삐끗함 ㅠ 다시 눌러줘");
    } finally {
      setBusy(false);
    }
  };

  const sendInsta = async () => {
    if (!insta) return;
    log("insta_send");
    navigator.clipboard?.writeText(urlFor("insta")).catch(() => {}); // 링크 스티커에 붙여넣을 링크
    if (insta.canShare) {
      try {
        await navigator.share({ files: [insta.file] });
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) flash("공유창을 못 열었어 ㅠ 이미지 길게 눌러 저장해서 올려줘");
      }
      return;
    }
    flash("이 브라우저는 인스타로 바로 못 넘김 → 폰의 크롬·사파리에서 열어줘 (링크는 복사해 둠)");
  };

  const saveImage = () => {
    if (!insta) return;
    log("insta_save");
    navigator.clipboard?.writeText(urlFor("insta")).catch(() => {});
    const a = document.createElement("a");
    a.href = insta.img;
    a.download = "otbbal-battle.png";
    a.click();
  };

  const more = async () => {
    log("native");
    try { await navigator.share({ title: "옷빨 배틀", text, url: urlFor("native") }); }
    catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) copy(undefined, "native"); }
  };

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  if (insta) {
    return (
      <Modal title="인스타그램.exe" onClose={onClose}>
        <div className="insta-preview">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={insta.img} alt="인스타에 올라갈 카드 이미지 미리보기" />
        </div>
        <ol className="insta-steps">
          <li><b>📲 인스타에 올리기</b> → 공유창에서 <b>Instagram</b> → <b>스토리</b>(또는 게시물·메시지)</li>
          <li>링크는 자동 복사됨 → 스토리 화면 위쪽 <b>스티커 → 🔗 링크 → 붙여넣기</b> 하면 눌러서 바로 들어옴</li>
        </ol>
        <div className="btnrow">
          <button type="button" className="btn98 insta-go" onClick={sendInsta}>📲 인스타에 올리기</button>
          <button type="button" className="btn98" onClick={() => setInsta(null)}>◀ 뒤로</button>
        </div>
        {!insta.canShare && (
          <p className="share-hint">
            지금 브라우저(PC나 카톡·인스타 안 브라우저)는 인스타로 바로 못 넘겨. 폰의 크롬·사파리로 열거나,{" "}
            <button type="button" className="linkish plain" onClick={saveImage}>이미지만 저장</button>해서 직접 올려줘.
          </p>
        )}
        {note && <p className="share-hint">{note}</p>}
        <p className="legal-consent">인스타 게시물 글에서는 링크가 안 눌려서 스토리 + 링크 스티커가 제일 잘 먹힘</p>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p>{lead}</p>
      <div className="share-grid">
        <button type="button" className="share-btn kakao" onClick={kakao}><b>💬</b>카카오톡</button>
        <button type="button" className="share-btn insta" onClick={openInsta} disabled={busy}><b>📸</b>인스타그램</button>
        <button type="button" className="share-btn threads" onClick={() => { log("threads"); open(`https://www.threads.net/intent/post?text=${enc(`${text} ${urlFor("threads")}`)}`); }}><b>@</b>스레드</button>
        <button type="button" className="share-btn x" onClick={() => { log("x"); open(`https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(urlFor("x"))}`); }}><b>𝕏</b>X(트위터)</button>
        <button type="button" className="share-btn fb" onClick={() => { log("facebook"); open(`https://www.facebook.com/sharer/sharer.php?u=${enc(urlFor("facebook"))}`); }}><b>f</b>페이스북</button>
        <button type="button" className="share-btn" onClick={() => { log("copy_link"); copy(); }}><b>📋</b>링크 복사</button>
        {canNativeShare && <button type="button" className="share-btn" onClick={more}><b>📤</b>다른 앱</button>}
      </div>
      <div className="linkbox">{text}<br />{url}</div>
      <p className="share-hint">{note || "카톡·스레드·X·페북은 링크로 올라가서 누르면 바로 들어옴. 인스타는 카드 이미지 + 링크 스티커"}</p>
    </Modal>
  );
}
