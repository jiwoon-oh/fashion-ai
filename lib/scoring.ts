import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { MOODS, RUBRIC, stretchTop, type Score } from "./rubric";

// 한줄평(조롱) 말투·규칙·검사는 조롱 LLM 모듈(lib/roaster.ts)이 담당한다
export { FAVORITES, pick } from "./roaster";
import { fallbackRoast, guardRoast, hasBannedWord, MEME_RATE, pickStyle, roastRules, roasterSystem, SAFETY, styleKey, type Style } from "./roaster";

const rubricText = () =>
  RUBRIC.map((c) => `- ${c.key} (${c.name}):\n` + c.anchors.map(([p, d]) => `    ${p}점 = ${d}`).join("\n")).join("\n");

function scorePrompt(style: Style, recent: string[], memeTurn?: boolean) {
  return [
    "너는 패션 배틀 게임 \"옷빨 배틀\"의 채점 엔진이다.",
    "사진 1장의 옷차림만 아래 고정 기준표로 채점한다.",
    "같은 사진은 언제 채점해도 같은 점수가 나와야 한다. 기분이나 비교 대상이 아니라 기준표 설명에 가장 가까운 점수를 고른다.",
    "",
    "[고정 기준표] 항목마다 0~25 정수.",
    rubricText(),
    "채점 규칙:",
    "- 먼저 look 에 사진 속 옷을 사실대로 한 줄 적고(아이템·색·핏), 그걸 근거로 항목을 하나씩 따로 채점한다.",
    "- 20점은 기본값이 아니다. 평범한 일상 사진은 항목당 12~17점이 보통이고, 20점 이상은 그 설명에 분명히 들어맞을 때만 준다.",
    "- 잘 입은 코디(색·핏·조화가 다 정리되고 포인트가 있는, 화보·쇼핑몰 모델 수준)는 망설이지 말고 항목당 22~25점을 준다. 이런 코디의 합계는 85~97점이 정상이다. 확실히 별로면 5~10점.",
    "- 합계 기준(참고): 망한 코디 20~45 / 아쉬운 코디 45~60 / 평범한 데일리 60~75 / 잘 입은 코디 75~88 / 아주 잘 입은 코디 89~97. 100점 만점은 거의 주지 않는다.",
    "- 점수 폭을 넓게 써서 코디끼리 차이가 드러나게 한다.",
    "- 5점 단위로만 고르지 말고 13, 17, 22 같은 중간 정수를 적극적으로 쓴다. 설명 두 개 사이에 걸치면 그 사이 정수, 애매하면 낮은 쪽.",
    "- 네 항목이 모두 같은 점수가 나오면 다시 본다. 보통은 잘한 항목과 못한 항목이 섞여 있다.",
    "- 사진에 옷차림이 거의 안 보이면 모든 항목 0~3.",
    SAFETY,
    "",
    `mood: 이 코디의 분위기 종류 하나. ${MOODS.join(" / ")} 중에서 고른다. 애매하면 가장 가까운 것, 정말 모르겠으면 기타.`,
    "nickname: 이 코디를 요약한 웃긴 별명, 12자 이내. (예: \"회색후드 재수생\", \"올블랙 저승사자\")",
    "praise: 이 코디가 배틀에서 이겼을 때 줄 한마디. 칭찬인데 은근 약 올리는 말투, 15자 이내. 옷과 안목만 말하고 얼굴·몸은 언급하지 않는다.",
    "roast: 이 코디가 배틀에서 졌을 때 남길 한줄평.",
    roastRules(style, recent, memeTurn),
  ].join("\n");
}

// ---------- 응답 모양 (구조화 출력) ----------
const SCORE_SCHEMA = {
  type: "object",
  properties: {
    look: { type: "string" }, // 채점 근거 한 줄 (먼저 쓰게 해서 점수가 한 값에 몰리지 않게). 저장 안 함
    color: { type: "integer" },
    fit: { type: "integer" },
    harmony: { type: "integer" },
    trend: { type: "integer" },
    mood: { type: "string", enum: [...MOODS] },
    nickname: { type: "string" },
    praise: { type: "string" },
    roast: { type: "string" },
  },
  required: ["look", "color", "fit", "harmony", "trend", "mood", "nickname", "praise", "roast"],
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

// 이긴 쪽 한마디도 한줄평처럼 검사: 욕설·외모 단어가 있으면 무난한 문장으로 바꿈
const SAFE_PRAISE = ["오늘은 인정합니다.", "옷빨 하나는 챙기셨네요.", "이번 판은 옷이 이겼네요.", "안목 살아있네요, 얄밉게."];
const safePraise = (t: string) => (t && !hasBannedWord(t) ? t : SAFE_PRAISE[Math.floor(Math.random() * SAFE_PRAISE.length)]);

/** 여러 번 채점한 결과(ds)의 항목 점수를 평균 낸다. 별명·한마디·무드는 첫 번째 것 */
function toScore(ds: Record<string, unknown>[]): Score {
  const d = ds[0];
  const avg = (k: string) => Math.round(ds.reduce((n, x) => n + int25(x[k]), 0) / ds.length);
  const raw = { color: avg("color"), fit: avg("fit"), harmony: avg("harmony"), trend: avg("trend") };
  // Haiku 계열이면 상위권 보정 (lib/rubric.ts stretchTop). 끄려면 SCORE_STRETCH=0
  const s = useStretch() ? stretchTop(raw) : raw;
  const mood = (MOODS as readonly string[]).includes(String(d.mood)) ? String(d.mood) : "기타";
  return { ...s, total: s.color + s.fit + s.harmony + s.trend, nickname: clip(d.nickname, 20), praise: safePraise(clip(d.praise, 40)), mood };
}

// ---------- 모델 호출 ----------
export const SCORE_MODEL = process.env.SCORE_MODEL?.trim() || "claude-opus-5-5";
/** 상위권 점수 보정: Haiku 계열에서만 켬 (SCORE_STRETCH=0 이면 끔) */
const useStretch = () => process.env.SCORE_STRETCH?.trim() !== "0" && /haiku/.test(SCORE_MODEL);
/** 사진 1장을 몇 번 채점해 평균 낼지. Haiku 는 2번(점수 흔들림 줄이기, 비용이 싸서), 나머지는 1번. SCORE_SAMPLES 로 바꿈 */
const scoreSamples = () => {
  const n = Number(process.env.SCORE_SAMPLES);
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : /haiku/.test(SCORE_MODEL) ? 2 : 1;
};
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

/** 호출 정보 (모델 비교 테스트 evals/model-compare 용). 게임 화면은 안 씀 */
export type CallMeta = { model: string; usage: Record<string, unknown>; stopReason: string | null; latencyMs: number };

async function askJson(system: string, jpeg: Buffer, schema: object, maxTokens: number, model = SCORE_MODEL): Promise<{ data: Record<string, unknown>; meta: CallMeta }> {
  const t0 = Date.now();
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
    return { data: d as Record<string, unknown>, meta: { model: res.model, usage: { ...res.usage } as Record<string, unknown>, stopReason: res.stop_reason ?? null, latencyMs: Date.now() - t0 } };
  } catch {
    throw new ScoringError("invalid_json");
  }
}

// 키 없이 화면을 시험할 때: 지문으로 정해지는 가짜 점수
function mockScore(hash: string, recent: string[]): { score: Score; roast: string; style: string } {
  const n = (i: number) => 5 + (parseInt(hash.slice(i * 2, i * 2 + 2), 16) % 21);
  const s = { color: n(0), fit: n(1), harmony: n(2), trend: n(3) };
  return {
    score: { ...s, total: s.color + s.fit + s.harmony + s.trend, nickname: "테스트 코디 " + hash.slice(0, 3), praise: "(가짜 점수) 오 좀 치네", mood: "캐주얼" },
    roast: "(가짜 점수) " + fallbackRoast(recent),
    style: "mock",
  };
}

/** style: 한줄평 스타일 키 (로그용, "s1"~"s25" / "mock") */
export async function scorePhoto(jpeg: Buffer, hash: string, recent: string[] = []): Promise<{ score: Score; roast: string; style: string; meta?: CallMeta }> {
  if (isMock()) return mockScore(hash, recent);
  // 여러 번 동시에 채점해서 점수는 평균, 한줄평은 검사를 통과한 첫 번째 것 (번마다 말투를 따로 뽑음)
  const styles = Array.from({ length: scoreSamples() }, () => pickStyle());
  const memeTurn = Math.random() < MEME_RATE; // 밈 판인지는 사진 1장에 한 번만 정함 (여러 번 채점해도 같게)
  const settled = await Promise.allSettled(styles.map((st) => askJson(scorePrompt(st, recent, memeTurn), jpeg, SCORE_SCHEMA, 4000)));
  const ok = settled.flatMap((r, i) => (r.status === "fulfilled" ? [{ ...r.value, style: styles[i] }] : []));
  if (!ok.length) throw (settled[0] as PromiseRejectedResult).reason;
  const pickIdx = Math.max(0, ok.findIndex((x) => guardRoast(clip(x.data.roast, 90), recent) !== null));
  const chosen = ok[pickIdx];
  const usage: Record<string, number> = {};
  for (const x of ok) for (const [k, v] of Object.entries(x.meta.usage)) if (typeof v === "number") usage[k] = (usage[k] ?? 0) + v;
  const meta: CallMeta = { model: chosen.meta.model, usage, stopReason: chosen.meta.stopReason, latencyMs: Math.max(...ok.map((x) => x.meta.latencyMs)) };
  return { score: toScore([chosen.data, ...ok.filter((_, i) => i !== pickIdx).map((x) => x.data)]), roast: clip(chosen.data.roast, 90), style: styleKey(chosen.style), meta };
}

export async function roastPhoto(jpeg: Buffer, me: Score, other: Score, recent: string[] = []): Promise<{ roast: string; style: string }> {
  if (isMock()) return { roast: "(가짜 점수) " + fallbackRoast(recent), style: "mock" };
  const weakest = RUBRIC.reduce((m, c) => (me[c.key] < me[m.key] ? c : m), RUBRIC[0]).name;
  const style = pickStyle();
  const { data: d } = await askJson(roasterSystem(style, me.total, other.total, weakest, recent), jpeg, ROAST_SCHEMA, 2000, ROAST_MODEL);
  return { roast: clip(d.roast, 90), style: styleKey(style) };
}
