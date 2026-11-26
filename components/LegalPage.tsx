import Link from "next/link";
import { CONTACT_EMAIL } from "@/lib/legal";

// 개인정보처리방침·이용약관 공통 틀 (윈98 창 하나에 본문)
export default function LegalPage({ title, file, effective, children }: { title: string; file: string; effective: string; children: React.ReactNode }) {
  return (
    <div className="wrap">
      <nav className="topbar" aria-label="상단 메뉴">
        <div className="left"><Link className="chip" href="/">◀ 배틀하러 가기</Link></div>
        <div className="right legal-switch">
          <Link className="chip" href="/privacy">개인정보처리방침</Link>
          <Link className="chip" href="/terms">이용약관</Link>
        </div>
      </nav>
      <section className="win98 legal" aria-label={title}>
        <div className="titlebar"><span className="name">{file}</span><span className="tb-btns" aria-hidden="true"><i>_</i><i>□</i><i>x</i></span></div>
        <div className="winbody">
          <h1>{title}</h1>
          <p className="legal-date">시행일: {effective}</p>
          {children}
        </div>
      </section>
    </div>
  );
}

export function Contact() {
  return CONTACT_EMAIL ? <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> : <span>(문의 이메일 준비 중)</span>;
}
