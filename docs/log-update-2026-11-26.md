# 옷빨 배틀 로그 추가분 (11/26 2차)

> 📌 기존 로그 설계 문서에 **새로 추가된 부분만** 정리. 기능 2개(접전 보정, 점수 올리는 법 창)가 생기면서 로그도 같이 늘었다.

---

## 1. 새 기능 요약

| 기능 | 쉬운 말 | 왜 넣었나 |
| --- | --- | --- |
| **접전 보정** | AI가 코디 무드(미니멀 · 캐주얼 · 스트릿 · 포멀 · 스포티 · 빈티지 · 러블리 · 기타)도 같이 고른다. 두 코디 무드가 같은데 점수 차가 5점보다 크면, 승패는 그대로 두고 **3~5점 차로 좁혀서** 보여 준다 | 비슷한 코디끼리 50 vs 75처럼 크게 벌어지면 진 쪽이 납득을 못 하고 나간다. **아깝게 져야 다시 하고 싶어진다** |
| **📏 점수 올리는 법 창** | 결과가 뜨면 바로 열림. 진 쪽 기준으로 항목마다 "지금 11점 → 15점 받으려면: ~" 을 보여 주고, 전체 채점 기준표도 펼칠 수 있다. x로 닫으면 📏 버튼으로 다시 열기 | AGAIN · 새 판 전에 "뭘 바꾸면 이기나"를 알려 줘서 **다시 하기**로 이어지게 |

> 💡 같은 두 사진은 언제 붙여도 같은 결과가 나온다. 사진마다 저장된 원래 점수는 그대로 두고, 그 판에 보여 주는 점수만 좁힌다.

---

## 2. 새 이벤트: `score_guide` (점수 올리는 법 창)

| event_name | 언제 | props | 쉬운 말 — 이걸로 아는 것 |
| --- | --- | --- | --- |
| `score_guide` | 결과가 떠서 창이 자동으로 열릴 때 / x 닫기 / 📏 버튼으로 다시 열기 / "전체 채점 기준표 보기" 펼치기 | `action`(show / close / reopen / expand), `side`(누구 기준 p1 / p2), `lost`(진 쪽인지), `total`, `weakest`(제일 낮은 항목: color / fit / harmony / trend), `sec_open`(닫기 전 몇 초 봤나, close에만), `mode` | 기준표를 **읽나, 바로 닫나**. 읽은 사람이 AGAIN · 새 판으로 이어지나. 어떤 항목이 제일 자주 약한가 |

**action 값 뜻**

| action | 뜻 |
| --- | --- |
| `show` | 결과가 떠서 자동으로 열림 (결과마다 1번) |
| `close` | 사용자가 x로 닫음. `sec_open`에 몇 초 열어 뒀는지 |
| `reopen` | 닫았다가 📏 버튼으로 다시 엶 → **관심 있다는 강한 신호** |
| `expand` | "전체 채점 기준표 보기"를 펼침 → 기준까지 꼼꼼히 봄 |

---

## 3. 기존 이벤트에 추가된 값: `play`

| 추가된 props | 값 | 쉬운 말 |
| --- | --- | --- |
| `same_mood` | true / false | 두 코디 무드가 같았나 |
| `narrowed` | true / false | 점수 차를 좁혔나 (접전 보정이 들어갔나) |
| `raw_diff` | 숫자 또는 비움 | 좁히기 전 원래 점수 차 |

---

## 4. 새로 볼 수 있는 지표

| 지표 | 쉬운 말 | 계산 | 쓰는 곳 |
| --- | --- | --- | --- |
| 기준표 읽는 시간 | 창을 열고 몇 초 보다 닫나 | `score_guide` `action=close`의 `sec_open` 중앙값 | 2차 근거 |
| 기준표 관심도 | 다시 열거나 펼쳐 보나 | `reopen` · `expand`가 있는 방문 ÷ `show`가 있는 방문 | 2차 근거 |
| **기준표 효과** | 기준표를 읽은 사람이 또 하나 | 기준표를 5초 이상 본 방문 vs 바로 닫은 방문의 **2판 이상 비율** 비교 | H3 보조 |
| **접전 효과** | 아깝게 진 판 뒤에 다시 하나 | `play.narrowed=true` 판 뒤 `replay` 비율 vs `narrowed=false` 판 | H3 보조 |
| 약한 항목 순위 | 사람들이 제일 많이 깎이는 항목 | `score_guide` `action=show`의 `weakest` 개수 | 2차 (기능 · 콘텐츠 아이디어) |

**SQL 예시: 기준표 action별 수**

```sql
select props->>'action' as action, count(*), count(distinct session_id) as sessions
from events
where app = 'otbbal' and not is_internal and event_name = 'score_guide'
group by 1 order by 2 desc;
```

**SQL 예시: 접전 보정 판 vs 아닌 판의 다시 하기**

```sql
with p as (
  select session_id, bool_or((props->>'narrowed')::boolean) as narrowed
  from events
  where app = 'otbbal' and not is_internal and event_name = 'play'
  group by session_id
), r as (
  select distinct session_id from events
  where app = 'otbbal' and not is_internal and event_name = 'replay'
)
select p.narrowed,
       count(*) as sessions,
       count(r.session_id) as replayed,
       round(100.0 * count(r.session_id) / count(*), 1) as pct
from p left join r using (session_id)
group by 1;
```

---

## 5. DB 변경

- `photo_scores` 표에 `mood` 칸 추가 (✅ 11/26 실행 완료)

```sql
alter table public.photo_scores add column if not exists mood text;
```

- 이 칸이 생기기 전에 채점된 사진은 무드가 비어 있어서 **접전 보정이 안 들어간다.** 새로 올린 사진부터 적용된다.

---

## 6. QA

- [x] 결과가 뜨면 점수 올리는 법 창이 열리고 `score_guide show`가 찍힘
- [x] x로 닫으면 `close`(sec_open 포함) → 📏 버튼 `reopen` → 기준표 펼치기 `expand` (개발 서버 확인)
- [x] 같은 무드 두 장: 원래 9점 차 → 5점 차로 좁혀지고 `play.narrowed=true`, `raw_diff=9` (가짜 점수 모드 확인)
- [ ] 실제 AI 채점에서 비슷한 코디 두 장이 같은 무드로 나오는지 확인
- [ ] 대결방(도전장)에서도 접전 보정 · 기준표가 같이 동작하는지 확인

---

## 7. 11/27 추가: 퍼진 경로 (A → B → C)

> 💡 전에는 공유 링크에 채널(`via=kakao`)만 붙어서 "카톡 공유로 왔다"까지만 알았다. 이제 **누가 보낸 링크인지, 몇 단계째 퍼졌는지**도 남는다.

### 7-1. 링크에 붙는 것

| 표시 | 뜻 | 예 |
| --- | --- | --- |
| `s` | 보낸 사람 번호표 앞 8자리 (익명, 누군지는 모름) | `s=8ce0b94f` |
| `g` | 이 링크의 전파 단계 | `g=1` |

- 결과 공유 · 도전장 · 친구 초대 링크 모두 자동으로 붙는다. 들어온 뒤에는 주소창에서 지운다.
- 단계: 홍보 글 · 직접 온 사람 = **0단계** → 그 사람이 보낸 링크로 온 사람 = **1단계** → 그 사람이 또 보내면 **2단계**
- 내 단계는 **처음 들어온 방문 기준으로 고정**된다.

### 7-2. 예시: A가 B에게, B가 C에게

| 누가 | 링크 | `visit`에 찍히는 값 |
| --- | --- | --- |
| A (스레드 홍보 글) | `…/?src=threads&c=post01` | `source=threads`, `my_gen=0` |
| B (A가 보냄) | `…/?via=threads&s=<A>&g=1` | `source=share`, `from_user=<A>`, `gen=1`, `my_gen=1` |
| C (B가 보냄) | `…/?via=threads&s=<B>&g=2` | `source=share`, `from_user=<B>`, `gen=2`, `my_gen=2` |

### 7-3. 추가된 값

| 이벤트 | 추가된 props | 쉬운 말 |
| --- | --- | --- |
| `visit` | `from_user`, `gen`, `my_gen`, `self_open` | 누가 보낸 링크로 왔나, 몇 단계째인가, 자기 링크를 자기가 열었나 |
| `share` | `gen_out` | 내가 보낸 링크가 몇 단계짜리인가 |
| `room_create` · `room_open` · `room_result` | `room` (방 코드) | 같은 도전장을 만든 사람 · 연 친구 · 결과를 이어 붙임 |

### 7-4. 새로 볼 수 있는 지표

| 지표 | 쉬운 말 | 계산 |
| --- | --- | --- |
| 한 사람이 데려온 수 | 공유한 사람 1명이 몇 명을 데려왔나 | `visit.from_user`별 방문한 사람 수 → 0명 / 1명 / 2명+ 분포 |
| 전파 단계 | 몇 단계까지 퍼졌나 | `visit.my_gen`별 사람 수. **2단계 이상이 있으면 "저절로 퍼진다"** |
| 도전장 성사율 | 만든 도전장을 친구가 열고 결과까지 갔나 | 방 코드로 `room_create` → 게스트 `room_open` → `room_result` 이어 붙이기 |

(SQL은 로그 설계 문서 7-3)

### 7-5. QA

- [x] A → B → C 공유: B는 `from_user=A앞8자리, gen=1`, C는 `from_user=B앞8자리, gen=2` (개발 서버 확인)
- [x] 링크로 들어온 뒤 주소창에서 `s` · `g`가 지워짐
- [x] `room_create` · `room_open`에 같은 방 코드
- [ ] 실제 폰 카톡 공유 링크로 확인
