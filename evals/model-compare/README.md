# 채점 모델 비교 테스트 (Opus 5.5 vs Haiku 5.5)

> 2026-11-27. 비용 때문에 Haiku로 바꿔도 되는지 보려고 만듦. 같은 코디 사진을 두 모델이 **실제 게임 채점 함수**(`lib/scoring.ts`의 `scorePhoto`, 프롬프트·기준표·한줄평 규칙 그대로)로 각각 2번씩 채점한다.

## 1. 준비 (한 번만)

1. 프로젝트 루트에 `.env.local` 파일을 만들고 한 줄 넣기: `ANTHROPIC_API_KEY=sk-ant-...` (GitHub에 안 올라감. 채팅에 키를 붙이지 말 것)
2. `evals/photos/` 에 전신 코디 사진 15~30장 넣기 (jpg/png. 아이폰 HEIC는 JPG로 바꿔서). 이 폴더도 GitHub에 안 올라감.
   - 실제 유저가 올릴 법한 사진으로: 잘 입은 것 · 무난한 것 · 망한 것을 골고루, 비슷한 수준끼리도 몇 장.

## 2. 실행 (PowerShell, 프로젝트 루트에서)

```powershell
powershell -ExecutionPolicy Bypass -File evals\model-compare\prepare-photos.ps1
npx tsc -p evals/model-compare/tsconfig.json
node --conditions=react-server evals/model-compare/run.cjs --model claude-opus-5-5 --limit 2
```

위 마지막 줄은 **사진 2장만 먼저** 돌려 보는 시험(약 4번 호출, 몇십 원)이다. 잘 나오면 전체:

```powershell
node --conditions=react-server evals/model-compare/run.cjs --model claude-opus-5-5
node --conditions=react-server evals/model-compare/run.cjs --model claude-haiku-5-5
node evals/model-compare/compare.cjs
```

- 사진을 게임과 똑같이 긴 변 1024px JPEG로 줄인 뒤 보낸다.
- 중간에 끊겨도 같은 명령을 다시 실행하면 끝난 건 건너뛰고 이어서 한다.
- 사진 20장 기준 예상: Opus 40번 호출 약 $1.2, Haiku 40번 약 $0.03 (추정치. 시험 2장 결과의 실제 사용량으로 다시 계산할 것). 시간은 모델당 몇 분.

## 3. 결과 보는 법

`compare.cjs`가 표를 출력하고 `evals/model-compare/blind.html`을 만든다.

| 숫자 | 뜻 | 보는 법 |
|---|---|---|
| 흔들림: 평균 점수차 | 같은 사진을 2번 채점했을 때 합계 차이 | 작을수록 좋음. 게임은 같은 사진 점수를 저장해 두지만, 새 사진끼리 붙을 땐 이게 승패 운이 됨 |
| 자기 자신과 배틀 일치율 | 같은 모델 1회차·2회차가 사진 쌍마다 같은 쪽을 이기게 하는 비율 | 그 모델이 스스로 얼마나 일관된지 (기준선) |
| **두 모델 배틀 일치율** | Opus와 Haiku가 같은 쪽을 이기게 하는 비율 | **가장 중요.** Opus 자기 일치율과 비슷하면 "Haiku로 바꿔도 승패는 거의 같다" |
| 순위 상관 | 사진을 점수순으로 줄 세운 순서가 같은 정도 | 1에 가까울수록 같음 |
| 한줄평 규칙 통과율 | 욕설·심사평 말투·길이 검사 통과 비율 | 떨어지면 게임에서 은행 문장으로 대체되는 일이 많아짐 |
| 사진 1장당 비용 | 실제 사용 토큰 × 정가 | |

**blind.html** — 브라우저로 열면 사진마다 두 모델 한줄평이 좌우 무작위로 나온다. 어느 모델 것인지 모르는 채로 "더 웃김 / 비슷 / 둘 다 별로"를 고르면, 끝에 모델별 승수가 공개된다. 투표는 그 브라우저에만 저장된다.

## 4. 판단 기준 (돌리기 전에 정해 두기)

예시: 두 모델 배틀 일치율이 Opus 자기 일치율보다 10%p 이상 낮지 않고, 블라인드 투표에서 Haiku가 Opus에 크게 밀리지 않으면(예: Opus 승이 Haiku 승의 2배 미만) Haiku로 바꾼다. 사진 20장이면 ±10%p 정도는 우연일 수 있다.

바꾸는 법: Vercel 환경변수 `SCORE_MODEL=claude-haiku-5-5` → 재배포. 다시뽑기 한줄평만 Opus로 남기려면 `ROAST_MODEL=claude-opus-5-5`.

## 파일

- `prepare-photos.ps1` — 사진 줄이기 (`evals/photos` → `prepared/`)
- `tsconfig.json` — 게임 채점 코드(`lib/scoring.ts`)를 테스트용으로 컴파일 (`.build/`)
- `run.cjs` — 채점 실행. 결과 `out/<모델>/results.jsonl`, 실패 `errors.jsonl`. 응답한 모델이 요청한 모델과 다르면(서버 쪽 대체) `model_matches: false`로 표시
- `compare.cjs` — 숫자 비교 + `blind.html`
- `lib/scoring.ts`의 `scorePhoto`는 테스트용으로 호출 정보(`meta`: 모델·토큰·응답 시간)를 같이 돌려준다. 게임은 이 값을 안 씀.
