# 옷빨 배틀 웹앱 준비 가이드

작성 2026-11-25. 지금 아티팩트 버전(claude.ai 안에서만 도는 프로토타입)을 누구나 들어올 수 있는 진짜 웹사이트로 옮기는 데 필요한 준비물과 순서를 정리한 문서다.
**사용자가 직접 해야 하는 일**(계정 만들기, 키 발급, 로그인 앱 등록, 결제)과 **Claude가 할 일**(코드)을 나눠 적었다.

---

## 0. 전체 구조 한눈에

```
[폰/PC 브라우저]
   │  카카오·구글·네이버 로그인
   ▼
[Next.js 웹앱 — Vercel에 배포]
   ├─ Auth.js : 카카오·구글·네이버 로그인 처리 (세 개 다 기본 지원)
   ├─ /api/score : 사진을 받아 서버에서 Claude API로 채점 (API 키는 서버에만)
   ├─ /api/battle : 승패 기록 → 랭킹 반영
   └─ Postgres DB (Neon) : 사용자, 사진 지문별 점수, 배틀 기록, 랭킹
```

| 구성 | 쓰는 것 | 이유 |
|---|---|---|
| 웹 프레임워크 | Next.js (TypeScript) | 화면과 서버 API를 한 프로젝트로 만들 수 있음 |
| 로그인 | Auth.js (NextAuth v5) | Google·Kakao·Naver 로그인을 모두 기본 제공 |
| DB | Neon Postgres (Vercel에서 바로 연결) | 무료 구간 있음, Vercel이 접속 주소를 자동으로 넣어 줌 |
| 배포 | Vercel | GitHub에 올리면 자동 배포, `https://프로젝트명.vercel.app` 주소가 바로 생김 |
| AI 채점 | Claude API (Anthropic) | 서버에서 호출 → 플레이어는 Claude 계정이 없어도 됨 |

**사진은 저장하지 않는다.** 채점할 때만 Claude API로 보내고 버린다. DB에는 사진 지문(해시)과 점수만 남긴다.
같은 사진은 같은 점수, 같은 사진끼리 붙으면 승자가 같다는 규칙을 이제 **서버 DB 기준**으로 지키므로, 기기가 달라도 결과가 같다.

---

## 1. 먼저 정해 줄 것 (3가지)

1. **서비스 주소 이름** — Vercel 프로젝트 이름이 곧 주소가 된다. 예: `otbbal-battle` → `https://otbbal-battle.vercel.app`. 로그인 앱 등록 때 이 주소를 넣어야 해서 먼저 정해 두면 편하다. (나중에 개인 도메인을 사면 바꿀 수 있음)
2. **랭킹 기준** — 기본안: 로그인한 사람이 **1P(내 사진)**, 상대 사진은 2P.
   - 🏆 **최고 점수 랭킹**: 내가 올린 사진 중 가장 높은 점수
   - ⚔️ **승수 랭킹**: 이긴 판 수 (같은 사진 상대로 반복해서 승수 쌓기는 막음)
   - 기간: 주간 + 전체
   - 다르게 하고 싶으면 말해 주면 됨.
3. **채점 모델** (비용이 갈리는 부분. 가격은 Anthropic 공식 표 기준, 1M 토큰당 입력/출력):
   - `claude-opus-5-5` — 가장 똑똑함. $4 / $20. 사진 1장 채점에 대략 1~2센트 예상
   - `claude-haiku-5-5` — 훨씬 싸고 빠름. $0.10 / $0.50. 사진 1장에 1센트의 몇십분의 1 수준
   - 사진 1장은 입력 약 1,500~2,000토큰 정도로 잡은 대략적인 추정이다. 실제 비용은 배포 후 Console 사용량에서 확인해야 한다.
   - 기본 추천은 Opus 5.5로 만들어 두고, 사용자가 늘면 바꿀지 정하는 것. 선택은 사용자 몫.

---

## 2. 사용자가 할 일 — 순서대로

> 키·비밀번호는 **채팅에 붙여 넣지 말 것.** 마지막 단계에서 `.env.local` 파일과 Vercel 설정 화면에 직접 넣는다.
> 화면 메뉴 이름은 서비스가 자주 바꿔서 아래와 조금 다를 수 있다.

### 2-1. GitHub 새 저장소 (5분)

- `closet-project`(연구 저장소)와 **섞지 말고** 새 저장소를 만든다. 예: `ootd-battle`, Private.
- 비어 있는 채로 두면 Claude가 코드를 만들어 올린다. (`gh`로 Claude가 대신 만들어도 됨 — 말만 해 줘)

### 2-2. Anthropic API 키 (10분)

1. https://console.anthropic.com 가입 / 로그인
2. **Billing**: 결제수단 등록 → 크레딧 충전 (처음엔 소액, 예: $10)
3. **Limits**: 월 사용 한도(spend limit)를 낮게 걸어 둔다. 공개 게임이라 누가 연타하면 비용이 튈 수 있다.
4. **API Keys** → Create Key → 이름 `ootd-battle-prod` → 생성된 `sk-ant-...` 키는 **한 번만 보여주니** 바로 메모장 등 안전한 곳에 저장
5. 나중에 넣을 이름: `ANTHROPIC_API_KEY`

### 2-3. Vercel + DB (10분)

1. https://vercel.com 가입 (GitHub 계정으로)
2. 코드가 저장소에 올라간 뒤: **Add New → Project → `ootd-battle` 저장소 Import** → 프로젝트 이름을 1번에서 정한 이름으로 → Deploy
3. 프로젝트 화면 → **Storage → Create Database → Neon (Postgres)** → 지역은 가까운 곳(예: 도쿄·싱가포르 계열, 서울이 있으면 서울) → 프로젝트에 연결
   - 연결하면 `DATABASE_URL` 같은 환경변수가 **자동으로 들어간다**
4. 이제 서비스 주소가 확정된다: `https://프로젝트명.vercel.app`

> 코드가 아직 없을 때는 2-4~2-6의 주소 칸에 일단 `http://localhost:3000` 것만 넣어 두고, 배포 주소는 나중에 추가해도 된다.

### 2-4. 구글 로그인 (15분)

1. https://console.cloud.google.com → 상단에서 새 프로젝트 `ootd-battle` 생성
2. 왼쪽 메뉴 **Google Auth Platform** (예전 이름: OAuth 동의 화면)
   - **브랜딩**: 앱 이름 `옷빨 배틀`, 지원 이메일, 개발자 연락처
   - **대상(Audience)**: 외부(External)
   - 처음엔 "테스트" 상태라 등록한 테스트 사용자만 로그인된다 → 공개할 때 **앱 게시(Publish)** 누르기. 이름·이메일·프로필 사진만 받으면 보통 별도 심사 없이 게시된다.
3. **클라이언트(Clients) → 클라이언트 만들기 → 웹 애플리케이션**
   - 승인된 JavaScript 원본: `http://localhost:3000`, `https://프로젝트명.vercel.app`
   - 승인된 리디렉션 URI:
     - `http://localhost:3000/api/auth/callback/google`
     - `https://프로젝트명.vercel.app/api/auth/callback/google`
4. 만들어진 **클라이언트 ID / 클라이언트 보안 비밀번호** 저장
5. 넣을 이름: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`

### 2-5. 카카오 로그인 (15분)

1. https://developers.kakao.com → 로그인 → **내 애플리케이션 → 애플리케이션 추가하기** (앱 이름 `옷빨 배틀`, 회사명은 개인이면 본인 이름)
2. **앱 키**: `REST API 키` = 클라이언트 ID
3. **플랫폼 → Web**: 사이트 도메인에 `http://localhost:3000`, `https://프로젝트명.vercel.app`
4. **카카오 로그인**: 활성화 **ON**
   - Redirect URI:
     - `http://localhost:3000/api/auth/callback/kakao`
     - `https://프로젝트명.vercel.app/api/auth/callback/kakao`
5. **카카오 로그인 → 동의항목**: `닉네임`, `프로필 사진` 설정 (필수 또는 선택)
   - 카카오계정 **이메일**은 비즈 앱 전환(개인은 본인인증으로 가능)을 해야 받을 수 있다. 랭킹에는 닉네임이면 충분하니 처음엔 안 받아도 된다.
6. **보안 → Client Secret**: 코드 생성 → 활성화 상태 **사용함**
7. 넣을 이름: `AUTH_KAKAO_ID` (= REST API 키), `AUTH_KAKAO_SECRET` (= Client Secret)

### 2-6. 네이버 로그인 (15분 + 검수 대기)

1. https://developers.naver.com → **Application → 애플리케이션 등록**
2. 애플리케이션 이름 `옷빨 배틀`, 사용 API **네이버 로그인**
3. 제공 정보 선택: `별명`, `프로필 사진` (이메일은 필요하면 추가)
4. 로그인 오픈 API 서비스 환경: **PC 웹** (모바일 웹도 같이 추가)
   - 서비스 URL: `https://프로젝트명.vercel.app`
   - Callback URL:
     - `http://localhost:3000/api/auth/callback/naver`
     - `https://프로젝트명.vercel.app/api/auth/callback/naver`
5. 등록 후 **Client ID / Client Secret** 저장
6. ⚠️ 등록 직후는 **"개발 중"** 상태라 관리자와 **멤버관리에 등록한 테스터 계정만** 로그인된다. 일반 공개하려면 **검수 요청**을 해야 하고, 검수 때 서비스 화면·개인정보처리방침을 본다 (며칠 걸릴 수 있음).
7. 넣을 이름: `AUTH_NAVER_ID`, `AUTH_NAVER_SECRET`

### 2-7. 키 넣기 (5분)

**① 내 PC에서 테스트할 때** — 코드 폴더에 `.env.local` 파일을 만들고 아래를 채운다. 이 파일은 `.gitignore`에 들어가서 GitHub에 올라가지 않는다.

```
AUTH_SECRET=            # 터미널에서 `npx auth secret` 실행하면 자동 생성
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=
AUTH_KAKAO_ID=
AUTH_KAKAO_SECRET=
AUTH_NAVER_ID=
AUTH_NAVER_SECRET=
ANTHROPIC_API_KEY=
DATABASE_URL=           # Vercel Storage 화면에서 복사
```

**② 배포 서버** — Vercel 프로젝트 → **Settings → Environment Variables**에 위와 같은 이름으로 넣는다 (`DATABASE_URL`은 이미 들어가 있음). 넣고 나서 **Redeploy**.

---

## 3. 법적으로 챙길 것 (공개 전)

로그인으로 개인정보(닉네임·프로필 사진 등)를 받고, 사진을 해외(미국, Anthropic) 서버로 보내기 때문에 아래가 필요하다. **초안은 Claude가 써 줄 수 있지만, 최종 확인은 사용자 책임**이다.

- **개인정보처리방침 페이지** — 수집 항목, 목적, 보관 기간, 파기, 문의처. 네이버 검수 때도 본다.
- **국외 이전 고지** — 채점용 사진이 Anthropic(미국)으로 전송되고 저장하지 않는다는 점, Vercel·Neon 서버 위치.
- **이용약관** — 남의 사진 무단 업로드 금지, 신고·삭제 방법.
- **만 14세 미만 가입 제한** — 만 14세 미만은 법정대리인 동의가 필요하므로 "만 14세 이상" 체크로 막는 게 간단하다.
- **연예인·타인 사진 문제** — 랭킹을 노리고 남의 사진을 올릴 수 있다. 신고 버튼 + 랭킹에서 내리는 관리자 기능을 넣는다.

---

## 4. 비용·남용 막기 (Claude가 코드로 넣을 것)

- 한 사람당 하루 채점 횟수 제한 (예: 20장)
- 같은 사진은 다시 채점하지 않음 (지문 캐시) → 비용 절약 + 점수 고정
- 로그인 안 한 사람은 체험 몇 판만, 랭킹 등록은 로그인 필수
- Anthropic Console의 월 한도가 최후 안전장치

---

## 5. Claude가 만들 것

| 단계 | 내용 |
|---|---|
| 1 | Next.js 프로젝트 뼈대, 지금 밤티 디자인을 그대로 옮기기 (START 버튼, 0.8초 긴장 연출, 한줄평 10종) |
| 2 | Auth.js로 카카오·구글·네이버 로그인 버튼과 세션 |
| 3 | `/api/score`: 사진 지문 확인 → 없으면 Claude API로 채점 → DB 저장 (사진은 저장 안 함) |
| 4 | `/api/battle`: 승패 저장, 동점 규칙(색감→핏→조화→센스→지문) 그대로 |
| 5 | 랭킹 페이지 (주간·전체, 최고 점수·승수) |
| 6 | 하루 제한, 신고 버튼, 관리자 숨기기 |
| 7 | 개인정보처리방침·이용약관 초안 페이지 |
| 8 | 로컬 실행·배포 확인 |

로그인 키가 없어도 1, 3~5는 먼저 만들 수 있다. 사용자가 2장을 하는 동안 병행 가능.

---

## 6. 체크리스트

- [ ] 서비스 주소 이름 정하기
- [ ] 랭킹 기준·채점 모델 정하기 (기본안 그대로면 "기본안 OK")
- [ ] GitHub 새 저장소 `ootd-battle`
- [ ] Anthropic: 결제·월 한도·API 키
- [ ] Vercel 가입 (프로젝트·DB는 코드 올라간 뒤)
- [ ] 구글 OAuth 클라이언트
- [ ] 카카오 앱 + Client Secret
- [ ] 네이버 앱 (+ 공개 전 검수 요청)
- [ ] `.env.local` / Vercel 환경변수 입력
- [ ] 개인정보처리방침·약관 검토
