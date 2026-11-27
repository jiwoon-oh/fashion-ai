# 옷빨 배틀 1차 설문

> 2026-11-27 팀 확정안 기준. 돌수제비 설문과 **이벤트 이름 · 저장 값 형식을 맞춘 것**이라 바꾸지 않는다.
> 코드: `components/SurveyCard.tsx` (카드) · `lib/survey-config.ts` (숫자 · 문항 · 저장 값) · `lib/battle-client.ts` (결과 · 📏 창 신호) · `lib/track-events.ts` (이벤트 이름)

## 0. 왜 하나

- 1차 질문은 **"누가 들어오고, 왜 해보는가"**. 로그로는 무엇을 했는지만 알 수 있어서 나이대 · 성별 · 해본 이유 · 재방문 의향은 설문으로 묻는다.
- 원칙: 배틀 흐름을 막지 않는다 · 4문항 30초 · 응답은 기존 로그(`events`)에 익명 `user_id`로 · 보상 없음

## 1. 언제 뜨나

| 규칙 | 내용 |
|---|---|
| 기준 | 결과를 본 **누적** 횟수 (여러 번 접속한 것 합침, AGAIN도 셈) |
| 안 세는 것 | 끝난 도전장 구경만(`challenge_viewer`), 가짜 채점(`mock`) |
| 처음 | 누적 **2번째** 결과. 도전장 게스트(`challenge_guest`)는 **첫** 결과 |
| 다시 | 답 안 하고 닫으면 **2번마다** (4번째, 6번째 …) |
| 최대 | **3번** |
| 끝 | 한 번이라도 제출하면 다시 안 뜸 |

**띄우는 시점**: 결과가 뜨면 📏 점수 올리는 법 창이 먼저 열린다. 그 창을 **x로 닫고 1.5초 뒤** 화면 아래에서 바텀시트로 올라온다.
- 📏 창을 안 닫고 AGAIN · 새 판 · 공유로 넘어가면 **이번에는 안 띄우고** 다음 결과에서 다시 판단한다 (노출로 안 셈).
- 공유 시트 · 로그인 창이 떠 있으면 안 띄운다.

**숫자 바꾸기** (`lib/survey-config.ts`)

```ts
export const SURVEY_EVERY_N_RESULTS = 2;   // 몇 번째 결과마다 띄울지 (보통)
export const SURVEY_GUEST_FIRST = true;    // 도전장 게스트는 첫 결과에서 띄울지
export const SURVEY_MAX_SHOWS = 3;         // 최대 몇 번까지 띄울지
export const SURVEY_DELAY_MS = 1500;       // 점수 올리는 법 창을 닫고 몇 ms 뒤에 띄울지
export const SURVEY_ID = 'otbbal_s1_v1';   // 설문 버전 (문항이 바뀌면 올린다)
```

**브라우저 저장** (`localStorage`, 못 쓰면 설문 안 띄움)

| 키 | 값 |
|---|---|
| `otbbal_result_count` | 누적 결과 횟수 |
| `otbbal_survey_shows` | `{"n": 몇 번 떴나, "at": 마지막으로 뜬 때의 누적 결과 횟수}` |
| `otbbal_survey_done` | 제출했으면 `"1"` |
| `otbbal_survey_order` | Q3 보기 순서 |

## 2. 카드 모양

- 지금 옷빨 UI(윈98 창 · 버튼 · 글씨체) 그대로. 화면 아래에서 올라오는 시트, 뒤 화면은 어둡게 막힘
- 한 화면에 한 문항, 위쪽 진행 점 ● ○ ○ ○
- 첫 화면 안내: "4개만 물어볼게요 (30초)" / "둘이 같이 했다면 폰 주인 기준으로 답해 주세요"
- Q1 · Q2 · Q4는 보기를 탭하면 바로 다음, Q3은 1~2개 고르고 "다음 ▶"
- 마지막 문항을 고르면 자동 제출 → "고마워요! 한 판 더? 👕" 2초
- 오른쪽 위 **"나중에"**, 바깥 탭, Esc로 언제든 닫힘 → 결과 화면 그대로

## 3. 문항

**Q1. 나이대가 어떻게 되세요?** (단일) → `age`

| 보기 | 값 |
|---|---|
| 10대 | `10s` |
| 20대 초반 | `20s_early` |
| 20대 후반 | `20s_late` |
| 30대 | `30s` |
| 40대 이상 | `40s_plus` |

**Q2. 성별을 알려주세요** (단일) → `gender`: 여성 `female` / 남성 `male` / 응답하지 않음 `no_answer`

**Q3. 옷빨 배틀을 해본 이유는?** (최대 2개) → `reasons` (배열), 기타 글 → `reasons_other` (30자)

| 보기 | 값 |
|---|---|
| 내 옷이 몇 점인지 궁금해서 | `my_score` |
| 친구랑 누가 옷 잘 입는지 겨루려고 | `friend_compete` |
| 한줄평(놀리기)이 웃겨 보여서 | `roast_fun` |
| 오늘 뭐 입을지 두 벌 중에 고르려고 | `outfit_pick` |
| 코디 실력을 확인하고 싶어서 | `style_check` |
| 홍보 글·영상이 재밌어 보여서 | `promo` |
| 랭킹에 오르고 싶어서 | `ranking` |
| 심심해서 | `bored` |
| 기타 (직접 입력) | `other` |

- 8개 보기는 사람마다 섞고 처음 순서를 저장해 다시 띄울 때도 같은 순서. "기타"는 항상 맨 아래
- "기타"를 고르면 입력칸(30자)이 열리고, 비워 두면 "다음"이 안 켜짐
- 3개째를 누르면 "2개까지 고를 수 있어요"

**Q4. 다음에 또 할 것 같나요?** (단일) → `revisit`: 오늘 또 `today` / 며칠 안에 `few_days` / 생각나면 `maybe` / 다시 안 할 듯 `never`

"어떻게 알고 왔는지"는 묻지 않는다 → 로그의 `source`, `visit.props.ft_source`

## 4. 로그 (기존 `events` 표, 새 표 · API 없음)

| event_name | 언제 | props |
|---|---|---|
| `survey_view` | 카드가 떴을 때 | `survey_id`, `show_index`(몇 번째 노출), `result_count`(누적 결과 횟수), `mode` |
| `survey_close` | 제출 안 하고 닫음 | `survey_id`, `show_index`, `last_question`(1~4), `answered_so_far`(그때까지 고른 값) |
| `survey_submit` | 4문항 다 답함 | 아래 예시 |

```json
{
  "survey_id": "otbbal_s1_v1", "show_index": 1, "result_count": 2, "mode": "local",
  "age": "20s_late", "gender": "female", "reasons": ["my_score", "roast_fun"], "reasons_other": null,
  "revisit": "few_days",
  "option_order": ["promo", "bored", "roast_fun", "my_score", "ranking", "style_check", "friend_compete", "outfit_pick"],
  "seconds_to_submit": 14
}
```

- `stage`는 셋 다 5. 저장이 실패해도 게임은 그대로 (조용히 넘어감)
- 이름 · 연락처 · 사진은 받지 않는다. 개인정보처리방침에 설문 응답 항목 추가함

## 5. 팀 테스트 (QA)

- 팀 표시(`?internal=1` · `?test=1` · localhost) 폰은 **첫 결과부터** 뜨고, 그 뒤는 같은 규칙(2번마다 · 최대 3번)
- 팀 표시 상태에서는 누적 횟수 · 제출 여부를 브라우저에 저장하지 않는다 (페이지를 새로 열면 처음부터). 가짜 채점 결과도 셈

## 6. 결과 보는 SQL

```sql
-- 최근 설문 로그
select * from events where event_name like 'survey%' order by id desc limit 10;

-- 응답률: 설문을 본 사람 중 제출한 사람
select count(distinct user_id) filter (where event_name = 'survey_view')   as shown,
       count(distinct user_id) filter (where event_name = 'survey_submit') as answered
from events where app = 'otbbal' and not is_internal;

-- 어느 문항에서 닫나
select props->>'last_question' as q, count(*) from events
where app = 'otbbal' and not is_internal and event_name = 'survey_close' group by 1 order by 1;

-- 나이대 · 성별
select props->>'age' as age, props->>'gender' as gender, count(distinct user_id) as people
from events where app = 'otbbal' and not is_internal and event_name = 'survey_submit'
group by 1, 2 order by 1, 2;

-- 해본 이유 순위 (복수 선택 펼쳐서)
select r as reason, count(distinct e.user_id) as people
from events e, jsonb_array_elements_text(e.props->'reasons') r
where e.app = 'otbbal' and not e.is_internal and e.event_name = 'survey_submit'
group by 1 order by 2 desc;

-- 기타 이유 원문
select props->>'reasons_other' from events
where app = 'otbbal' and not is_internal and event_name = 'survey_submit' and props->>'reasons_other' is not null;

-- 처음 들어온 경로 × 나이대
select v.props->>'ft_source' as ft_source, s.props->>'age' as age, count(distinct s.user_id) as people
from events s
join lateral (
  select props from events v
  where v.app = 'otbbal' and v.user_id = s.user_id and v.event_name = 'visit'
  order by v.event_time limit 1
) v on true
where s.app = 'otbbal' and not s.is_internal and s.event_name = 'survey_submit'
group by 1, 2 order by 1, 2;

-- 재방문 의향 vs 실제 재방문 (제출 뒤 7일 안에 새 visit)
select s.props->>'revisit' as said, count(*) as people,
       count(*) filter (where exists (
         select 1 from events v
         where v.app = 'otbbal' and v.user_id = s.user_id and v.event_name = 'visit'
           and v.event_time > s.event_time and v.event_time < s.event_time + interval '7 days'
       )) as came_back
from events s
where s.app = 'otbbal' and not s.is_internal and s.event_name = 'survey_submit'
group by 1;
```

1차는 응답이 적을 것이라 비율 옆에 **응답 수를 같이** 적고 "경향"으로만 본다.

## 7. 확인

- [x] 📏 창을 닫고 1.5초 뒤 설문이 올라온다 (팀 표시 상태, 개발 서버)
- [x] 📏 창을 닫지 않고 AGAIN → 그 판에는 안 뜸
- [x] "나중에" → 결과 화면 그대로, 2번 뒤 다시 뜸 (결과 2에서 뜸 → 3 안 뜸 → 4 뜸)
- [x] 바깥 탭으로 닫힘, `survey_close`에 `last_question` · `answered_so_far`
- [x] Q1 · Q2 · Q4 탭 한 번에 넘어감, Q3 2개까지 · 3개째 안내, 기타 비우면 "다음" 꺼짐
- [x] Q3 보기 순서 섞임, 기타 맨 아래, 제출 → 토스트 → `survey_submit` 모든 값
- [x] 휴대폰 크기 화면 확인
- [ ] 실제 배포(팀 표시 아닌 폰)에서 누적 2번째 결과에 뜨는지, 페이지를 다시 열어도 횟수가 이어지는지
- [ ] 도전장 게스트 첫 결과에 뜨는지, 끝난 도전장 구경만 하면 안 뜨는지
- [ ] `select * from events where event_name like 'survey%' order by id desc limit 10;`
- [ ] 네트워크 끊고 제출해도 게임이 멈추지 않는지
