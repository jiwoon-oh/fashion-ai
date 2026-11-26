# 옷빨 배틀 로그 설계

> 📌 2026-11-26 배포본 코드 기준. 기능이 바뀌면 이 문서의 이벤트 표도 같이 고친다.
>
> **이번에 바뀐 것 (11/26 최신화)**
> - 세션 기준 30분 → **15분**, 비로그인 제한 하루 6회 → **배틀 3판 (새 사진 6장)**
> - 돌수제비는 **자기 표(`dolsujebi_log`)를 따로 씀** → "한 표를 같이 쓴다"는 규칙을 지우고, 대신 두 웹 비교용 **이벤트 대응표**를 넣음 (7번)
> - 돌수제비식 링크도 받게 함: `?from=threads`, `?from=share_kakao`, `?test=1`
> - 빠져 있던 것 추가: 방문 횟수 · 지난 방문 뒤 며칠, 직전 사이트 도메인, 페북 · 라인 인앱 판별, 랭킹 등록 이벤트, 내 컴퓨터(localhost) 접속 자동 제외, **지표 뷰** (`select * from v_otbbal_daily;` 한 줄로 보기)
> - 각 표에 "쉬운 말" 설명 추가

---

## 0. 3분 요약 — 로그가 뭐고 왜 이렇게 심었나

**로그 = 손님이 가게에서 뭘 했는지 적는 일기장.**
"3시 2분, 손님 A가, 사진을 올렸다" 같은 줄이 한 줄씩 쌓인다. 나중에 이걸 모아 보고 "계산대 앞에서 사람들이 많이 나가네 → 계산대를 고치자"를 정한다.

> 💡 로그는 **무엇을 했나**만 본다. **왜 그랬나**는 로그로 알 수 없어서 설문으로 묻는다.

이 일기장으로 답하려는 질문은 5개다.

| 질문 | 쉬운 말 | 보는 기록 | 가설 |
| --- | --- | --- | --- |
| ① 들어오나? | 홍보 글 보고 사람이 오긴 하나, 어디서 오나 | `visit` (+ 어디서 왔는지 `source`) | H1 |
| ② 해보나? | 들어온 사람이 진짜 배틀 결과까지 보나 | `first_play`, `room_create` | H2 |
| ③ 어디서 빠지나? | 사진 올리기 · START · 결과 중 어느 계단에서 나가나 | `stage_enter` (1~6단계) | 2차 근거 |
| ④ 또 하나? | 한 판 하고 끝인가, 여러 판 하나 | `play`, `replay` | H3 |
| ⑤ 퍼뜨리나? | 친구한테 공유하고, 그 친구가 들어오나 | `share`, `room_open`, `via` 붙은 방문 | 참고 |

---

## 1. 배포본 기능 정리

| 단계 | 사용자가 하는 것 |
| --- | --- |
| ① 사진 올리기 | 1P / 2P 코디 사진 업로드 (찍기 · 앨범 · 사진 칸 탭 · 드래그 · 붙여넣기) |
| ② 배틀 시작 | START → AI가 색감 · 핏 · 조화 · 센스 각 25점, 100점 만점 채점 |
| ③ 결과 | 승자 발표 · 진 쪽 조롱 한줄평 · 이긴 쪽 칭찬 + 코디 별명 |
| ④ 공유 · 다시 | 결과 공유 · 한줄평 복사 · AGAIN · 새 판 |

**기획 문서에 없던 기능 (로그에 꼭 반영)**

| 기능 | 로그에서 중요한 이유 |
| --- | --- |
| 🔗 **도전장 보내기**: 1P만 올리고 링크 생성 → 친구가 자기 폰에서 2P로 붙음 (`/r/<코드>`, 24시간 유효) | 혼자 들어온 사람이 플레이할 수 있는 유일한 길. 바이럴 고리 그 자체 |
| **AGAIN**: 같은 사진으로 다시 → 점수는 그대로, 한줄평만 새로 | "다시 하기"를 반복 플레이로 볼지 따로 판단 필요 |
| **🗑 새 판**: 전체 초기화 | 상대를 바꿔서 하는 진짜 반복 |
| **결과 공유 시트**: 카카오톡 · 인스타그램(카드 미리보기 → 올리기 / 이미지 저장) · 스레드 · X · 페이스북 · 링크 복사 · 다른 앱 | 공유를 채널 단위로 볼 수 있음 |
| **비로그인 하루 배틀 3판 제한** (새로 채점하는 사진 6장 기준, AGAIN은 안 셈) → 넘으면 로그인 요구 | 이탈 지점이 될 수 있는 벽 |
| **주간 랭킹**: 로그인 + 닉네임 등록한 사람만 올라감 | 랭킹이 다시 오게 만드는지 |
| 친구 탭, 초대 코드(`?ref=`), 1P 사진 친구 공개 토글, 소리 토글, 계정 메뉴(로그아웃 · 탈퇴) | 유입 경로(friend) 판정, 부가 기능 사용 여부 |

> ⚠️ **핵심 리스크**: 스레드 · 인스타를 보고 혼자 들어온 사람은 2P 사진이 없다. 퍼널이 "사진 2장" 단계에서 크게 빠질 가능성이 높다. 그래서 배틀 이벤트마다 **모드**를 붙여서 구분한다.
>
> | 모드 | 쉬운 말 |
> | --- | --- |
> | `local` | 폰 하나로 1P · 2P 사진 둘 다 올리는 보통 배틀 |
> | `challenge_host` | 도전장을 만든 사람 (친구를 기다림) |
> | `challenge_guest` | 도전장 링크를 받고 2P로 붙은 사람 |
> | `challenge_viewer` | 이미 끝난 도전장을 구경만 한 사람 (플레이로 안 셈) |

---

## 2. 로그 규칙

- **한 줄 = 사건 하나.** 옷빨은 Supabase `events` 표에 쌓는다. (돌수제비는 자기 표 `dolsujebi_log`를 따로 씀 → 비교는 7번 대응표로)
- 같은 일을 두 줄로 남기지 않는다. 예: 배틀 결과는 `play` 한 줄에 점수 · 승패를 같이 넣는다. `battle_result`를 따로 만들지 않는다.
- 로그 보내기가 실패해도 게임에는 영향이 없다. 화면에는 아무것도 안 뜬다.

### 2-1. 한 줄에 적히는 칸 (컬럼)

| 컬럼 | 쉬운 말 | 값 | 왜 필요해? |
| --- | --- | --- | --- |
| `event_id` | 사건 번호 | 브라우저가 만든 UUID | 같은 사건이 두 번 와도 한 줄만 저장 |
| `event_time` | **언제** (서버 시계) | 서버 수신 시각 | 분석 기준. 폰 시계는 틀릴 수 있어서 |
| `client_time` | 언제 (폰 시계) | 브라우저 시각 | 순서 보정 · 대기 시간 계산 |
| `app` | 어느 웹 | `otbbal` | |
| `user_id` | **누가** (이름 말고 번호표) | 익명 UUID, 브라우저에 저장 | 같은 사람이 또 왔는지. 누군지는 모름 |
| `auth_uid` | 로그인한 계정 | 로그인 시 계정 id, 아니면 비움 | 로그인 전후 같은 사람 이어 붙이기 |
| `session_id` | **몇 번째 방문** | UUID | **15분 동안 아무것도 안 하면 새 방문**으로 셈 |
| `event_name` | **무슨 일** | 3 · 4번 표에 있는 이름만 | 서버가 목록에 없는 이름은 버림 |
| `stage` | 몇 단계까지 왔나 | 1~6 | 어디서 빠지는지 |
| `device` | 폰 / 컴퓨터 | `mobile` / `pc` | |
| `browser` | 어떤 앱 안에서 열었나 | `threads_inapp` / `insta_inapp` / `kakao_inapp` / `naver_inapp` / `facebook_inapp` / `line_inapp` / `chrome` / `safari` / `other` | 앱 안 브라우저는 사진 업로드가 자주 막혀서 필수 |
| `source` | **어디서 왔나** | `threads` / `insta` / `twitter` / `community` / `friend` / `challenge` / `share` / `direct` / `other` | 어느 홍보가 먹혔는지. 판정은 2-2 |
| `source_detail` | 어디서 왔나 (자세히) | 게시물 번호, 공유 채널 등 | 예: `post03`, `kakao` |
| `is_internal` | 우리 팀인가 | true / false | 팀 테스트가 섞이면 숫자가 부풀려져서 뺌 |
| `props` | 추가 메모 | JSON | 점수, 걸린 초 등 사건마다 다른 값 |

### 2-2. "어디서 왔나" 정하는 순서

위에서부터 먼저 맞는 것으로 정한다.

| 순서 | 주소 / 상황 | `source` | `source_detail` | 쉬운 말 |
| --- | --- | --- | --- | --- |
| 1 | `/r/<코드>` | `challenge` | | 도전장을 받고 들어옴 |
| 2 | `?via=kakao` (또는 `?from=share_kakao`) | `share` | `kakao` | 누가 공유한 결과 링크로 들어옴. **공유 버튼이 자동으로 붙임** |
| 3 | `?ref=<초대코드>` | `friend` | | 친구 초대 링크 |
| 4 | `?src=threads&c=post03` (또는 `?from=threads`) | `threads` | `post03` | **홍보 글마다 링크를 따로 만든다** |
| 5 | 링크 표시 없음 + 앱 안 브라우저 | 스레드 앱 → `threads` / 인스타 앱 → `insta` / 카톡 → `friend` / 페북 · 라인 → `other` | `inapp` 등 | 앱 종류로 짐작 |
| 6 | 직전 사이트(referrer) | threads.net → `threads`, instagram.com → `insta`, 그 외 → `other` | 도메인 | |
| 7 | 아무것도 없음 | `direct` | | 주소를 직접 쳤거나 알 수 없음 |

- **처음 들어온 경로(first-touch)** 는 사람 단위로 따로 저장한다 (`visit.props.ft_source`). H1은 이 값으로 본다.
- 주소의 `src` · `from` · `c` · `via` · `internal` · `test`는 읽은 뒤 주소창에서 지운다. 사람들이 주소를 복사해 퍼뜨려도 경로가 섞이지 않게.
- `?from=`은 돌수제비 링크 규칙과 맞추려고 받는다. 팀이 링크를 한 가지 방식으로 만들어도 두 웹 모두 읽힌다.

### 2-3. 일부러 안 남기는 것

- 옷 사진, 사진 지문(hash), IP, 닉네임, 한줄평 문장 원문은 **절대 안 남긴다.**
- 한줄평은 문장 대신 **스타일 번호(`roast_style`: s1~s25)** 만 남긴다. 어떤 스타일이 잘 먹히는지는 번호로 충분하다.
- 직전 사이트는 주소 전체가 아니라 **도메인만** 남긴다.
- 개인정보처리방침에 "이용 기록 6개월 보관, 탈퇴하면 계정 연결 끊음"을 넣었다.

### 2-4. 팀 트래픽 빼기

| 방법 | 쉬운 말 |
| --- | --- |
| `…/?internal=1` (또는 `?test=1`)로 한 번 접속 | 그 폰은 이후 계속 팀으로 표시 (`?internal=0`으로 해제) |
| 내 컴퓨터에서 띄운 개발 서버(localhost) | 자동으로 팀 표시 |
| 테스트 채점(`MOCK_SCORING`) 결과 | `props.mock=true` → 지표 뷰에서 자동 제외 |

### 2-5. 알고 있어야 할 한계

- **앱 안 브라우저와 크롬은 저장소가 따로**라서, 같은 사람이 스레드 앱 → 사파리로 오면 2명으로 잡힌다. → 재방문율은 실제보다 낮게 나옴 (참고만).
- **`exit`은 폰에서 자주 안 찍힌다.** 체류 시간은 `마지막 사건 시각 − 첫 사건 시각`으로 계산하고 `exit`은 보조로만 쓴다.
- **퍼널은 "그 단계에 한 번이라도 들어간 방문 수"로 센다.** 새 판을 누르면 1단계로 돌아가서, 마지막 단계 기준으로 세면 열심히 한 사람도 1단계에서 나간 것처럼 보인다.

---

## 3. 공통 이벤트 (모든 화면)

| event_name | 언제 | props | 쉬운 말 / 쓰는 곳 |
| --- | --- | --- | --- |
| `visit` | 새 방문 시작 (방문당 1번) | `is_return`(전에 온 적 있나), `visit_n`(이 브라우저 몇 번째 방문), `days_since_last`(지난 방문 뒤 며칠), `landing`(home / room / ranking / friends), `logged_in`, `ref_domain`(직전 사이트 도메인), `ft_source` · `ft_detail`(처음 들어온 경로) | **들어오나 · 어디서 오나 · 다시 오나** (H1, 재방문) |
| `stage_enter` | 각 단계에 **처음** 들어갈 때 (방문당 단계마다 1번) | `stage` | **어디서 빠지나** (퍼널) |
| `first_play` | 이번 방문에서 처음 결과를 봤을 때 | `sec_since_visit`(들어와서 몇 초 만에), `is_first_ever`(평생 처음인지), `mode` | **해보나** (H2) |
| `play` | 결과 1번 봄 | `nth`(이번 방문 몇 번째) + 4번 표의 배틀 값 | **또 하나** (H3) |
| `replay` | 다시 하기 계열 버튼 | `button`, `after_result` | 또 하나 — 어떤 식으로 (H3) |
| `share` | 공유 · 복사 버튼 | `channel`, `context` | **퍼뜨리나** |
| `exit` | 화면이 숨겨질 때 (여러 번 찍힐 수 있음 → 방문의 마지막 것만 사용) | `last_stage`(가장 멀리 간 단계), `dwell_sec`, `plays` | 참고용 |

---

## 4. 옷빨 배틀 이벤트

### 4-1. 단계 번호 (`stage`)

```
1단계  배틀 화면 도착
2단계  사진 1장 올림
3단계  사진 2장 다 올림 (또는 도전장 만듦)
4단계  START 누름
5단계  결과 봄
6단계  공유 또는 다시 하기
```

| stage | 의미 | 기록 시점 |
| --- | --- | --- |
| 1 | 배틀 화면 도착 | `visit` 직후 |
| 2 | 사진 1장 올림 | 첫 `photo_upload` 성공 |
| 3 | 사진 2장 다 올림 (또는 도전장 생성) | 두 번째 성공 / `room_create` 성공 |
| 4 | START 누름 | `battle_start` |
| 5 | 결과 봄 | `play` |
| 6 | 공유 또는 다시 하기 | `share`(결과 공유) / `replay` |

> 💡 도전장을 만든 사람은 3단계에서 친구를 기다리다가, 친구가 붙어야 5단계로 간다. 퍼널은 반드시 **모드별로** 나눠서 본다.

### 4-2. 이벤트 목록

| 단계 | event_name | 언제 | props | 쉬운 말 — 이걸로 아는 것 |
| --- | --- | --- | --- | --- |
| ① | `photo_upload` | 사진 처리가 끝났을 때 (성공 · 실패 모두) | `side`(p1 / p2), `method`(camera / album / slot_tap / drop / paste), `ok`, `fail`(not_image / decode), `replace`(이미 사진 있던 칸인지), `sec_since_visit`, `mode` | 사진 올리기가 **고장 났나**, 카메라 · 앨범 중 뭘 쓰나, 고르다 바꾸나 |
| ② | `battle_start` | START / AGAIN 클릭 | `mode`, `is_again`, `sec_since_ready`(사진 다 올리고 몇 초 뒤) | 사진 올리고 **시작까지 가나** |
| ② | `score_done` | 채점 응답 받았을 때 | `ok`, `wait_ms`(AI 기다린 시간), `error`(daily_limit / login_required / rate_limited / refused / upstream / network), `mock` | **기다리다 지치나, 오류 나나** |
| ③ | `play` | 점수 공개 연출이 끝났을 때 | `nth`, `mode`, `is_again`, `p1_total`, `p2_total`, `diff`(점수 차), `winner`, `tie`, `me_won`(게스트는 2P 기준), `scores`(4항목 × 2), `roast_style`, `mock` | 몇 판 하나, **아깝게 진 사람이 다시 하나** |
| ④ | `share_open` | 공유창 열림 | `context`(result = 결과 / challenge = 도전장 / invite = 친구 초대), `me_won`, `roast_style`, `mode` | 공유창까지 가나 |
| ④ | `share` | 공유창 채널 버튼 또는 📋 한줄평 복사 | `channel`(kakao / insta_preview / insta_send / insta_save / threads / x / facebook / copy_link / native / copy_roast), `context`, `roast_style`, `me_won` | **어느 앱으로 퍼뜨리나, 어떤 한줄평이 웃겨서 퍼지나, 이긴 쪽 · 진 쪽 누가 공유하나** |
| ④ | `replay` | 버튼 클릭 | `button`(again = 같은 사진 다시 / new_round = 🗑 새 판 / room_home = 도전장 화면에서 새 판), `after_result` | AGAIN 많음 = **한줄평 뽑기가 재밌다** / 새 판 많음 = **대결 자체가 재밌다** |
| 도전장 | `room_create` | 도전장 생성 응답 받았을 때 | `ok`, `wait_ms`, `error` | 혼자 온 사람이 도전장이라도 쓰나 |
| 도전장 | `room_open` | `/r/<코드>` 열었을 때 | `role`(host / guest / viewer), `status`(waiting / done / expired / not_found) | **받은 링크를 친구가 진짜 여나**, 만료로 못 하나 |
| 도전장 | `room_result` | 도전장 만든 사람 화면에 결과가 뜸 | `min_since_create`(만들고 몇 분 뒤) | 도전장이 실제 배틀로 이어지나, 얼마나 걸리나 |
| 벽 | `login_prompt` | "로그인해야 더 할 수 있음" 안내가 떴을 때 | `context`, `plays_today` | **3판 제한 벽에서 나가나** |
| 그 외 | `login` | 로그인 완료 | `provider`, `from`(prompt = 벽 보고 / topbar = 스스로) | 로그인을 하나, 벽 때문에 하나 |
| 그 외 | `ranking_view` | 랭킹 화면 열었을 때 | `tab`(weekly), `my_rank`, `failed` | 랭킹을 보긴 하나 |
| 그 외 | `ranking_register` | 랭킹 닉네임 등록 · 변경 결과 | `ok`, `first`(처음 등록인지), `error` | 랭킹에 이름 올리고 싶어 하나 (= 경쟁 동기) |
| 그 외 | `friends_view` | 친구 화면 열었을 때 | `friend_count` | 친구 기능을 쓰나 |
| 그 외 | `setting_change` | 소리 토글 | `key`, `value` | 참고 |

> 🧑‍🏫 **멘토 조언으로 검토**
> - "로그는 단순하게: 방문자 수, 사용 시간, 무엇을 했는지" → 3번 공통 이벤트 7개가 여기에 해당한다. 1차 판정은 이것만 본다.
> - 4번 옷빨 전용 이벤트는 1차에서 꼭 볼 건 아니지만, 나중에 다시 심기 어려우니 지금 같이 심어 둔다 (2차 "어디가 재밌나" 근거).

---

## 5. 지표 — 무엇을 어떻게 계산하나

| 지표 | 쉬운 말 | 계산 | 가설 | 주의 |
| --- | --- | --- | --- | --- |
| 방문 수 (채널별) | 몇 명 왔나, 어디서 | `visit` 수를 `ft_source`별로 | H1 | 게시물별(`source_detail`)로도 본다 |
| **첫 플레이 전환율** | 온 사람 중 몇 %가 해봤나 | (결과 봄 또는 도전장 만듦) 방문 ÷ 전체 방문 | H2 | 도전장 포함 이유는 6-3 |
| 첫 플레이까지 걸린 시간 | 들어와서 몇 초 만에 해봤나 | `first_play.sec_since_visit` 중앙값 | H2 | 평균 말고 중앙값 |
| **2판 이상 비율** | 해본 사람 중 몇 %가 또 했나 | `play` 2번 이상 방문 ÷ 첫 플레이 방문 | H3 | AGAIN과 새 판을 나눠서도 본다 |
| 다시 하기 비율 | 다시 하기 버튼을 누르나 | `replay` 방문 ÷ 첫 플레이 방문, 버튼별 | H3 | |
| 단계별 이탈 (퍼널) | 어느 계단에서 빠지나 | 1~6단계 도달 방문 수, **모드별** | 2차 근거 | |
| 공유율 | 해본 사람 중 몇 %가 공유했나 | `share` 방문 ÷ 플레이 방문, 채널별 | 참고 | `source=share` 방문과 짝지어 **공유 1번이 몇 명을 데려오나** |
| 오류 · 벽 | 고장 · 제한 때문에 나가나 | `score_done.ok=false` 비율, `login_prompt` 뒤 이탈 | 2차 근거 | **1차 배포 직후 제일 먼저 확인** |
| 앱 안 업로드 실패 | 인스타 앱에서 사진이 안 올라가나 | `photo_upload.ok=false`를 browser별로 | 2차 근거 | 여기서 막히면 홍보 효과가 통째로 날아감 |
| 재방문율 | 다시 오나 | `visit_n ≥ 2`인 사람 ÷ 전체 사람 | 2차 근거 | 앱 안 브라우저 중복 때문에 참고만 |
| 랭킹 동기 | 경쟁하고 싶어 하나 | `ranking_register` 성공 수, 랭킹 본 사람의 재방문 | 2차 근거 | |

> 🧑‍🏫 **멘토 조언으로 검토**
> - 판단 기준 숫자는 **배포 전에** 정해 둔다 (6번).
> - 1차 사용자는 수십 명 수준 → 비율 옆에 **분자 / 분모를 항상 같이** 적는다. 예: 42% (11/26)
> - 1차 우선순위: **전환율 → 퍼널 → 2판 이상 비율**.

### 5-1. 보는 방법 (Supabase → SQL Editor에서 한 줄 실행)

팀 트래픽 · 테스트 채점은 이미 빼고 보여 준다.

| 실행 | 보여 주는 것 |
| --- | --- |
| `select * from v_otbbal_daily;` | 날짜 · 처음 유입 경로별 방문 수, 재방문, H2-a / H2-b 전환율, H3(2판 이상) 비율, 공유 · 벽에 걸린 방문 |
| `select * from v_otbbal_funnel;` | 1~6단계 도달 방문 수 |
| `select * from v_otbbal_first_play;` | 첫 플레이까지 걸린 초 중앙값, 60초 안 비율 |
| `select * from v_otbbal_sessions order by started_at desc limit 50;` | 방문 한 줄 요약 (최근 50개) |
| `select * from events order by id desc limit 30;` | 방금 쌓인 날 것 그대로 (QA용) |

**모드별 퍼널**

```sql
select props->>'mode' as mode,
       count(distinct session_id) filter (where event_name = 'photo_upload' and (props->>'ok')::boolean) as uploaded,
       count(distinct session_id) filter (where event_name = 'battle_start') as started,
       count(distinct session_id) filter (where event_name = 'play') as played
from events
where app = 'otbbal' and not is_internal and props ? 'mode'
group by 1 order by 1;
```

**세션당 플레이 수 분포 (1판 / 2판 / 3판+)**

```sql
select case when plays >= 3 then '3+' else plays::text end as plays, count(*)
from v_otbbal_sessions where played group by 1 order by 1;
```

**공유 1번이 데려온 방문**

```sql
select
  (select count(*) from events where app='otbbal' and not is_internal and event_name='share') as shares,
  (select count(*) from events where app='otbbal' and not is_internal and event_name='visit' and source in ('share','challenge')) as visits_from_share;
```

**AGAIN vs 새 판**

```sql
select props->>'button' as button, count(*), count(distinct session_id) as sessions
from events where app='otbbal' and not is_internal and event_name='replay'
group by 1;
```

---

## 6. 팀 합의 사항

| 항목 | 결정 | 상태 |
| --- | --- | --- |
| 도전장 만들기를 첫 플레이로 칠지 (6-3) | **친다** — H2는 "결과 봄 또는 도전장 만듦" 기준(H2-b) | ✅ 확정 (11/26) |
| AGAIN을 "또 했다"로 칠지 (6-4) | **판정은 합계로, 보고는 나눠서** | ✅ 확정 (11/26) |
| 두 웹 비교 지표 (6-5) | **H2(전환율) → H3(2판 이상 비율) 순. 방문 수는 비교에서 뺀다** | ✅ 확정 (11/26) |
| 홍보 링크 (6-6) | **게시물마다 번호를 붙인 링크를 쓰고, 표로 관리한다** | ✅ 확정 (11/26) |
| 1차 수집 기간 (6-1) | 추천: 배포 후 3일 | ⏳ 팀 확정 필요 |
| 판정 기준 숫자 (6-2) | 추천: 아래 표 | ⏳ 팀 확정 필요 |


> 💡 판정은 숫자 하나로 자르지 않고 **있음 / 애매 / 없음** 3구간으로 본다. 1차 사용자가 수십 명이라 기준선 근처 1~2명 차이로 결론이 뒤집히는 걸 막기 위해서다. 분모(방문 수)가 **20 미만이면 판정 보류**.

### 6-1. 1차 수집 기간 ⏳ 팀 확정 필요

- **추천: 배포 후 3일 (11/26 ~ 11/29, 11/30 판정)**
- 이유: 최종 버전을 12/17 전후에 열어야 해서 1차 · 2차를 빨리 돌려야 한다. 홍보 글 반응은 보통 올린 뒤 1~2일 안에 끝난다.

### 6-2. 판정 기준 숫자 (옷빨 기준) ⏳ 팀 확정 필요

| 가설 | 지표 | ✅ 있음 | 🤔 애매 | ❌ 없음 | 추천 이유 |
| --- | --- | --- | --- | --- | --- |
| H1 유입 | 3일간 방문 (팀 제외) | 50 이상 | 20~49 | 20 미만 | 홍보 글 4~5개 × 글당 10명이면 "들어온다"고 볼 수 있음 |
| H2 첫 플레이 | 전환율 (도전장 포함) | 30% 이상 | 15~29% | 15% 미만 | 사진 2장이 필요해서 진입 장벽이 높다. 일반 웹 게임보다 낮게 잡는다 |
| H3 반복 | 첫 플레이 방문 중 **2판 이상** 비율 | 40% 이상 | 20~39% | 20% 미만 | 평균은 몇 명이 많이 하면 튀어서 비율로 본다 |

- 돌수제비는 진입이 훨씬 쉬워서(돌 던지기 한 번) H2 기준이 더 높다 (돌수제비 문서 제안: 시작하기 → 첫 던지기 60%).
- 비로그인은 하루 새 배틀 3판까지라 H3의 "2판 이상"은 제한에 안 걸린다.

### 6-3. 도전장 만들기를 "첫 플레이"로 칠지 ✅ 확정

- **결정: 친다.**
- 이유: 혼자 온 사람은 2P 사진이 없어서 할 수 있는 최대 행동이 도전장 만들기다. 빼면 H2가 실제보다 나쁘게 나와서 "존재 이유 없음"으로 잘못 판단할 수 있다.
- 숫자는 둘 다 남긴다 (`v_otbbal_daily`에 둘 다 나옴).
  - H2-a: 결과를 본 방문 ÷ 방문 (엄격)
  - **H2-b: 결과를 봤거나 도전장을 만든 방문 ÷ 방문 (판정 기준)**

### 6-4. AGAIN을 "또 했다"로 칠지 ✅ 확정

- **결정: 판정은 합계(AGAIN 포함)로, 보고는 나눠서.**
- 이유: AGAIN은 점수가 같고 한줄평만 바뀐다. 그래도 다시 누른다는 건 "한줄평 뽑기가 재밌다"는 신호다. 다만 AGAIN만 많고 새 판이 적으면 2차에서 고칠 방향이 달라진다 (한줄평 강화 vs 대결 상대 찾기 쉽게).

### 6-5. 두 웹 비교에서 가장 크게 볼 지표 ✅ 확정

- **결정: H2(전환율) → H3(2판 이상 비율) 순. 방문 수는 비교에서 뺀다.**
- 이유: 방문 수는 웹보다 홍보 글이 얼마나 터졌는지에 달려 있다. 웹의 힘은 "들어온 사람이 해보는가, 또 하는가"가 더 정확하게 보여 준다.
- 결정 규칙:
  - 둘 다 H2 · H3가 ✅ 또는 🤔 → 둘 다 2차 진행
  - 한쪽만 ✅ → 그 웹에 집중
  - 둘 다 ❌ → 홍보 · 첫 화면부터 다시

### 6-6. 홍보 게시물별 링크 목록 ✅ 확정

- **결정: 게시물마다 번호를 붙인 링크를 쓰고, 아래 표로 관리한다.** 돌수제비와 같은 `?from=` 방식을 써도 된다.

| 번호 | 웹 | 채널 | 올린 사람 | 올린 일시 | 글 유형 | 링크 |
| --- | --- | --- | --- | --- | --- | --- |
| post01 | otbbal | threads | (이름) | 11/27 20:00 | 털린 결과 캡처 | `…/?from=threads&c=post01` |
| post02 | otbbal | insta | (이름) | 11/27 21:00 | 릴스 (찍기 → 점수 공개) | `…/?from=insta&c=post02` |
| post03 | otbbal | community | (이름) | … | 셀프디스 개발기 | `…/?from=community&c=post03` |

- 글 유형까지 적어 두면 "어떤 글이 먹혔는지"를 다음 홍보에 바로 쓸 수 있다.

---

## 7. 돌수제비와 비교

### 7-1. 이벤트 대응표 (H4 두 웹 비교용)

두 웹은 표가 따로라 이름이 조금 다르다. 비교할 때는 아래처럼 짝지어 센다.

| 보는 것 | 옷빨 (`events`) | 돌수제비 (`dolsujebi_log`) | 비교할 때 주의 |
| --- | --- | --- | --- |
| 방문 | `visit` | `visit` | 옷빨은 15분 쉬면 새 방문, 돌수제비는 접속(페이지 열기)마다 새 방문 → **사람(`user_id`) 기준 숫자도 같이** 본다 |
| 시작 | (따로 없음, 1단계 = 도착) | `start` (시작하기) | 옷빨은 안내 화면이 없어서 방문 = 시작 |
| 첫 플레이 | `first_play` (+ `room_create`) | 첫 `throw` | 돌수제비 전환율 분모는 `start`, 옷빨은 `visit` → **둘 다 "÷ 방문"으로도 계산해서 나란히** |
| 플레이 1회 | `play` (결과 1번) | `throw` (또는 `result`) | |
| 다시 하기 | `replay` | `replay` | 버튼 이름은 웹마다 다름 |
| 공유 | `share` (+ `via` 붙은 방문) | `share` (+ `share_*` 유입) | 옷빨 `source=share` + `source_detail=kakao` = 돌수제비 `source=share_kakao` |
| 단계 | `stage_enter` 1~6 | `stage_enter` ①~⑥ (+ `load`, `start`) | 단계 수 · 의미가 달라 퍼널은 웹별로만 본다 |
| 나감 | `exit` | `exit` | 둘 다 참고용 |
| 팀 · 테스트 | `is_internal` | `is_test` | 둘 다 빼고 계산 |

### 7-2. 돌수제비에 있고 옷빨에서 빠졌던 것 → 점검 결과

| 돌수제비에 있는 것 | 옷빨 | 조치 |
| --- | --- | --- |
| `?from=` 홍보 링크, `share_` 접두어 공유 링크 | `?src=` · `?via=`만 받았음 | ✅ **추가**: `?from=` · `?from=share_*`도 받음 |
| `?test=1` · localhost 자동 테스트 표시 | `?internal=1`만 | ✅ **추가**: `?test=1`, localhost 자동 제외 |
| 방문 몇 번째 · 지난 방문 뒤 며칠 | 재방문 여부만 | ✅ **추가**: `visit_n`, `days_since_last` |
| 직전 사이트 도메인 | 다른 사이트일 때만 `source_detail`에 | ✅ **추가**: `visit.ref_domain` |
| 앱 안 브라우저: 페이스북 · 라인 | 없음 | ✅ **추가**: `facebook_inapp`, `line_inapp` |
| 랭킹 등록 | 랭킹 보기만 | ✅ **추가**: `ranking_register` |
| 지표 뷰 (`v_daily`, `v_funnel` …) | 예시 SQL만 | ✅ **추가**: `v_otbbal_daily` · `_funnel` · `_first_play` · `_sessions` |
| `load` (3D 로딩) | 해당 없음 (로딩이 가벼움) | — |
| `start` (안내 화면 → 시작하기) | 해당 없음 (안내 화면 없음) | — |
| `stone_pick` · `stone_drop` (고르다 바꿈) | `photo_upload.replace`로 이미 있음 | — |
| `draw` · `pose_set` (부가 기능 사용률) | 해당 기능 없음. 대신 `setting_change` | — |
| 설문과 `user_id` 연결 | 없음 | ⏳ 옷빨 설문을 붙일 때 같이 (8-3) |
| 모든 이벤트에 그때의 단계 번호 | 단계 관련 이벤트에만 | 그대로 둠 — 퍼널은 `stage_enter`로 충분 |

### 7-3. 옷빨에만 있는 것 (돌수제비엔 없음)

- **도전장 흐름** (`room_create` → `room_open` → `room_result`): 친구를 끌고 오는 고리라 바이럴 측정에 핵심
- **로그인 벽** (`login_prompt` → `login`): 제한이 이탈 원인인지
- **AI 채점 대기 · 오류** (`score_done`): AI 응답이 늦으면 나가는지
- **한줄평 스타일** (`roast_style`): 어떤 웃음이 공유를 만드는지 → 2차 "어디가 재밌나"의 근거

---

## 8. 구현

### 8-1. 흐름

**브라우저 → `POST /api/log` (모아서 전송) → 서버가 `events` 표에 저장**

- 브라우저는 사건을 모아 **2초마다** 보내고, 화면이 숨겨질 때는 `sendBeacon`으로 남은 걸 보낸다.
- 서버가 하는 일: 이벤트 이름 목록 검사, props 크기 제한(약 2KB), 서버 시각 기록, 로그인 상태면 `auth_uid` 채우기
- 브라우저에서 표에 직접 쓰지 않는다 (아무나 가짜 로그를 넣을 수 있음). 표는 브라우저 키로는 읽지도 쓰지도 못한다.

### 8-2. 코드 위치

| 파일 | 하는 일 |
| --- | --- |
| `lib/track.ts` | 브라우저 로그 모듈: user_id · 15분 세션 · 유입 경로 판정 · 방문 횟수 · 큐 전송 · exit |
| `lib/track-events.ts` | 이벤트 이름 목록 (브라우저 · 서버 공통). 새 이벤트는 여기와 이 문서를 같이 고친다 |
| `app/api/log/route.ts` | 로그 받아서 `events`에 저장. DB 연결 전 개발 환경에서는 서버 콘솔에 `[log]`로 출력 |
| `components/Tracker.tsx` | 모든 화면 공통: visit · login · exit |
| `lib/battle-client.ts` | 배틀 · 도전장 이벤트 (photo_upload ~ play, room_*, replay, copy_roast, setting_change) |
| `components/ShareSheet.tsx` | share_open · share (채널별 링크에 `via=` 자동 부착) |
| `components/TopBar.tsx` | 로그인 버튼 → 돌아왔을 때 login 이벤트 |
| `components/RankingBoard.tsx` · `FriendsBoard.tsx` | ranking_view · ranking_register · friends_view |
| `lib/scoring.ts` · `battle-core.ts` | 한줄평 스타일 번호(s1~s25 / bank / mock)를 결과에 실어 보냄 |
| `supabase/schema.sql` 6번 | `events` 표 + 지표 뷰 4개 |

**구체화된 값**

- `replay.after_result`: 결과를 보기 전에 새 판을 누른 경우 false
- `photo_upload.method`: 📸 찍기 = camera, 🖼 앨범 = album, 사진 칸 탭 = slot_tap
- 이미 끝난 도전장을 연 사람(`challenge_viewer`)이 보는 지난 결과는 `play`로 세지 않음
- 비로그인 제한은 **새로 채점한 사진** 수로 센다. 이미 채점한 사진 · AGAIN은 안 셈

**보관 기간 (6개월) 정리 — 한 달에 한 번 실행**

```sql
delete from public.events where event_time < now() - interval '6 months';
```

### 8-3. 설문과 연결 (나중에)

- 설문 링크에 익명 `user_id`를 붙여서 열면 설문 응답과 로그를 사람 단위로 이을 수 있다. 예: `설문주소?uid=<user_id>`
- 로그 = **무엇을 했나** / 설문 = **왜 그랬나, 누구인가(나이대 · 성별)**
- 1차는 돌수제비만 설문을 붙인다. 옷빨에 붙일 때 결과 화면 버튼 + `survey_open` 이벤트를 같이 추가한다.

### 8-4. 2차 이후 추가 후보 (지금은 안 심음)

전체 계획서의 최종 질문 "수익화가 가능한가"에 답하려면, 2차 이후에 아래를 고려한다.

- 유료 기능 · 스킨 버튼 노출 대비 클릭률 (예: "AI 정밀 분석", "한줄평 더 뽑기")
- 광고 자리 노출 뒤 이탈률
- 설문의 "돈 내고 쓸 의향"

---

## 9. 배포 전 할 일 · QA

### 9-1. 배포 전 할 일

- [ ] Supabase SQL Editor에서 `supabase/schema.sql`의 **6) 행동 로그** 부분 실행 (표 + 지표 뷰) ← **실행 전까지는 기록되지 않음**
- [ ] 팀원 폰마다 `…/?internal=1`로 한 번 접속
- [ ] 홍보 게시물 링크를 6-6 표로 만들기
- [ ] 수집 기간(6-1) · 판단 기준 숫자(6-2) 팀 확정

### 9-2. QA 체크리스트

- [x] 개발 서버에서 처음부터 결과 · 공유 · 도전장까지 진행 → 사건이 순서대로 찍힘 (콘솔 `[log]`)
- [ ] SQL 실행 후 실제 폰에서 `?internal=1`로 한 번 해 보고 `select * from events order by id desc limit 30;` 확인
- [ ] 폰 크롬 / 사파리 / 스레드 앱 / 인스타 앱 / 카톡 앱에서 `browser` · `source`가 맞게 찍힘
- [ ] `?from=threads&c=post01` 링크로 들어가면 `source=threads`, `source_detail=post01`
- [ ] 도전장 흐름: 만든 사람 `room_create` → 친구 `room_open`(source=challenge) → 친구 `play` → 만든 사람 `room_result`
- [ ] AGAIN · 새 판이 `replay.button`으로 구분됨
- [ ] 인스타 공유에서 미리보기 → 올리기 / 이미지 저장이 각각 찍힘
- [ ] 비로그인으로 새 사진 배틀 4판째(새 사진 7장째)에서 `login_prompt`가 찍힘
- [ ] 15분 넘게 가만히 있다가 다시 누르면 새 `session_id` + `visit`
- [ ] 랭킹 닉네임 등록하면 `ranking_register` 찍힘
- [ ] 같은 사건을 두 번 보내도 한 줄만 저장됨
- [ ] `?internal=1`로 들어간 폰은 이후 계속 `is_internal=true`
- [ ] 로그에 사진 · 사진 지문 · IP · 닉네임 · 한줄평 원문이 없음

### 9-3. 1차 배포 후 볼 것

- [ ] `v_otbbal_daily`: 방문 · 전환율(H2-b) · 2판 이상 비율(H3)
- [ ] `v_otbbal_funnel` + 모드별 퍼널: 어디서 빠지나 (특히 2 → 3단계)
- [ ] `score_done` 오류 · `photo_upload` 실패 (인스타 앱)
- [ ] 6-2 기준과 비교해서 가설 채택 / 기각 → 돌수제비와 나란히 (7-1)
