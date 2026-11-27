// 비교 테스트 3단계: 두 모델 결과를 비교해 숫자를 출력하고, 한줄평 블라인드 투표 페이지(blind.html)를 만든다.
// 실행: node evals/model-compare/compare.cjs --a claude-opus-5-5 --b claude-haiku-5-5
//
// 자동으로 세는 것
//  - 채점 성공률 · 거절 · 대체 모델로 바뀐 횟수
//  - 점수 흔들림: 같은 사진을 2번 채점했을 때 합계 차이 (작을수록 좋음)
//  - 배틀 일치율: 사진 두 장씩 짝지었을 때 두 모델이 같은 쪽을 이기게 하는 비율 (게임에서 실제로 중요한 것)
//  - 순위 상관(스피어만): 사진들을 점수순으로 줄 세운 순서가 얼마나 같은지 (1 = 완전히 같음)
//  - 한줄평 규칙 통과율(욕설·심사평 말투·길이 검사), 평균 길이, 응답 시간, 사진 1장당 비용
// 사람이 보는 것: blind.html 에서 사진마다 두 한줄평 중 더 웃긴 쪽 고르기 (어느 모델인지 가림)

const fs = require("fs");
const path = require("path");
const HERE = __dirname;
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const A = args.a || "claude-opus-5-5";
const B = args.b || "claude-haiku-5-5";

// 1M 토큰당 달러 (2026-11 정가, 캐시 쓰기 1.25배 · 읽기 0.1배)
const PRICES = {
  "claude-opus-5-5": { in: 4, out: 20 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
};

const load = (m) => {
  const f = path.join(HERE, "out", m, "results.jsonl");
  if (!fs.existsSync(f)) { console.error(`${m} 결과가 없습니다: ${f}`); process.exit(1); }
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
};
const errorsOf = (m) => {
  const f = path.join(HERE, "out", m, "errors.jsonl");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const costOf = (r) => {
  const p = PRICES[r.model_requested] || PRICES[r.model];
  if (!p) return NaN;
  const u = r.usage || {};
  const inTok = (u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0) + 0.1 * (u.cache_read_input_tokens || 0);
  return (inTok * p.in + (u.output_tokens || 0) * p.out) / 1e6;
};

function summarize(m, rows) {
  const byPhoto = new Map();
  for (const r of rows) (byPhoto.get(r.photo) || byPhoto.set(r.photo, []).get(r.photo)).push(r);
  const wobble = [...byPhoto.values()].filter((rs) => rs.length >= 2).map((rs) => Math.abs(rs[0].score.total - rs[1].score.total));
  const errs = errorsOf(m);
  return {
    model: m,
    rows: rows.length,
    photos: byPhoto.size,
    failedAttempts: errs.length,
    refused: errs.filter((e) => e.failure === "refused").length,
    swapped: rows.filter((r) => !r.model_matches).length,
    meanTotal: mean(rows.map((r) => r.score.total)),
    wobbleMean: mean(wobble),
    wobbleSame: wobble.length ? wobble.filter((d) => d === 0).length / wobble.length : NaN,
    wobbleMax: wobble.length ? Math.max(...wobble) : NaN,
    guardOk: mean(rows.map((r) => (r.roast_guard_ok ? 1 : 0))),
    roastLen: mean(rows.map((r) => r.roast_len)),
    latency: mean(rows.map((r) => r.latency_s)),
    costPerPhoto: mean(rows.map(costOf)),
    byPhoto,
  };
}

const sa = summarize(A, load(A));
const sb = summarize(B, load(B));
const common = [...sa.byPhoto.keys()].filter((p) => sb.byPhoto.has(p)).sort();
const avgTotal = (s, p) => mean(s.byPhoto.get(p).map((r) => r.score.total));

// 배틀 일치율: 모든 사진 쌍에서 이기는 쪽이 같은가 (평균 점수 기준, 동점 쌍은 뺌)
let agree = 0, pairs = 0;
for (let i = 0; i < common.length; i++) for (let j = i + 1; j < common.length; j++) {
  const da = avgTotal(sa, common[i]) - avgTotal(sa, common[j]);
  const db = avgTotal(sb, common[i]) - avgTotal(sb, common[j]);
  if (da === 0 || db === 0) continue;
  pairs++; if (Math.sign(da) === Math.sign(db)) agree++;
}
// 같은 모델끼리(1회차 vs 2회차) 배틀 일치율 = 그 모델 자체의 흔들림 기준선
function selfAgree(s) {
  const ps = [...s.byPhoto.keys()].filter((p) => s.byPhoto.get(p).length >= 2);
  let a = 0, n = 0;
  for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) {
    const d0 = s.byPhoto.get(ps[i])[0].score.total - s.byPhoto.get(ps[j])[0].score.total;
    const d1 = s.byPhoto.get(ps[i])[1].score.total - s.byPhoto.get(ps[j])[1].score.total;
    if (d0 === 0 || d1 === 0) continue;
    n++; if (Math.sign(d0) === Math.sign(d1)) a++;
  }
  return n ? a / n : NaN;
}
const rank = (xs) => { const s = xs.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]); const r = Array(xs.length); for (let k = 0; k < s.length;) { let e = k; while (e + 1 < s.length && s[e + 1][0] === s[k][0]) e++; for (let t = k; t <= e; t++) r[s[t][1]] = (k + e) / 2; k = e + 1; } return r; };
const pearson = (x, y) => { const mx = mean(x), my = mean(y); let n = 0, dx = 0, dy = 0; x.forEach((v, i) => { n += (v - mx) * (y[i] - my); dx += (v - mx) ** 2; dy += (y[i] - my) ** 2; }); return n / Math.sqrt(dx * dy); };
const spearman = common.length > 2 ? pearson(rank(common.map((p) => avgTotal(sa, p))), rank(common.map((p) => avgTotal(sb, p)))) : NaN;
const meanAbsDiff = mean(common.map((p) => Math.abs(avgTotal(sa, p) - avgTotal(sb, p))));

const f = (v, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "-");
const pct = (v) => (Number.isFinite(v) ? Math.round(v * 100) + "%" : "-");
const usd = (v) => (Number.isFinite(v) ? "$" + v.toFixed(5) : "-");
// 한글은 화면에서 2칸이라 칸 맞춤을 따로 계산
const wid = (t) => [...String(t)].reduce((n, ch) => n + (/[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1), 0);
const padE = (t, n) => String(t) + " ".repeat(Math.max(0, n - wid(t)));
const padS = (t, n) => " ".repeat(Math.max(0, n - wid(t))) + String(t);
const line = (label, a, b) => console.log(padE(label, 28) + padS(a, 14) + padS(b, 16));
console.log(`\n사진 ${common.length}장 공통\n`);
line("", A.replace("claude-", ""), B.replace("claude-", ""));
line("채점된 줄 (사진×회차)", sa.rows, sb.rows);
line("실패한 시도 / 거절", `${sa.failedAttempts} / ${sa.refused}`, `${sb.failedAttempts} / ${sb.refused}`);
line("대체 모델로 바뀜", sa.swapped, sb.swapped);
line("평균 합계 점수", f(sa.meanTotal), f(sb.meanTotal));
line("흔들림: 평균 점수차", f(sa.wobbleMean), f(sb.wobbleMean));
line("흔들림: 똑같이 나온 비율", pct(sa.wobbleSame), pct(sb.wobbleSame));
line("흔들림: 최대 점수차", f(sa.wobbleMax, 0), f(sb.wobbleMax, 0));
line("자기 자신과 배틀 일치율", pct(selfAgree(sa)), pct(selfAgree(sb)));
line("한줄평 규칙 통과율", pct(sa.guardOk), pct(sb.guardOk));
line("한줄평 평균 길이(자)", f(sa.roastLen), f(sb.roastLen));
line("응답 시간(초)", f(sa.latency), f(sb.latency));
line("사진 1장당 비용", usd(sa.costPerPhoto), usd(sb.costPerPhoto));
console.log(`\n두 모델 사이`);
console.log(`  배틀 일치율: ${pct(pairs ? agree / pairs : NaN)} (${agree}/${pairs}쌍) ← '자기 자신과 배틀 일치율'과 비교해서 보세요`);
console.log(`  순위 상관(스피어만): ${f(spearman, 2)} (1이면 줄 세운 순서가 같음)`);
console.log(`  같은 사진 평균 점수차: ${f(meanAbsDiff)}점`);
console.log(`  흔들림·일치율은 사진 ${common.length}장 기준이라 ±10%p 정도는 우연일 수 있습니다.\n`);

// ---------- 블라인드 투표 페이지 ----------
// 사진마다 각 모델의 1회차 한줄평 하나씩. 좌우는 사진마다 무작위. 투표는 이 브라우저에만 저장.
const cases = common.map((p, i) => {
  const ra = sa.byPhoto.get(p).find((r) => r.rep === 0) || sa.byPhoto.get(p)[0];
  const rb = sb.byPhoto.get(p).find((r) => r.rep === 0) || sb.byPhoto.get(p)[0];
  const flip = Math.random() < 0.5;
  const img = "data:image/jpeg;base64," + fs.readFileSync(path.join(HERE, "prepared", p)).toString("base64");
  return { id: p, img, left: flip ? rb.roast : ra.roast, right: flip ? ra.roast : rb.roast, leftModel: flip ? B : A, rightModel: flip ? A : B };
});
const json = JSON.stringify({ a: A, b: B, cases }).replace(/</g, "\\u003c");
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>한줄평 블라인드 투표</title>
<style>
:root{--bg:#fff7fb;--fg:#1d1320;--muted:#6c5a70;--line:#ecd6e6;--hot:#c4006f;--card:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#170f1a;--fg:#f6eaf3;--muted:#b9a5bd;--line:#3a2a40;--hot:#ff6cbc;--card:#221827}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,"Malgun Gothic",sans-serif}
main{max-width:560px;margin:0 auto;padding:20px 16px 60px;display:flex;flex-direction:column;gap:14px}
h1{font-size:22px;margin:0} .muted{color:var(--muted);font-size:14px;margin:0}
img{width:100%;max-height:52vh;object-fit:contain;border-radius:10px;background:#0001}
.r{background:var(--card);border:2px solid var(--line);border-radius:10px;padding:12px 14px;font-weight:700}
.r small{display:block;font-weight:400;color:var(--muted);font-size:12px}
.btns{display:grid;grid-template-columns:1fr 1fr;gap:8px}
button{font:inherit;padding:12px;border-radius:10px;border:2px solid var(--line);background:var(--card);color:var(--fg);cursor:pointer;min-height:48px}
button:focus-visible{outline:3px solid var(--hot);outline-offset:2px}
button.main{border-color:var(--hot)} .bar{height:6px;background:var(--line);border-radius:3px;overflow:hidden}.bar i{display:block;height:100%;background:var(--hot)}
table{border-collapse:collapse;width:100%;font-size:14px} td,th{border-bottom:1px solid var(--line);padding:6px;text-align:left;vertical-align:top}
</style></head><body><main id="app"></main>
<script id="data" type="application/json">${json}</script>
<script>
const D=JSON.parse(document.getElementById("data").textContent),KEY="roast-blind-"+D.a+"-"+D.b+"-"+D.cases.length;
let votes={};try{votes=JSON.parse(localStorage.getItem(KEY)||"{}")}catch{}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(votes))}catch{}};
const app=document.getElementById("app"),el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
function render(){app.replaceChildren();const left=D.cases.filter(c=>!votes[c.id]);
 app.append(el("h1",null,"한줄평 블라인드 투표"));
 const bar=el("div","bar"),fill=el("i");fill.style.width=(100*(D.cases.length-left.length)/D.cases.length)+"%";bar.append(fill);
 app.append(el("p","muted",(D.cases.length-left.length)+" / "+D.cases.length+" · 어느 모델 것인지는 끝나면 공개"),bar);
 if(!left.length)return done();
 const c=left[0],img=el("img");img.src=c.img;img.alt="코디 사진 "+c.id;app.append(img);
 const L=el("div","r");L.append(el("small",null,"왼쪽"),document.createTextNode(c.left));const R=el("div","r");R.append(el("small",null,"오른쪽"),document.createTextNode(c.right));app.append(L,R);
 const b=el("div","btns");[["left","◀ 왼쪽이 더 웃김","main"],["right","오른쪽이 더 웃김 ▶","main"],["tie","비슷함"],["bad","둘 다 별로"]].forEach(([v,t,k])=>{const x=el("button",k||"",t);x.type="button";x.onclick=()=>{votes[c.id]=v;save();render()};b.append(x)});app.append(b);
 if(Object.keys(votes).length){const u=el("button",null,"↩ 방금 거 다시");u.type="button";u.onclick=()=>{const k=Object.keys(votes).pop();delete votes[k];save();render()};app.append(u)}
}
function done(){const t={[D.a]:0,[D.b]:0,tie:0,bad:0};const rows=[];
 for(const c of D.cases){const v=votes[c.id];const w=v==="left"?c.leftModel:v==="right"?c.rightModel:v;t[w]++;rows.push([c.id,w,c.leftModel===D.a?c.left:c.right,c.leftModel===D.b?c.left:c.right])}
 const n=D.cases.length,s=k=>k.replace("claude-","");
 app.append(el("h2",null,"결과 (사진 "+n+"장)"));
 [[s(D.a)+" 승",t[D.a]],[s(D.b)+" 승",t[D.b]],["비슷함",t.tie],["둘 다 별로",t.bad]].forEach(([k,v])=>app.append(el("p",null,k+": "+v+" ("+Math.round(100*v/n)+"%)")));
 const tb=el("table"),h=el("tr");["사진","고른 쪽",s(D.a),s(D.b)].forEach(x=>h.append(el("th",null,x)));tb.append(h);
 rows.forEach(r=>{const tr=el("tr");r.forEach((x,i)=>tr.append(el("td",null,i===1?(x===D.a||x===D.b?s(x):x==="tie"?"비슷":"별로"):x)));tb.append(tr)});app.append(tb);
 const txt=s(D.a)+" "+t[D.a]+" / "+s(D.b)+" "+t[D.b]+" / 비슷 "+t.tie+" / 별로 "+t.bad+" (n="+n+")";
 const cp=el("button","main","결과 한 줄 복사");cp.type="button";cp.onclick=()=>navigator.clipboard?.writeText(txt).then(()=>cp.textContent="복사됨",()=>cp.textContent=txt);app.append(cp);
 const rs=el("button",null,"처음부터 다시");rs.type="button";rs.onclick=()=>{votes={};save();render()};app.append(rs)}
render();
</script></body></html>`;
fs.writeFileSync(path.join(HERE, "blind.html"), html);
console.log(`블라인드 투표 페이지: evals/model-compare/blind.html (사진 ${cases.length}장)`);
