// 비교 테스트 2단계: 준비된 사진을 실제 게임 채점 함수(lib/scoring.ts scorePhoto)로 채점한다.
// 같은 사진을 --reps 번(기본 2번) 채점해서 점수가 얼마나 흔들리는지도 본다.
//
// 실행 (모델마다 한 번씩):
//   npx tsc -p evals/model-compare/tsconfig.json
//   node --conditions=react-server evals/model-compare/run.cjs --model claude-opus-5-5
//   node --conditions=react-server evals/model-compare/run.cjs --model claude-haiku-5-5
// 옵션: --reps 2  --limit 0(전부)  --concurrency 3  --timeout-s 120
//
// 결과: out/<모델>/results.jsonl (사진·회차마다 한 줄), out/<모델>/errors.jsonl (실패한 시도)
// 이미 끝난 (사진, 회차)는 건너뛰므로 중간에 끊겨도 다시 실행하면 이어서 한다.
// 키는 프로젝트 루트 .env.local 의 ANTHROPIC_API_KEY 를 읽는다 (화면·로그에 출력 안 함).

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..", "..");
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]?.startsWith("--") ? "1" : arr[i + 1]]] : acc), []),
);
const MODEL = args.model;
const REPS = Number(args.reps ?? 2);
const LIMIT = Number(args.limit ?? 0);
const CONC = Number(args.concurrency ?? 3);
const TIMEOUT_MS = Number(args["timeout-s"] ?? 120) * 1000;
if (!MODEL) { console.error("--model 이 필요합니다 (예: --model claude-haiku-5-5)"); process.exit(1); }

// .env.local 읽기 (이미 환경변수에 있으면 그걸 씀)
const envFile = path.join(ROOT, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
if (!process.env.ANTHROPIC_API_KEY) { console.error(".env.local 에 ANTHROPIC_API_KEY 가 없습니다."); process.exit(1); }
process.env.MOCK_SCORING = "";
process.env.SCORE_MODEL = MODEL; // scoring.ts 가 불러올 때 읽으므로 require 전에 정한다

const build = path.join(HERE, ".build", "lib", "scoring.js");
if (!fs.existsSync(build)) { console.error("먼저 npx tsc -p evals/model-compare/tsconfig.json 을 실행하세요."); process.exit(1); }
const { scorePhoto, SCORE_MODEL } = require(build);
const { guardRoast } = require(path.join(HERE, ".build", "lib", "roaster.js"));
if (SCORE_MODEL !== MODEL) { console.error("모델 설정이 안 먹었습니다:", SCORE_MODEL); process.exit(1); }

const photosDir = path.join(HERE, "prepared");
let photos = fs.existsSync(photosDir) ? fs.readdirSync(photosDir).filter((f) => f.endsWith(".jpg")).sort() : [];
if (!photos.length) { console.error("prepared 폴더가 비었습니다. 먼저 prepare-photos.ps1 을 실행하세요."); process.exit(1); }
if (LIMIT > 0) photos = photos.slice(0, LIMIT);

const outDir = path.join(HERE, "out", MODEL);
fs.mkdirSync(outDir, { recursive: true });
const resultsFile = path.join(outDir, "results.jsonl");
const errorsFile = path.join(outDir, "errors.jsonl");
const done = new Set(
  (fs.existsSync(resultsFile) ? fs.readFileSync(resultsFile, "utf8").split("\n").filter(Boolean) : [])
    .map((l) => { try { const r = JSON.parse(l); return `${r.photo}#${r.rep}`; } catch { return null; } })
    .filter(Boolean),
);

const jobs = [];
for (const photo of photos) for (let rep = 0; rep < REPS; rep++) if (!done.has(`${photo}#${rep}`)) jobs.push({ photo, rep });
console.log(`${MODEL}: 사진 ${photos.length}장 × ${REPS}회, 남은 작업 ${jobs.length}개 (이미 끝난 ${done.size}개 건너뜀)`);

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), ms))]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runJob({ photo, rep }) {
  const jpeg = fs.readFileSync(path.join(photosDir, photo));
  const hash = crypto.createHash("sha256").update(jpeg).digest("hex").slice(0, 32);
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const t0 = Date.now();
      const r = await withTimeout(scorePhoto(jpeg, hash, []), TIMEOUT_MS);
      if (!r.meta) throw Object.assign(new Error("no meta (가짜 점수 모드?)"), { code: "harness" });
      // 요청한 모델로 실제로 채점됐는지 확인 (서버 쪽 대체 모델로 바뀌었으면 기록)
      const served = r.meta.model;
      const row = {
        photo, rep, model_requested: MODEL, model: served, model_matches: served === MODEL || served.startsWith(MODEL),
        score: r.score, roast: r.roast, style: r.style,
        roast_final: guardRoast(r.roast), roast_guard_ok: guardRoast(r.roast) !== null, roast_len: r.roast.length,
        stop_reason: r.meta.stopReason, usage: r.meta.usage, latency_s: (Date.now() - t0) / 1000, retries: attempt,
      };
      fs.appendFileSync(resultsFile, JSON.stringify(row) + "\n");
      return row;
    } catch (e) {
      lastErr = e;
      const code = e.code || e.message || "error";
      const retryable = code === "rate_limited" || code === "upstream" || code === "invalid_json";
      fs.appendFileSync(errorsFile, JSON.stringify({ photo, rep, attempt, failure: code, at: new Date().toISOString() }) + "\n");
      if (!retryable) break; // 거절(refused)·시간 초과는 다시 안 함
      await sleep(1500 * 2 ** attempt + Math.random() * 1000);
    }
  }
  return { photo, rep, error: lastErr?.code || lastErr?.message };
}

(async () => {
  const t0 = Date.now();
  let i = 0, ok = 0, fail = 0;
  await Promise.all(Array.from({ length: Math.min(CONC, jobs.length) }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      const r = await runJob(job);
      if (r.error) { fail++; console.log(`  ✗ ${job.photo} #${job.rep}: ${r.error}`); }
      else { ok++; console.log(`  ✓ ${job.photo} #${job.rep}: ${r.score.total}점 · ${r.roast}`); }
    }
  }));
  console.log(`끝: 성공 ${ok}, 실패 ${fail}, ${((Date.now() - t0) / 1000).toFixed(0)}초`);
})();
