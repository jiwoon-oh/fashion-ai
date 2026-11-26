"use client";

import { useEffect, useRef, useState } from "react";
import { KAKAO_JS_KEY, kakaoShare, preloadKakao } from "@/lib/kakao";
import { makeShareCard, type CardInput } from "@/lib/share-card";
import Modal from "./Modal";

type Props = {
  title: string; // 창 제목
  lead: string; // 창 안내 문구
  text: string; // 같이 보낼 문장
  url: string; // 보낼 링크
  card: CardInput; // 스토리용 이미지 내용
  onClose: () => void;
};

export default function ShareSheet({ title, lead, text, url, card, onClose }: Props) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<Promise<Blob> | null>(null);
  const getCard = () => (cardRef.current ??= makeShareCard(card));

  useEffect(() => {
    preloadKakao();
    getCard().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flash = (m: string) => { setNote(m); setTimeout(() => setNote(""), 3200); };
  const enc = encodeURIComponent;
  const open = (u: string) => window.open(u, "_blank", "noopener,noreferrer");

  const copy = async (msg = "✅ 복사됨! 붙여넣기 하면 돼") => {
    try { await navigator.clipboard.writeText(`${text}\n${url}`); flash(msg); }
    catch { flash("복사가 막힘 ㅠ 위 글을 길게 눌러서 복사해줘"); }
  };

  const kakao = async () => {
    if (!KAKAO_JS_KEY) return copy("카톡 공유 준비 전이라 링크를 복사했어 → 카톡 채팅방에 붙여넣기");
    await preloadKakao();
    const ok = kakaoShare({
      title: "옷빨 배틀",
      description: text,
      url,
      imageUrl: new URL("/og.png", window.location.origin).toString(),
      buttonTitle: card.kind === "result" ? "나도 붙어보기" : "배틀 하러 가기",
    });
    if (!ok) copy("카톡을 못 열었어 → 링크 복사했으니 카톡에 붙여넣기");
  };

  // 인스타·페북 스토리: 웹에서는 앱 스토리 화면을 직접 못 여니까, 카드 이미지를 폰 공유창으로 넘긴다
  const story = async (app: string) => {
    setBusy(true);
    try {
      const blob = await getCard();
      const file = new File([blob], "otbbal-battle.png", { type: "image/png" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: `${text} ${url}` });
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "otbbal-battle.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      flash(`이미지 저장함 → ${app} 앱에서 스토리 만들기로 올려줘`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) flash("이미지 만들다 삐끗함 ㅠ 다시 눌러줘");
    } finally {
      setBusy(false);
    }
  };

  const more = async () => {
    try { await navigator.share({ title: "옷빨 배틀", text, url }); }
    catch (e) { if (!(e instanceof DOMException && e.name === "AbortError")) copy(); }
  };

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Modal title={title} onClose={onClose}>
      <p>{lead}</p>
      <div className="share-grid">
        <button type="button" className="share-btn kakao" onClick={kakao}><b>💬</b>카카오톡</button>
        <button type="button" className="share-btn insta" onClick={() => story("인스타그램")} disabled={busy}><b>📸</b>인스타 스토리</button>
        <button type="button" className="share-btn fb" onClick={() => story("페이스북")} disabled={busy}><b>📖</b>페북 스토리</button>
        <button type="button" className="share-btn x" onClick={() => open(`https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`)}><b>𝕏</b>X(트위터)</button>
        <button type="button" className="share-btn fbpost" onClick={() => open(`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`)}><b>f</b>페이스북 글</button>
        <button type="button" className="share-btn threads" onClick={() => open(`https://www.threads.net/intent/post?text=${enc(`${text} ${url}`)}`)}><b>@</b>스레드</button>
        <button type="button" className="share-btn" onClick={() => copy()}><b>📋</b>링크 복사</button>
        {canNativeShare && <button type="button" className="share-btn" onClick={more}><b>📤</b>다른 앱</button>}
      </div>
      <div className="linkbox">{text}<br />{url}</div>
      <p className="share-hint">{note || "스토리는 폰에서 누르면 공유창이 떠. 거기서 인스타그램 → 스토리 고르면 끝!"}</p>
    </Modal>
  );
}
