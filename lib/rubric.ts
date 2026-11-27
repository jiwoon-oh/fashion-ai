// 고정 채점 기준표. 화면(막대 그래프)과 서버(프롬프트)가 같은 데이터를 쓴다.
export const RUBRIC_VERSION = "r2"; // r2 (2026-11-27): 점수 몰림 방지 규칙 추가 → 예전(r1) 저장 점수와 섞이지 않게

export type RubricKey = "color" | "fit" | "harmony" | "trend";

export const RUBRIC: { key: RubricKey; label: string; name: string; anchors: [number, string][] }[] = [
  { key: "color", label: "색감", name: "색 조합", anchors: [
    [25, "톤이 정리돼 있고 포인트 컬러가 의도적으로 1~2개"],
    [20, "전체가 잘 어울리고 거슬리는 색이 없음"],
    [15, "무난하지만 밋밋하거나 한 군데 살짝 어색"],
    [10, "색끼리 따로 놂. 어색한 조합이 눈에 띔"],
    [5, "색끼리 싸움. 보자마자 눈이 아픔"],
  ] },
  { key: "fit", label: "핏", name: "핏·실루엣", anchors: [
    [25, "옷 기장·품이 딱 맞고 실루엣 의도가 분명함"],
    [20, "대체로 잘 맞고 상하의 비율이 좋아 보임"],
    [15, "무난. 아이템 하나가 살짝 크거나 작음"],
    [10, "여러 군데 기장·품이 안 맞아 실루엣이 뭉개짐"],
    [5, "사이즈를 아예 잘못 산 옷이 대부분"],
  ] },
  { key: "harmony", label: "조화", name: "아이템 조화", anchors: [
    [25, "상하의·아우터·신발·소품이 한 콘셉트로 맞춰짐"],
    [20, "대부분 어울리고 신발·소품도 신경 씀"],
    [15, "기본 조합은 되는데 신발이나 소품이 따로 놂"],
    [10, "아이템끼리 장르가 충돌함 (예: 정장 + 등산화)"],
    [5, "아무거나 집어 입은 느낌"],
  ] },
  { key: "trend", label: "센스", name: "센스·트렌드", anchors: [
    [25, "요즘 감성 + 본인만의 포인트(레이어드·액세서리 등)"],
    [20, "트렌디하거나 개성 있는 디테일이 하나 이상"],
    [15, "무난한 데일리룩"],
    [10, "성의 없어 보이거나 철 지난 느낌"],
    [5, "잠옷·운동복 그대로 나온 느낌"],
  ] },
];

// 상위권 점수 보정 (2026-11-27): 작은 모델(Haiku)은 잘 입은 코디도 항목당 20~22점에서 멈춰서 합계가 84점을 잘 못 넘는다.
// 15점 이하는 그대로 두고 16점부터 위쪽을 1.4배로 늘린다 (20→22, 21→23, 22→25). 합계는 97점까지만.
// 예: 20/21/22/21 (84점) → 22/23/25/23 → 97점 넘지 않게 조정 → 93점
export const STRETCH_TOP = { from: 15, factor: 1.4, maxTotal: 97 };
export function stretchTop(s: { color: number; fit: number; harmony: number; trend: number }) {
  const f = (x: number) => (x <= STRETCH_TOP.from ? x : Math.min(25, Math.round(STRETCH_TOP.from + (x - STRETCH_TOP.from) * STRETCH_TOP.factor)));
  const out = { color: f(s.color), fit: f(s.fit), harmony: f(s.harmony), trend: f(s.trend) };
  const keys = ["color", "fit", "harmony", "trend"] as const;
  let total = out.color + out.fit + out.harmony + out.trend;
  while (total > STRETCH_TOP.maxTotal) {
    const k = keys.reduce((m, c) => (out[c] > out[m] ? c : m), keys[0]);
    out[k] -= 1; total -= 1;
  }
  return { ...out, total };
}

// 코디 무드 (분위기 종류). 두 사진 무드가 같으면 점수 차를 3~5점으로 좁혀 "아깝게" 지게 한다 (battle-core narrowGap)
export const MOODS = ["미니멀", "캐주얼", "스트릿", "포멀", "스포티", "빈티지", "러블리", "기타"] as const;

export type Score = {
  color: number;
  fit: number;
  harmony: number;
  trend: number;
  total: number;
  nickname: string;
  praise: string;
  /** 예전에 채점한 사진에는 없음 */
  mood?: string;
};

export type BattleResult = {
  p1: Score;
  p2: Score;
  winner: "p1" | "p2";
  loser: "p1" | "p2";
  roast: string;
  /** 한줄평 스타일 번호 (로그용). 예전 도전장 결과에는 없음 */
  roastStyle?: string;
  /** 무드가 같아서 점수 차를 좁혔으면 원래 점수 차 (로그용) */
  rawDiff?: number;
  cachedSides: { p1: boolean; p2: boolean };
  recorded: boolean; // 랭킹에 반영됨 (가짜 점수 판은 false)
  photoShared: boolean; // 1P 사진이 친구 공개용으로 저장됨
  mock: boolean;
  loggedIn: boolean;
};

// 동점이면 기준표 순서(색감 → 핏 → 조화 → 센스)로, 그래도 같으면 사진 지문으로 승자를 고정한다
export function decideWinner(a: Score, b: Score, ha: string, hb: string): "p1" | "p2" {
  if (a.total !== b.total) return a.total > b.total ? "p1" : "p2";
  for (const c of RUBRIC) if (a[c.key] !== b[c.key]) return a[c.key] > b[c.key] ? "p1" : "p2";
  return ha <= hb ? "p1" : "p2";
}
