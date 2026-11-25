# 옷빨 배틀 웹앱 준비 가이드 (Supabase + Claude)

작성 2026-11-25, 같은 날 Supabase 구성으로 수정. 지금 아티팩트 버전(claude.ai 안에서만 도는 프로토타입)을 누구나 들어올 수 있는 진짜 웹사이트로 옮기는 데 필요한 준비물과 순서를 정리한 문서다.
**사용자가 직접 해야 하는 일**(계정 만들기, 키 발급, 로그인 앱 등록, 결제)과 **Claude가 할 일**(코드)을 나눠 적었다.

---

## 0. 전체 구조 한눈에

```
[폰/PC 브라우저]
   │  구글·카카오 로그인 (Supabase Auth)
   ▼
[Next.js 웹앱 — Vercel에 배포]
   ├─ /api/score : 사진을 받아 서버에서 Claude API로 채점 (API 키는 서버에만)
   ├─ /api/battle : 승패 기록 → 랭킹 반영
   ▼
[Supabase]
   ├─ Auth : 구글·카카오 로그인, 세션
   └─ Postgres DB : 사용자, 사진 지문별 점수, 배틀 기록, 랭킹
```

| 구성 | 쓰는 것 | 이유 |
|---|---|---|
| 웹 프레임워크 | Next.js (TypeScript) | 화면과 서버 API를 한 프로젝트로 만들 수 있음 |
| 로그인 | Supabase Auth | 구글·카카오가 기본 제공. DB와 같은 곳이라 사용자 연결이 쉬움 |
| DB | Supabase Postgres | 무료 구간 있음. 대시보드에서 표를 바로 볼 수 있음 |
| 배포 | Vercel | GitHub에 올리면 자동 배포, `https://프로젝트명.vercel.app` 주소가 바로 생김 |
| AI 채점 | Claude API (Anthropic) | 서버에서 호출 → 플레이어는 Claude 계정이 없어도 됨 |

**사진은 저장하지 않는다.** 채점할 때만 Claude API로 보내고 버린다. DB에는 사진 지문(해시)과 점수만 남긴다.
같은 사진은 같은 점수, 같은 사진끼리 붙으면 승자가 같다는 규칙을 이제 **서버 DB 기준**으로 지키므로, 기기가 달라도 결과가 같다.

**네이버 로그인은 1차 배포에서 뺀다.** Supabase Auth 기본 목록에 네이버가 없어서 따로 붙이는 작업이 필요하고, 네이버는 공개 전 검수도 받아야 한다. 구글·카카오로 먼저 배포하고 나중에 추가한다.

---

## 1. 먼저 정해 줄 것 (3가지)

1. **서비스 주소 이름** — Vercel 프로젝트 이름이 곧 주소가 된다. 예: `otbbal-battle` → `https://otbbal-battle.vercel.app`. Supabase 로그인 설정에 이 주소를 넣어야 해서 먼저 정해 두면 편하다. (나중에 개인 도메인을 사면 바꿀 수 있음)
2. **랭킹 기준** — 기본안: 로그인한 사람이 **1P(내 사진)**, 상대 사진은 2P.
   - 🏆 **최고 점수 랭킹**: 내가 올린 사진 중 가장 높은 점수
   - ⚔️ **승수 랭킹**: 이긴 판 수 (같은 사진 상대로 반복해서 승수 쌓기는 막음)
   - 기간: 주간 + 전체
   - 다르게 하고 싶으면 말해 주면 됨.
3. **채점 모델** — 비용이 갈리는 부분. 가격은 바뀔 수 있으니 정할 때 Anthropic 공식 가격표로 확인한다.
   - Opus 계열: 가장 똑똑하지만 비쌈
   - Haiku 계열: 훨씬 싸고 빠름
   - 사진 1장은 입력 약 1,500~2,000토큰 정도로 잡은 대략적인 추정이다. 실제 비용은 배포 후 Console 사용량에서 확인해야 한다.
   - 선택은 사용자 몫. 코드에서는 모델 이름을 환경변수 하나로 바꿀 수 있게 만든다.

---

## 2. 사용자가 할 일 — 순서대로

> 키·비밀번호는 **채팅에 붙여 넣지 말 것.** 마지막 단계에서 `.env.local` 파일과 Vercel 설정 화면에 직접 넣는다.
> 화면 메뉴 이름은 서비스가 자주 바꿔서 아래와 조금 다를 수 있다.

### 2-1. GitHub 저장소 ✅ 완료

- `jiwoon-oh/fashion-ai` 저장소를 그대로 쓴다. Claude가 이 저장소에 Next.js 코드를 올린다.

### 2-2. Anthropic API 키 (10분)

1. https://console.anthropic.com 가입 / 로그인
2. **Billing**: 결제수단 등록 → 크레딧 충전 (처음엔 소액, 예: $10)
3. **Limits**: 월 사용 한도(spend limit)를 낮게 걸어 둔다. 공개 게임이라 누가 연타하면 비용이 튈 수 있다.
4. **API Keys** → Create Key → 이름 `ootd-battle-prod` → 생성된 `sk-ant-...` 키는 **한 번만 보여주니** 바로 메모장 등 안전한 곳에 저장
5. 나중에 넣을 이름: `ANTHROPIC_API_KEY`

### 2-3. Supabase 프로젝트 (10분)

1. https://supabase.com 가입 (GitHub 계정으로 가능)
2. **New project** → 이름 `ootd-battle` → DB 비밀번호는 자동 생성 후 안전한 곳에 저장 → 지역(Region)은 **Seoul**(없으면 Tokyo) → 무료 플랜
3. 생성되면 **Project Settings → API (또는 API Keys)** 에서 아래 값을 확인해 둔다:
   - **Project URL** (`https://xxxx.supabase.co`) → 넣을 이름 `NEXT_PUBLIC_SUPABASE_URL`
   - **공개 키** (publishable 키, 예전 이름 anon 키) → 넣을 이름 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - **비밀 키** (secret 키, 예전 이름 service_role 키) → 넣을 이름 `SUPABASE_SECRET_KEY`
     - ⚠️ 비밀 키는 DB를 마음대로 고칠 수 있는 키다. 서버에만 넣고 절대 공개하지 않는다.
4. **Authentication → URL Configuration**
   - Site URL: `https://프로젝트명.vercel.app` (아직 없으면 일단 `http://localhost:3000`)
   - Redirect URLs에 추가: `http://localhost:3000/**`, `https://프로젝트명.vercel.app/**`
5. **SQL Editor → New query** → 저장소의 [`supabase/schema.sql`](supabase/schema.sql) 내용을 통째로 붙여 넣고 **Run**. (표 3개 + 랭킹 계산 함수가 만들어진다. 여러 번 실행해도 안전)
6. 참고: 무료 프로젝트는 한동안 아무도 안 쓰면 일시정지될 수 있다. 대시보드에서 다시 켜면 된다.

> 아래 구글·카카오 등록에 쓰는 **콜백 주소는 Supabase 주소 하나**다:
> `https://xxxx.supabase.co/auth/v1/callback`
> 정확한 값은 Supabase **Authentication → Sign In / Providers → Google(또는 Kakao)** 화면에 "Callback URL"로 나와 있으니 거기서 복사한다.

### 2-4. 구글 로그인 (15분)

1. https://console.cloud.google.com → 상단에서 새 프로젝트 `ootd-battle` 생성
2. 왼쪽 메뉴 **Google Auth Platform** (예전 이름: OAuth 동의 화면)
   - **브랜딩**: 앱 이름 `옷빨 배틀`, 지원 이메일, 개발자 연락처
   - **대상(Audience)**: 외부(External)
   - 처음엔 "테스트" 상태라 등록한 테스트 사용자만 로그인된다 → 공개할 때 **앱 게시(Publish)** 누르기. 이름·이메일·프로필 사진만 받으면 보통 별도 심사 없이 게시된다.
3. **클라이언트(Clients) → 클라이언트 만들기 → 웹 애플리케이션**
   - 승인된 JavaScript 원본: `http://localhost:3000`, `https://프로젝트명.vercel.app`
   - 승인된 리디렉션 URI: **Supabase 콜백 주소** `https://xxxx.supabase.co/auth/v1/callback`
4. 만들어진 **클라이언트 ID / 클라이언트 보안 비밀번호**를
   Supabase **Authentication → Sign In / Providers → Google**에 붙여 넣고 **Enable** 켜기 → Save
   - 이 두 값은 Supabase에만 넣는다. `.env.local`이나 Vercel에는 안 넣어도 된다.

### 2-5. 카카오 로그인 (15분)

1. https://developers.kakao.com → 로그인 → **내 애플리케이션 → 애플리케이션 추가하기** (앱 이름 `옷빨 배틀`, 회사명은 개인이면 본인 이름)
2. **앱 키**: `REST API 키` = 클라이언트 ID
3. **플랫폼 → Web**: 사이트 도메인에 `http://localhost:3000`, `https://프로젝트명.vercel.app`
4. **카카오 로그인**: 활성화 **ON**
   - Redirect URI: **Supabase 콜백 주소** `https://xxxx.supabase.co/auth/v1/callback`
5. **카카오 로그인 → 동의항목**: `닉네임`, `프로필 사진` 설정 (필수 또는 선택)
   - 카카오계정 **이메일**은 비즈 앱 전환(개인은 본인인증으로 가능)을 해야 받을 수 있다. Supabase의 Kakao 설정 화면에 이메일 없이 로그인을 허용하는 옵션이 있으면 켜 둔다. 없거나 로그인이 막히면 Claude에게 화면을 알려 주면 된다.
6. **보안 → Client Secret**: 코드 생성 → 활성화 상태 **사용함**
7. **REST API 키 / Client Secret**을 Supabase **Authentication → Sign In / Providers → Kakao**에 붙여 넣고 **Enable** 켜기 → Save

### 2-6. Vercel (10분, 코드가 올라간 뒤)

1. https://vercel.com 가입 (GitHub 계정으로)
2. **Add New → Project → `fashion-ai` 저장소 Import** → 프로젝트 이름을 1번에서 정한 이름으로
3. Deploy 전에 **Environment Variables**에 아래 2-7의 값을 넣는다 → Deploy
4. 배포 주소가 확정되면 2-3의 Site URL·Redirect URLs, 2-4·2-5의 원본·도메인에 그 주소가 들어가 있는지 다시 확인

### 2-7. 키 넣기 (5분)

**① 내 PC에서 테스트할 때** — 코드 폴더에 `.env.local` 파일을 만들고 아래를 채운다. 이 파일은 `.gitignore`에 들어가서 GitHub에 올라가지 않는다.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
ANTHROPIC_API_KEY=
```

**② 배포 서버** — Vercel 프로젝트 → **Settings → Environment Variables**에 같은 이름으로 넣는다. 나중에 바꾸면 **Redeploy**.

구글·카카오 키는 Supabase 안에만 들어가므로 여기엔 없다.

선택 항목 (`.env.example` 참고):
- `SCORE_MODEL` — 채점 모델. 비우면 `claude-opus-5-5`. 싸게 가려면 `claude-haiku-5-5`.
- `DAILY_SCORE_LIMIT` / `ANON_DAILY_SCORE_LIMIT` — 하루 채점 장수 제한 (기본 20 / 6).

### 2-8. 내 PC에서 실행해 보기

```
npm install
npm run dev
```

→ 브라우저에서 `http://localhost:3000`. `ANTHROPIC_API_KEY`가 없으면 **가짜 점수 모드**로 돌아서 키 없이도 화면을 시험할 수 있다. Supabase 키가 없으면 로그인·랭킹만 꺼진다.

---

## 3. 법적으로 챙길 것 (공개 전)

로그인으로 개인정보(닉네임·프로필 사진 등)를 받고, 사진을 해외(미국, Anthropic) 서버로 보내기 때문에 아래가 필요하다. **초안은 Claude가 써 줄 수 있지만, 최종 확인은 사용자 책임**이다.

- **개인정보처리방침 페이지** — 수집 항목, 목적, 보관 기간, 파기, 문의처. 나중에 네이버를 붙일 때 검수에서도 본다.
- **국외 이전 고지** — 채점용 사진이 Anthropic(미국)으로 전송되고 저장하지 않는다는 점, Vercel·Supabase 서버 위치.
- **이용약관** — 남의 사진 무단 업로드 금지, 신고·삭제 방법.
- **만 14세 미만 가입 제한** — 만 14세 미만은 법정대리인 동의가 필요하므로 "만 14세 이상" 체크로 막는 게 간단하다.
- **연예인·타인 사진 문제** — 랭킹을 노리고 남의 사진을 올릴 수 있다. 신고 버튼 + 랭킹에서 내리는 관리자 기능을 넣는다.

---

## 4. 비용·남용 막기 (Claude가 코드로 넣을 것)

- 한 사람당 하루 채점 횟수 제한 (예: 20장)
- 같은 사진은 다시 채점하지 않음 (지문 캐시) → 비용 절약 + 점수 고정
- 로그인 안 한 사람은 체험 몇 판만, 랭킹 등록은 로그인 필수
- DB 표에 Supabase RLS(행 단위 보안)를 걸어서 브라우저에서 점수를 직접 고치지 못하게 함. 점수 쓰기는 서버만.
- Anthropic Console의 월 한도가 최후 안전장치

---

## 5. Claude가 만들 것

| 단계 | 내용 |
|---|---|
| 1 | Next.js 프로젝트 뼈대, 지금 밤티 디자인을 그대로 옮기기 (START 버튼, 0.8초 긴장 연출, 한줄평 10종) |
| 2 | Supabase 표 설계(SQL)와 RLS 정책 |
| 3 | `/api/score`: 사진 지문 확인 → 없으면 Claude API로 채점 → DB 저장 (사진은 저장 안 함) |
| 4 | `/api/battle`: 승패 저장, 동점 규칙(색감→핏→조화→센스→지문) 그대로 |
| 5 | Supabase Auth로 구글·카카오 로그인 버튼과 세션 |
| 6 | 랭킹 페이지 (주간·전체, 최고 점수·승수) |
| 7 | 하루 제한, 신고 버튼, 관리자 숨기기 |
| 8 | 개인정보처리방침·이용약관 초안 페이지 |
| 9 | 로컬 실행·배포 확인 |

로그인 설정이 없어도 1, 3, 4, 6은 먼저 만들 수 있다. 사용자가 2장을 하는 동안 병행 가능.

---

## 6. 체크리스트

- [ ] 서비스 주소 이름 정하기
- [ ] 랭킹 기준·채점 모델 정하기 (기본안 그대로면 "기본안 OK")
- [x] GitHub 저장소 (`fashion-ai`)
- [ ] Anthropic: 결제·월 한도·API 키
- [ ] Supabase 프로젝트 생성 + URL·공개 키·비밀 키 확인 + URL Configuration
- [ ] 구글 OAuth 클라이언트 → Supabase에 입력
- [ ] 카카오 앱 + Client Secret → Supabase에 입력
- [ ] Vercel 가입 (프로젝트는 코드 올라간 뒤)
- [ ] `.env.local` / Vercel 환경변수 입력
- [ ] 개인정보처리방침·약관 검토
- [ ] (나중에) 네이버 로그인 추가 + 검수
