// 1차 설문 설정 (docs/survey-otbbal.md). 응답이 너무 적거나 많으면 여기 숫자만 바꾼다.
// 이벤트 이름 · 저장 값은 돌수제비 설문과 맞춰 둔 것이라 바꾸지 않는다.

export const SURVEY_EVERY_N_RESULTS = 2; // 몇 번째 결과마다 띄울지 (보통)
export const SURVEY_GUEST_FIRST = true; // 도전장 게스트는 첫 결과에서 띄울지
export const SURVEY_MAX_SHOWS = 3; // 최대 몇 번까지 띄울지
export const SURVEY_DELAY_MS = 1500; // 점수 올리는 법 창을 닫고 몇 ms 뒤에 띄울지
export const SURVEY_ID = "otbbal_s1_v1"; // 설문 버전 (문항이 바뀌면 올린다)

export const SURVEY_MAX_REASONS = 2;
export const SURVEY_OTHER_MAX = 30;

// battle-client.ts → SurveyCard.tsx 신호
export const RESULT_EVENT = "ootd:result"; // 결과가 화면에 뜸 { mode, mock, viewer }
export const TIPS_CLOSED_EVENT = "ootd:tips-closed"; // 📏 점수 올리는 법 창을 x 로 닫음
export const RESULT_LEAVE_EVENT = "ootd:result-leave"; // AGAIN · 새 판 · 공유로 결과 화면을 떠남
export type ResultDetail = { mode: string; mock: boolean; viewer: boolean };

// localStorage 키
export const SK = {
  count: "otbbal_result_count", // 누적 결과 횟수
  shows: "otbbal_survey_shows", // 노출 횟수 {"n": 몇 번 떴나, "at": 마지막으로 뜬 때의 누적 결과 횟수}
  done: "otbbal_survey_done", // 제출했으면 "1"
  order: "otbbal_survey_order", // Q3 보기 순서
} as const;

export const AGES = [
  { v: "10s", t: "10대" },
  { v: "20s_early", t: "20대 초반" },
  { v: "20s_late", t: "20대 후반" },
  { v: "30s", t: "30대" },
  { v: "40s_plus", t: "40대 이상" },
];
export const GENDERS = [
  { v: "female", t: "여성" },
  { v: "male", t: "남성" },
  { v: "no_answer", t: "응답하지 않음" },
];
/** Q3 보기 8개. 사람마다 섞어서 보여 주고, "기타"(other)는 항상 맨 아래 */
export const REASONS = [
  { v: "my_score", t: "내 옷이 몇 점인지 궁금해서" },
  { v: "friend_compete", t: "친구랑 누가 옷 잘 입는지 겨루려고" },
  { v: "roast_fun", t: "한줄평(놀리기)이 웃겨 보여서" },
  { v: "outfit_pick", t: "오늘 뭐 입을지 두 벌 중에 고르려고" },
  { v: "style_check", t: "코디 실력을 확인하고 싶어서" },
  { v: "promo", t: "홍보 글·영상이 재밌어 보여서" },
  { v: "ranking", t: "랭킹에 오르고 싶어서" },
  { v: "bored", t: "심심해서" },
];
export const OTHER = { v: "other", t: "기타 (직접 입력)" };
export const REVISIT = [
  { v: "today", t: "오늘 또 할 것 같다" },
  { v: "few_days", t: "며칠 안에 또 할 것 같다" },
  { v: "maybe", t: "생각나면 할 수도 있다" },
  { v: "never", t: "다시 안 할 것 같다" },
];
