"use client";

import { useEffect } from "react";

export default function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <section className="win98 modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="titlebar">
          <span className="name">{title}</span>
          <span className="tb-btns"><button type="button" onClick={onClose} aria-label="닫기"><i>x</i></button></span>
        </div>
        <div className="winbody">{children}</div>
      </section>
    </div>
  );
}
