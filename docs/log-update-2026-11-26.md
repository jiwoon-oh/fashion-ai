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
