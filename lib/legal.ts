// 개인정보처리방침·이용약관에 들어가는 운영자 정보.
// 이름·이메일은 코드에 박지 않고 Vercel 환경변수(Config)로 넣는다:
//   NEXT_PUBLIC_OPERATOR_NAME   개인정보 보호책임자(운영자) 이름 또는 팀 이름
//   NEXT_PUBLIC_CONTACT_EMAIL   문의·삭제 요청 받을 이메일
//   NEXT_PUBLIC_DB_REGION       Supabase 프로젝트 서버 지역 (예: "대한민국 서울", "일본 도쿄", "미국")

export const SERVICE = "옷빨 배틀";
export const OPERATOR = process.env.NEXT_PUBLIC_OPERATOR_NAME?.trim() || "옷빨 배틀 운영자";
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || "";
export const DB_REGION = process.env.NEXT_PUBLIC_DB_REGION?.trim() || "Supabase 프로젝트 서버 지역";

// 내용을 바꾸면 날짜도 바꾸고, 바뀐 내용을 공지한다
export const PRIVACY_EFFECTIVE = "2026년 11월 26일";
export const TERMS_EFFECTIVE = "2026년 11월 26일";
