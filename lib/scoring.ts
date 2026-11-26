import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { RUBRIC, type Score } from "./rubric";

// 한줄평(조롱) 말투·규칙·검사는 조롱 LLM 모듈(lib/roaster.ts)이 담당한다
export { FAVORITES, pick } from "./roaster";
import { FAVORITES, pick, pickStyle, roastRules, roasterSystem, SAFETY, type Style } from "./roaster";

const rubricText = () =>
  RUBRIC.map((c) => `- ${c.key} (${c.name}):\n` + c.anchors.map(([p, d]) => `    ${p}점 = ${d}`).join("\n")).join("\n");

function scorePrompt(style: Style) {
  return [
    "너는 패션 배틀 게임 \"옷빨 배틀\"의 채점 엔진이다.",
    "사진 1장의 옷차림만 아래 고정 기준표로 채점한다.",
    "같은 사진은 언제 채점해도 같은 점수가 나와야 한다. 기분이나 비교 대상이 아니라 기준표 설명에 가장 가까운 점수를 고른다.",
    "",
    "[고정 기준표] 항목마다 0~25 정수.",
    rubricText(),
    "채점 규칙:",
    "- 설명 두 개 사이에 걸치면 그 사이 정수로 주되, 애매하면 낮은 쪽.",
    "- 사진에 옷차림이 거의 안 보이면 모든 항목 0~3.",
    SAFETY,
    "",
    "nickname: 이 코디를 요약한 웃긴 별명, 12자 이내. (예: \"회색후드 재수생\", \"올블랙 저승사자\")",
    "praise: 이 코디가 배틀에서 이겼을 때 줄 한마디. 칭찬인데 은근 약 올리는 말투, 15자 이내.",
    "roast: 이 코디가 배틀에서 졌을 때 남길 한줄평.",
    roastRules(style),
  ].join("\n");
}

// ---------- 응답 모양 (구조화 출력) ----------
const SCORE_SCHEMA = {
  type: "object",
  properties: {
    color: { type: "integer" },
    fit: { type: "integer" },
    harmony: { type: "integer" },
    trend: { type: "integer" },
    nickname: { type: "string" },
    praise: { type: "string" },
    roast: { type: "string" },
  },
  required: ["color", "fit", "harmony", "trend", "nickname", "praise", "roast"],
  additionalProperties: false,
} as const;

const ROAST_SCHEMA = {
  type: "object",
  properties: { roast: { type: "string" } },
  required: ["roast"],
  additionalProperties: false,
} as const;

export class ScoringError extends Error {
  constructor(public code: "refused" | "rate_limited" | "invalid_json" | "not_configured" | "upstream") {
    super(code);
  }
}

const int25 = (v: unknown) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(25, Math.max(0, n)) : 0;
};
export const clip = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

function toScore(d: Record<string, unknown>): Score {
  const s = { color: int25(d.color), fit: int25(d.fit), harmony: int25(d.harmony), trend: int25(d.trend) };
  return { ...s, total: s.color + s.fit + s.harmony + s.trend, nickname: clip(d.nickname, 20), praise: clip(d.praise, 40) };
}

// ---------- 모델 호출 ----------
export const SCORE_MODEL = process.env.SCORE_MODEL?.trim() || "claude-opus-5-5";
// 서버 쪽 대체 모델(거절 시 자동 재시도)은 Opus·Fable·Sonnet 5.5 계열만 지원한다
// 조롱 LLM 전용 호출(AGAIN 다시 뽑기·저장된 사진) 모델. 비우면 채점 모델과 같음
export const ROAST_MODEL = process.env.ROAST_MODEL?.trim() || SCORE_MODEL;
const supportsFallback = (model: string) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(model);

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic());

// 값 앞뒤 공백·따옴표, true/yes/on 도 켜짐으로 본다
const mockFlag = () => ["1", "true", "yes", "on"].includes((process.env.MOCK_SCORING ?? "").trim().replace(/^["']|["']$/g, "").toLowerCase());

export const isMock = () =>
  mockFlag() || (!process.env.ANTHROPIC_API_KEY?.trim() && process.env.NODE_ENV !== "production");

// 배포 상태 확인용 (비밀 값은 내보내지 않음)
export const scoringMode = (): "mock" | "live" | "not_configured" =>
  isMock() ? "mock" : process.env.ANTHROPIC_API_KEY?.trim() ? "live" : "not_configured";

async function askJson(system: string, jpeg: Buffer, schema: object, maxTokens: number, model = SCORE_MODEL): Promise<Record<string, unknown>> {
  if (!process.env.ANTHROPIC_API_KEY) throw new ScoringError("not_configured");
  let res;
  try {
    res = await anthropic().beta.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      output_config: { effort: "low", format: { type: "json_schema", schema: schema as Record<string, unknown> } },
      ...(supportsFallback(model) ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") } },
          { type: "text", text: "이 사진을 채점해서 JSON으로만 답해." },
        ],
      }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new ScoringError("rate_limited");
    if (e instanceof Anthropic.APIError) {
      console.error("Claude API error", e.status, e.message);
      throw new ScoringError("upstream");
    }
    throw e;
  }
  if (res.stop_reason === "refusal") throw new ScoringError("refused");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    const d = JSON.parse(text);
    if (!d || typeof d !== "object") throw new Error("not object");
    return d as Record<string, unknown>;
  } catch {
    throw new ScoringError("invalid_json");
  }
}

// 키 없이 화면을 시험할 때: 지문으로 정해지는 가짜 점수
function mockScore(hash: string): { score: Score; roast: string } {
  const n = (i: number) => 5 + (parseInt(hash.slice(i * 2, i * 2 + 2), 16) % 21);
  const s = { color: n(0), fit: n(1), harmony: n(2), trend: n(3) };
  return {
    score: { ...s, total: s.color + s.fit + s.harmony + s.trend, nickname: "테스트 코디 " + hash.slice(0, 3), praise: "(가짜 점수) 오 좀 치네" },
    roast: "(가짜 점수) " + pick(FAVORITES),
  };
}

export async function scorePhoto(jpeg: Buffer, hash: string): Promise<{ score: Score; roast: string }> {
  if (isMock()) return mockScore(hash);
  const d = await askJson(scorePrompt(pickStyle()), jpeg, SCORE_SCHEMA, 4000);
  return { score: toScore(d), roast: clip(d.roast, 90) };
}

export async function roastPhoto(jpeg: Buffer, me: Score, other: Score): Promise<string> {
  if (isMock()) return "(가짜 점수) " + pick(FAVORITES);
  const weakest = RUBRIC.reduce((m, c) => (me[c.key] < me[m.key] ? c : m), RUBRIC[0]).name;
  const d = await askJson(roasterSystem(pickStyle(), me.total, other.total, weakest), jpeg, ROAST_SCHEMA, 2000, ROAST_MODEL);
  return clip(d.roast, 90);
}
