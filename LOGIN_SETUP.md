# 배포 + 구글·카카오·네이버 로그인 연동 가이드

작성 2026-11-26. 공식 문서(Supabase, Google, Kakao, Naver) 기준으로 정리했다. 콘솔 화면 메뉴 이름은 자주 바뀌니 조금 달라도 같은 뜻의 메뉴를 찾으면 된다.
**키·비밀번호는 채팅에 붙여 넣지 말 것.** Vercel·Supabase 화면에 직접 넣는다.

전체 순서:

1. **AI 키 없이 먼저 배포** → 서비스 주소가 생김
2. **Supabase** 만들고 Vercel에 연결 → 로그인·랭킹 준비
3. **구글** 로그인
4. **카카오** 로그인
5. **네이버** 로그인 (검수 때문에 제일 오래 걸림)
6. 나중에 Anthropic 키를 넣으면 진짜 AI 채점 시작

---

## 1. AI 키 없이 먼저 배포하기 (10분)

가능하다. 키가 없을 때는 **가짜 점수 모드**로 돌게 해 둠:
- 점수는 사진 지문으로 정해지는 가짜 숫자, 한줄평 앞에 `(가짜 점수)`가 붙는다.
- 가짜 점수는 **DB에 저장하지 않고 랭킹에도 안 올라간다.** 나중에 진짜 키를 넣어도 랭킹이 오염되지 않는다.
- AI를 안 부르니 **비용 0원.**

순서:

1. https://vercel.com → **Sign Up → Continue with GitHub** (jiwoon-oh 계정)
2. **Add New… → Project** → `fashion-ai` 저장소 옆 **Import**
   - 목록에 없으면 "Adjust GitHub App Permissions"에서 이 저장소 접근을 허용
3. 설정 화면:
   - **Project Name**: 서비스 주소가 된다. 예: `otbbal-battle` → `https://otbbal-battle.vercel.app`
   - Framework Preset: **Next.js** (자동 선택됨). 나머지는 그대로
   - **Environment Variables**에 하나 추가: `MOCK_SCORING` = `1`
4. **Deploy** → 1~2분 뒤 주소가 나온다. 폰으로 열어서 사진 두 장 넣고 START 눌러 보기.

> 이 상태에서는 로그인 버튼이 꺼져 있고 랭킹은 비어 있다. 2번을 하면 켜진다.
> 이후 GitHub `main`에 푸시할 때마다 Vercel이 자동으로 다시 배포한다.

---

## 2. Supabase 만들고 연결하기 (15분)

1. https://supabase.com → **Start your project** → GitHub로 가입
2. **New project**
   - Name: `ootd-battle`
   - Database Password: **Generate a password** → 안전한 곳에 저장 (평소엔 안 씀)
   - Region: **Northeast Asia (Seoul)** (없으면 Tokyo)
   - 플랜: Free
3. 1~2분 기다린 뒤 왼쪽 **SQL Editor → New query** → 저장소의 [`supabase/schema.sql`](supabase/schema.sql) 내용을 통째로 붙여 넣고 **Run**
   - "Success" 가 나오면 끝. 표 3개(profiles, photo_scores, battles)와 랭킹 함수가 생긴다.
4. **Project Settings → API Keys** (또는 Data API)에서 세 값을 확인:
   - Project URL `https://xxxx.supabase.co` — 이 `xxxx`가 **프로젝트 ref**. 아래 로그인 설정에 계속 나온다.
   - **Publishable key** (`sb_publishable_...`, 예전 이름 anon key)
   - **Secret key** (`sb_secret_...`, 예전 이름 service_role key) — ⚠️ DB를 마음대로 고칠 수 있는 키. 절대 공개 금지.
5. **Authentication → URL Configuration**
   - **Site URL**: `https://otbbal-battle.vercel.app` (1번에서 받은 주소)
   - **Redirect URLs → Add URL**: 두 개 추가
     - `https://otbbal-battle.vercel.app/**`
     - `http://localhost:3000/**`
6. Vercel → 프로젝트 → **Settings → Environment Variables**에 추가:

   | 이름 | 값 |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key |
   | `SUPABASE_SECRET_KEY` | Secret key |

7. Vercel → **Deployments** → 맨 위 배포의 **⋯ → Redeploy**
   - `NEXT_PUBLIC_`으로 시작하는 값은 빌드할 때 박히므로 **꼭 Redeploy** 해야 반영된다.

> 가짜 점수 모드(`MOCK_SCORING=1`)인 동안에는 로그인해도 랭킹에 안 올라간다. 로그인 자체는 시험할 수 있다.

**세 로그인이 공통으로 쓰는 주소 (Supabase 콜백):**
```
https://xxxx.supabase.co/auth/v1/callback
```
구글·카카오·네이버 콘솔의 "리디렉션 URI / Callback URL"에는 **우리 사이트 주소가 아니라 이 주소**를 넣는다. 각 Provider 설정 화면에도 "Callback URL"로 표시돼 있으니 거기서 복사하면 정확하다.

---

## 3. 구글 로그인 (15분)

### 3-1. Google Cloud 콘솔
1. https://console.cloud.google.com → 맨 위 프로젝트 선택 → **새 프로젝트** → 이름 `ootd-battle` → 만들기
2. 왼쪽 메뉴(☰) → **Google Auth Platform** (예전 이름: OAuth 동의 화면) → **시작하기**
3. **브랜딩(Branding)**
   - 앱 이름: `옷빨 배틀`
   - 사용자 지원 이메일: 본인 이메일
   - (선택) 앱 로고, 홈페이지 `https://otbbal-battle.vercel.app`, 개인정보처리방침 링크
   - 승인된 도메인: `vercel.app` 계정 도메인은 등록이 안 될 수 있다 → 안 되면 비워 두고 진행 (개인 도메인을 사면 그때 등록)
   - 개발자 연락처 이메일
4. **대상(Audience)**
   - 사용자 유형: **외부(External)**
   - 처음엔 "테스트 중" 상태 → **앱 게시(Publish app)** 를 눌러 "프로덕션"으로 바꾼다.
   - 이름·이메일·프로필(기본 범위)만 쓰면 **별도 앱 심사 없이** 게시된다.
5. **데이터 액세스(Data Access)** → 범위 추가: `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` (기본으로 들어가 있으면 그대로)
6. **클라이언트(Clients) → 클라이언트 만들기**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 이름: `ootd-battle web`
   - **승인된 JavaScript 원본**: `https://otbbal-battle.vercel.app`, `http://localhost:3000`
   - **승인된 리디렉션 URI**: `https://xxxx.supabase.co/auth/v1/callback` ← Supabase 콜백
   - 만들기 → **클라이언트 ID**와 **클라이언트 보안 비밀번호** 복사

### 3-2. Supabase
1. **Authentication → Sign In / Providers → Google**
2. **Enable Sign in with Google** 켜기
3. Client IDs: 클라이언트 ID / Client Secret: 보안 비밀번호 → **Save**

### 3-3. 알아둘 것
- 구글 로그인 창에 "**xxxx.supabase.co**(으)로 이동"이라고 보인다. 우리 앱 이름·로고가 뜨게 하려면 구글의 **브랜드 인증**(며칠 걸림)이 필요하다. 처음엔 없어도 로그인은 된다.
- 오류 `redirect_uri_mismatch` → 6번의 리디렉션 URI가 Supabase 콜백과 한 글자라도 다름.

---

## 4. 카카오 로그인 (20분)

⚠️ Supabase는 카카오에 **닉네임 + 프로필 사진 + 카카오계정 이메일**을 기본으로 요청한다. 이메일 동의항목을 켤 수 없는 앱이면 로그인 때 오류가 날 수 있다. 그래서 아래처럼 **비즈 앱 전환 → 이메일을 선택 동의로 설정**하는 걸 권장한다. (실제로 오류가 나는지는 아직 시험 전)

### 4-1. Kakao Developers
1. https://developers.kakao.com → 카카오 계정으로 로그인 → **내 애플리케이션 → 애플리케이션 추가하기**
   - 앱 이름: `옷빨 배틀` / 회사명: 개인이면 본인 이름 / 카테고리 선택 → 저장
2. **비즈 앱 전환** (이메일을 받기 위해)
   - **앱 → 일반 → 비즈니스 정보** → 사업자 번호가 없으면 **개인 개발자 비즈 앱**으로 전환 (본인인증 + 카카오비즈니스 약관 동의)
3. **카카오 로그인 → 사용 설정** → 상태 **ON**
   - OFF면 로그인 때 `KOE004` 오류
4. **리다이렉트 URI 등록**
   - 새 콘솔: **앱 → 플랫폼 키 → REST API 키 → 카카오 로그인 리다이렉트 URI**
   - (예전 콘솔이면: 카카오 로그인 → Redirect URI)
   - `https://xxxx.supabase.co/auth/v1/callback` ← Supabase 콜백
   - 한 글자라도 다르면 `KOE006` 오류
5. **카카오 로그인 → 동의항목**
   - 닉네임(`profile_nickname`): **필수 동의**
   - 프로필 사진(`profile_image`): **선택 동의**
   - 카카오계정(이메일)(`account_email`): **선택 동의** (비즈 앱이어야 설정 가능)
   - 동의 목적: "랭킹에 표시할 닉네임, 계정 식별" 정도로 작성
6. **Client Secret**
   - 새 콘솔: **앱 → 플랫폼 키 → REST API 키 → 클라이언트 시크릿** (예전 콘솔: 보안 → Client Secret)
   - 코드 생성 → 활성화 상태 **사용함** → 코드 복사
7. **REST API 키** 복사 (앱 → 플랫폼 키, 또는 앱 키 화면)

### 4-2. Supabase
1. **Authentication → Sign In / Providers → Kakao** → **Enable**
2. Kakao Client ID: **REST API 키** / Kakao Client Secret: **Client Secret 코드**
3. **Allow users without an email** 켜기 (이메일 동의를 안 한 사람도 로그인되게)
4. **Save**

### 4-3. 알아둘 것
- 랭킹에는 카카오 **닉네임**의 첫 글자만 보인다 (`홍**`).
- 이메일 동의항목을 끝내 못 켜서 로그인 오류가 나면 말해 줘 → 이메일을 요청하지 않게 코드 쪽에서 우회하는 방법을 찾아 붙인다.

---

## 5. 네이버 로그인 (20분 + 검수 2~3 영업일)

Supabase 기본 목록에는 네이버가 없다. 대신 2026년부터 생긴 **Custom Provider(커스텀 로그인 제공자)** 기능으로 붙인다. 네이버가 지금은 **OpenID Connect(OIDC)** 를 지원해서 이 방식이 가능하다.
⚠️ 이 조합(Supabase 커스텀 + 네이버 OIDC)은 공식 문서상 가능해 보이지만 **아직 실제로 시험 전**이다. 아래대로 설정해서 **본인 네이버 아이디로 먼저 시험**해 보고, 안 되면 말해 줘 → 중간 변환 서버를 코드로 붙이는 우회책이 있다.

### 5-1. Naver Developers
1. https://developers.naver.com → 로그인 → **Application → 애플리케이션 등록**
2. **애플리케이션 이름**: `옷빨 배틀` (로그인 화면에 보임, 10자 이내 권장)
3. **사용 API**: **네이버 로그인** 선택
4. **제공 정보 선택**: 기본(이용자 식별자) + **별명** 정도만. 쓰지 않을 정보(휴대전화·생일 등)는 고르지 말 것 → 검수에서 반려 사유가 된다.
5. **로그인 오픈 API 서비스 환경**: **PC 웹** 추가 (필요하면 Mobile 웹도)
   - **서비스 URL**: `https://otbbal-battle.vercel.app`
   - **네이버 로그인 Callback URL**: `https://xxxx.supabase.co/auth/v1/callback` ← Supabase 콜백 (최대 5개)
6. 등록 → **Client ID**, **Client Secret** 복사

### 5-2. Supabase (Custom Provider)
1. **Authentication → Sign In / Providers → Custom Providers → New Provider**
2. 방식: **OIDC (Auto-discovery)**
3. 입력:
   - Identifier(식별자): `naver` → 코드에서는 `custom:naver`로 부른다 (이미 그렇게 짜 둠)
   - Client ID / Client Secret: 네이버에서 받은 값
   - Issuer: `https://nid.naver.com`
   - Scopes: `openid profile`
   - **Email optional(이메일 없이 허용)** 켜기 — 네이버 OIDC는 이메일을 주지 않는다
   - PKCE: 켬(기본값)
4. 저장 → 폼에 보이는 Callback URL이 5-1의 Callback URL과 같은지 확인

### 5-3. 버튼 켜기
- Vercel 환경변수에 `NEXT_PUBLIC_NAVER_LOGIN` = `1` 추가 → **Redeploy** → 로그인 창에 초록색 **N 네이버로** 버튼이 생긴다.

### 5-4. 검수 (일반 공개 전 필수)
- 검수 전에는 **등록자 본인 + 멤버관리 탭에 넣은 테스터**만 로그인된다.
- **내 애플리케이션 → 네이버 로그인 검수 상태** 탭 → 자료 첨부 → **검수 요청**
  - 로그인 버튼 화면부터 로그인 완료까지 **단계별 캡처**
  - 추가로 받은 정보(별명)가 실제로 쓰이는 화면 캡처 → **랭킹 페이지 캡처**
- 결과는 2~3 영업일 안에 이메일로 온다. 반려되면 고쳐서 재요청.
- 반려 잘 되는 이유: 쓰지도 않는 정보 요청, 가입 때 자체 비밀번호 요구, 네이버처럼 보이는 이름·로고.
- 개인정보처리방침 페이지를 요구할 수 있으니 검수 전에 만들어 두는 게 안전하다 (초안은 Claude가 써 줄 수 있음).

---

## 6. 확인 순서

1. 배포 주소 접속 → 오른쪽 위 **🔑 로그인** → 구글 / 카카오 / 네이버 각각 로그인
2. 로그인되면 오른쪽 위에 `👤 이름`이 보임
3. Supabase → **Table Editor → profiles**에 한 줄씩 생겼는지 확인
4. (Anthropic 키를 넣은 뒤) 배틀 한 판 → 상태 문구에 **(랭킹 반영됨)** → **🏆 랭킹** 페이지에 내 이름이 연두색으로

| 오류 | 원인 |
|---|---|
| 구글 `redirect_uri_mismatch` | 구글 클라이언트의 리디렉션 URI ≠ Supabase 콜백 |
| 카카오 `KOE004` | 카카오 로그인 사용 설정 OFF |
| 카카오 `KOE006` | 리다이렉트 URI 불일치 |
| 카카오 동의항목 관련 오류 | 이메일 등 요청한 항목이 동의항목에 설정 안 됨 → 4-1의 5번 |
| 로그인 후 메인으로 돌아와 "로그인 실패함" | Supabase **Redirect URLs**에 사이트 주소 `/**` 빠짐 (2번의 5) |
| 네이버 "등록되지 않은 사용자" 비슷한 화면 | 검수 전인데 테스터로 등록 안 된 아이디 |

---

## 7. 나중에 진짜 AI 채점 켜기

1. Anthropic Console에서 결제·**월 한도**·API 키 (WEBAPP_SETUP.md 2-2)
2. Vercel 환경변수: `ANTHROPIC_API_KEY` 추가, **`MOCK_SCORING` 삭제**, (싸게 가려면) `SCORE_MODEL` = `claude-haiku-5-5`
3. Redeploy
