// 한 모델 결과 보기: 사진마다 점수(항목 4개·합계)·무드·별명·이긴 쪽 한마디·한줄평을 회차별로 모은 페이지를 만든다.
// 실행: node evals/model-compare/view.cjs --model claude-haiku-5-5
// 결과: evals/model-compare/view-<모델>.html (사진이 들어 있으니 GitHub에 안 올림)

const fs = require("fs");
const path = require("path");
const HERE = __dirname;
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const MODEL = args.model || "claude-haiku-5-5";
const PRICES = { "claude-opus-5-5": { in: 4, out: 20 }, "claude-sonnet-5-5": { in: 2, out: 10 }, "claude-haiku-5-5": { in: 0.1, out: 0.5 } };

const rows = fs.readFileSync(path.join(HERE, "out", MODEL, "results.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const mapFile = path.join(HERE, "prepared", "map.txt");
const origName = Object.fromEntries(fs.existsSync(mapFile) ? fs.readFileSync(mapFile, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean).map((l) => l.split("\t")) : []);
const byPhoto = new Map();
for (const r of rows) (byPhoto.get(r.photo) || byPhoto.set(r.photo, []).get(r.photo)).push(r);
for (const rs of byPhoto.values()) rs.sort((a, b) => a.rep - b.rep);
const p = PRICES[MODEL];
const cost = (r) => ((r.usage.input_tokens || 0) * p.in + (r.usage.output_tokens || 0) * p.out) / 1e6;

const photos = [...byPhoto.keys()].sort().map((ph) => ({
  id: ph,
  orig: origName[ph] || "",
  img: "data:image/jpeg;base64," + fs.readFileSync(path.join(HERE, "prepared", ph)).toString("base64"),
  reps: byPhoto.get(ph).map((r) => ({ rep: r.rep, score: r.score, roast: r.roast, final: r.roast_final ?? null, ok: r.roast_guard_ok, style: r.style })),
}));
const totals = rows.map((r) => r.score.total);
const wob = photos.filter((x) => x.reps.length > 1).map((x) => Math.abs(x.reps[0].score.total - x.reps[1].score.total));
const summary = {
  model: MODEL, photos: photos.length, calls: rows.length,
  avg: totals.reduce((a, b) => a + b, 0) / totals.length, min: Math.min(...totals), max: Math.max(...totals),
  wobble: wob.length ? wob.reduce((a, b) => a + b, 0) / wob.length : null,
  guardFail: rows.filter((r) => !r.roast_guard_ok).length,
  costTotal: rows.reduce((a, r) => a + cost(r), 0),
  latency: rows.reduce((a, r) => a + r.latency_s, 0) / rows.length,
};
const data = JSON.stringify({ summary, photos }).replace(/</g, "\\u003c");

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>채점 결과 ${MODEL}</title>
<style>
:root{--bg:#fff7fb;--fg:#1d1320;--muted:#6c5a70;--line:#ecd6e6;--hot:#c4006f;--card:#fff;--warn:#b00020;--warn-bg:#ffe8ec}
@media (prefers-color-scheme:dark){:root{--bg:#170f1a;--fg:#f6eaf3;--muted:#b9a5bd;--line:#3a2a40;--hot:#ff6cbc;--card:#221827;--warn:#ff8a9c;--warn-bg:#3a1520}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Malgun Gothic",sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 60px;display:flex;flex-direction:column;gap:16px}
h1{margin:0;font-size:24px} .muted{color:var(--muted);font-size:13px}
.sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px}
.sum div{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.sum b{display:block;font-size:20px;font-variant-numeric:tabular-nums}
.card{display:grid;grid-template-columns:200px minmax(0,1fr);gap:14px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px}
@media (max-width:620px){.card{grid-template-columns:1fr}}
.card img{width:100%;border-radius:8px;object-fit:cover;max-height:300px}
.reps{display:grid;gap:10px;min-width:0}
.rep{border-top:1px dashed var(--line);padding-top:8px} .rep:first-child{border-top:0;padding-top:0}
.top{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
.total{font-size:26px;font-weight:800;color:var(--hot);font-variant-numeric:tabular-nums}
.bars{display:flex;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.roast{font-weight:700;margin:4px 0 2px} .roast.bad{color:var(--warn);background:var(--warn-bg);padding:2px 6px;border-radius:4px}
.tag{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:0 8px;color:var(--muted)}
</style></head><body><main id="app"></main>
<script id="d" type="application/json">${data}</script>
<script>
const D=JSON.parse(document.getElementById("d").textContent),S=D.summary,app=document.getElementById("app");
const el=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
app.append(el("h1",null,"채점 결과 · "+S.model.replace("claude-","")));
app.append(el("p","muted","사진 "+S.photos+"장 × "+(S.calls/S.photos)+"회. 게임 채점 함수 그대로. 빨간 한줄평 = 게임의 안전 검사(욕설·외모·심사평 말투·길이)에 걸려서 실제로는 은행 문장으로 바뀌는 것"));
const sum=el("div","sum");[["평균 합계",S.avg.toFixed(1)+"점"],["범위",S.min+"~"+S.max+"점"],["같은 사진 2회 차이",S.wobble==null?"-":S.wobble.toFixed(1)+"점"],["검사에 걸린 한줄평",S.guardFail+" / "+S.calls],["응답 시간",S.latency.toFixed(1)+"초"],["이번 테스트 비용","$"+S.costTotal.toFixed(4)]].forEach(([k,v])=>{const d=el("div");d.append(el("span","muted",k),el("b",null,v));sum.append(d)});app.append(sum);
for(const p of D.photos){const c=el("section","card"),img=el("img");img.src=p.img;img.alt=p.id;const left=el("div");left.append(img,el("div","muted",p.id+(p.orig?" · "+p.orig:"")));
 const reps=el("div","reps");for(const r of p.reps){const s=r.score,box=el("div","rep"),top=el("div","top");
  top.append(el("span","total",s.total+"점"),el("span","tag",(r.rep+1)+"회차"),el("span","tag","무드 "+(s.mood||"-")),el("span","tag","말투 "+r.style));
  const bars=el("div","bars");[["색감",s.color],["핏",s.fit],["조화",s.harmony],["센스",s.trend]].forEach(([k,v])=>bars.append(el("span",null,k+" "+v+"/25")));
  box.append(top,bars,el("div",null,"별명: "+s.nickname),el("div",null,"이겼을 때: "+s.praise),el("div","roast"+(r.ok?"":" bad"),(r.ok?"":"⚠ ")+"한줄평: "+(r.ok&&r.final?r.final:r.roast)),...(r.ok&&r.final&&r.final!==r.roast?[el("div","muted","(원래 문장이 길어서 첫 문장만 씀: "+r.roast+")")]:[]));reps.append(box)}
 c.append(left,reps);app.append(c)}
</script></body></html>`;
const out = path.join(HERE, `view-${MODEL}.html`);
fs.writeFileSync(out, html);
console.log(JSON.stringify(summary));
console.log("페이지:", path.relative(process.cwd(), out));
