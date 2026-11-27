-- 옷빨 배틀 DB 설계
-- Supabase 대시보드 → SQL Editor → New query 에 이 파일 내용을 통째로 붙여 넣고 Run.
-- 여러 번 실행해도 안전하게 짰다.

-- 1) 사용자 프로필: 로그인하면 자동으로 한 줄 생김
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '익명',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(
      new.raw_user_meta_data ->> 'nickname',
      new.raw_user_meta_data ->> 'user_name',
      new.raw_user_meta_data ->> 'preferred_username',
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'full_name',
      '익명'
    ), 20)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 2) 사진 지문별 점수: 같은 사진 = 같은 점수 (사진 자체는 저장 안 함)
create table if not exists public.photo_scores (
  hash text not null,
  rubric_version text not null,
  color smallint not null,
  fit smallint not null,
  harmony smallint not null,
  trend smallint not null,
  total smallint not null,
  nickname text not null default '',
  praise text not null default '',
  scored_by uuid references auth.users (id) on delete set null,
  scored_ip text,             -- IP 원문이 아니라 해시값 (비로그인 하루 제한용)
  created_at timestamptz not null default now(),
  primary key (hash, rubric_version)
);
alter table public.photo_scores add column if not exists mood text; -- 코디 무드 (2026-11-26). 같으면 배틀 점수 차를 3~5점으로 좁힘
create index if not exists photo_scores_by_user on public.photo_scores (scored_by, created_at);
create index if not exists photo_scores_by_ip on public.photo_scores (scored_ip, created_at);

-- 3) 배틀 기록: 로그인한 사람이 1P
create table if not exists public.battles (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p1_hash text not null,
  p2_hash text not null,
  p1_total smallint not null,
  p2_total smallint not null,
  p1_won boolean not null,
  p1_nickname text not null default '',
  hidden boolean not null default false,   -- 관리자가 랭킹에서 내릴 때 true
  created_at timestamptz not null default now(),
  check (p1_hash <> p2_hash)
);
create index if not exists battles_by_time on public.battles (created_at);
create index if not exists battles_by_user on public.battles (user_id);

-- 3-1) (추가) 가짜 점수 판 표시, 친구 공개용 1P 사진 경로
alter table public.battles add column if not exists is_mock boolean not null default false;
alter table public.battles add column if not exists p1_photo_path text;   -- 저장소 'photos' 안의 경로. null 이면 사진 비공개

-- 3-2) (추가) 친구: 초대 코드 + 친구 관계 (양쪽 방향으로 한 줄씩)
alter table public.profiles add column if not exists invite_code text
  default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
update public.profiles set invite_code = lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)) where invite_code is null;
create unique index if not exists profiles_invite_code on public.profiles (invite_code);

create table if not exists public.friendships (
  user_id uuid not null references auth.users (id) on delete cascade,
  friend_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

-- 3-3) (추가) 친구 공개용 사진 저장소 (비공개 버킷, 서버가 잠깐 쓰는 링크로만 보여줌)
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false)
on conflict (id) do nothing;

-- 3-4) (추가) 링크 대결방: 1P가 자기 폰에서 사진 올리고 링크를 보내면 2P가 자기 폰에서 붙는다.
--      사진은 'photos' 저장소의 rooms/<코드>/ 에 24시간만 두고, 서버가 방 만들 때마다 오래된 방을 지운다.
create table if not exists public.battle_rooms (
  code text primary key,
  host_token_hash text not null,          -- 방장 폰 확인용 (토큰 원문은 저장 안 함)
  host_id uuid references auth.users (id) on delete set null,
  host_name text not null default '',
  host_share boolean not null default false,
  p1_hash text not null,
  p1_score jsonb not null,
  p1_cached boolean not null default false,
  guest_id uuid references auth.users (id) on delete set null,
  guest_name text,
  p2_hash text,
  result jsonb,                           -- 점수·승패·한줄평 (결과 나면 채워짐)
  is_mock boolean not null default false,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists battle_rooms_by_time on public.battle_rooms (created_at);

-- 4) 보안: 브라우저(공개 키)에서는 아무 표도 직접 못 읽고 못 씀.
--    읽기·쓰기는 전부 서버(비밀 키)를 거친다.
alter table public.profiles enable row level security;
alter table public.photo_scores enable row level security;
alter table public.battles enable row level security;
alter table public.friendships enable row level security;
alter table public.battle_rooms enable row level security;

-- 서버(비밀 키 = service_role)는 읽고 쓸 수 있게 권한을 명시한다.
-- (최근 Supabase 프로젝트는 새 표에 기본 권한을 자동으로 주지 않을 수 있음)
grant select, insert, update, delete on public.profiles, public.photo_scores, public.battles, public.friendships, public.battle_rooms to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 5) 랭킹 계산
--    kind = 'best' : 내 사진(1P) 중 최고 점수
--    kind = 'wins' : 이긴 판 수. 같은 (내 사진, 상대 사진) 조합은 1승으로만 셈
--    since = null 이면 전체, 날짜를 주면 그 이후(주간)
--    이름은 앞 글자만 보이게 가린다 (실명 노출 방지)
create or replace function public.get_ranking(kind text, since timestamptz, max_rows int default 50)
returns table (rank bigint, user_id uuid, display_name text, value int, detail text)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select * from public.battles
    where not hidden and not is_mock and (since is null or created_at >= since)
  ),
  best as (
    select distinct on (b.user_id) b.user_id, b.p1_total::int as value, b.p1_nickname as detail, b.created_at as at
    from b
    order by b.user_id, b.p1_total desc, b.created_at asc
  ),
  wins as (
    select b.user_id, count(distinct b.p1_hash || ':' || b.p2_hash)::int as value, null::text as detail, max(b.created_at) as at
    from b
    where b.p1_won
    group by b.user_id
  ),
  picked as (
    select * from best where kind = 'best'
    union all
    select * from wins where kind = 'wins'
  )
  select
    rank() over (order by p.value desc) as rank,
    p.user_id,
    case
      when char_length(coalesce(pr.display_name, '익명')) <= 1 then coalesce(pr.display_name, '익명')
      else left(pr.display_name, 1) || repeat('*', least(char_length(pr.display_name) - 1, 3))
    end as display_name,
    p.value,
    p.detail
  from picked p
  left join public.profiles pr on pr.id = p.user_id
  order by p.value desc, p.at asc
  limit max_rows;
$$;

revoke all on function public.get_ranking(text, timestamptz, int) from public, anon, authenticated;
grant execute on function public.get_ranking(text, timestamptz, int) to service_role;

-- 6) 행동 로그 (docs/log-design-otbbal.md). 옷빨 전용 (돌수제비는 자기 표 dolsujebi_log 를 씀). 한 줄 = 이벤트 하나
--    사진·사진 지문·IP·닉네임·한줄평 원문은 넣지 않는다. 쓰기는 서버(/api/log)만.
create table if not exists public.events (
  id bigint generated always as identity primary key,
  event_id uuid not null unique,              -- 브라우저가 만든 값. 재전송돼도 한 줄만
  event_time timestamptz not null default now(), -- 서버 수신 시각 (분석 기준)
  client_time timestamptz,
  app text not null check (app in ('dolsu', 'otbbal')),
  user_id text not null,                      -- 익명 브라우저 id
  auth_uid uuid references auth.users (id) on delete set null, -- 로그인했으면 계정 id (탈퇴하면 연결만 끊김)
  session_id text not null,                   -- 7분 동안 이벤트 없으면 새 세션
  event_name text not null,
  stage smallint,
  device text,
  browser text,
  source text,
  source_detail text,
  is_internal boolean not null default false, -- 팀원 트래픽 (분석 때 제외)
  props jsonb not null default '{}'
);
create index if not exists events_app_time on public.events (app, event_time);
create index if not exists events_session on public.events (session_id);
alter table public.events enable row level security;  -- 정책 없음 = 브라우저 키로는 못 읽고 못 씀
grant select, insert on public.events to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 6-1) 옷빨 지표 뷰: SQL Editor 에서 select * from v_otbbal_daily; 처럼 한 줄로 본다 (팀 트래픽·테스트 채점 제외)
--      v_otbbal_sessions  세션 한 줄 요약 (다른 뷰의 바탕)
--      v_otbbal_daily     날짜·처음 유입 경로별 방문, 첫 플레이 전환율(H2-a/H2-b), 2판 이상 비율(H3), 공유
--      v_otbbal_funnel    단계 1~6 도달 세션 수 (모드 구분 없이 / 모드별은 문서의 쿼리)
--      v_otbbal_first_play 첫 플레이까지 걸린 초 중앙값
create or replace view public.v_otbbal_sessions with (security_invoker = true) as
select
  session_id,
  min(user_id) as user_id,
  min(event_time) as started_at,
  (min(event_time) at time zone 'Asia/Seoul')::date as day,
  min(source) filter (where event_name = 'visit') as source,
  min(source_detail) filter (where event_name = 'visit') as source_detail,
  min(props->>'ft_source') filter (where event_name = 'visit') as ft_source,
  min(device) as device,
  min(browser) as browser,
  bool_or(event_name = 'visit') as has_visit,
  bool_or(event_name = 'visit' and (props->>'is_return')::boolean) as is_return,
  bool_or(event_name = 'first_play' and coalesce((props->>'mock')::boolean, false) = false) as played,
  bool_or(event_name = 'room_create' and (props->>'ok')::boolean) as made_room,
  count(*) filter (where event_name = 'play' and coalesce((props->>'mock')::boolean, false) = false) as plays,
  count(*) filter (where event_name = 'play' and (props->>'is_again')::boolean) as again_plays,
  bool_or(event_name = 'replay') as replayed,
  bool_or(event_name = 'share') as shared,
  bool_or(event_name = 'login_prompt') as hit_wall,
  max(stage) filter (where event_name = 'stage_enter') as max_stage,
  extract(epoch from max(event_time) - min(event_time))::int as dwell_sec
from public.events
where app = 'otbbal' and not is_internal
group by session_id;

create or replace view public.v_otbbal_daily with (security_invoker = true) as
select
  day,
  coalesce(ft_source, source) as source,
  count(*) as visits,
  count(*) filter (where is_return) as return_visits,
  count(*) filter (where played) as h2a_played,
  count(*) filter (where played or made_room) as h2b_played_or_room,
  round(100.0 * count(*) filter (where played or made_room) / nullif(count(*), 0), 1) as h2b_pct,
  count(*) filter (where plays >= 2) as h3_two_plus,
  round(100.0 * count(*) filter (where plays >= 2) / nullif(count(*) filter (where played), 0), 1) as h3_pct,
  round(avg(plays) filter (where played), 2) as plays_per_played_session,
  count(*) filter (where shared) as shared_sessions,
  count(*) filter (where hit_wall) as login_wall_sessions
from public.v_otbbal_sessions
where has_visit
group by 1, 2
order by 1 desc, visits desc;

create or replace view public.v_otbbal_funnel with (security_invoker = true) as
select stage, count(distinct session_id) as sessions
from public.events
where app = 'otbbal' and not is_internal and event_name = 'stage_enter'
group by stage
order by stage;

create or replace view public.v_otbbal_first_play with (security_invoker = true) as
select
  count(*) as first_plays,
  percentile_cont(0.5) within group (order by (props->>'sec_since_visit')::numeric) as median_sec,
  round(100.0 * count(*) filter (where (props->>'sec_since_visit')::numeric <= 60) / nullif(count(*), 0), 1) as within_60s_pct
from public.events
where app = 'otbbal' and not is_internal and event_name = 'first_play';

revoke all on public.v_otbbal_sessions, public.v_otbbal_daily, public.v_otbbal_funnel, public.v_otbbal_first_play from anon, authenticated;
grant select on public.v_otbbal_sessions, public.v_otbbal_daily, public.v_otbbal_funnel, public.v_otbbal_first_play to service_role;

-- 7) (추가 2026-11-26) 랭킹 등록: 로그인만으로는 랭킹에 안 뜬다.
--    랭킹 화면에서 '랭킹 등록' → 닉네임을 정한 사람만 주간 랭킹에 닉네임·최고 점수·승수로 보인다.
--    등록 전에 한 이번 주 배틀도 등록하면 같이 잡힌다 (배틀 기록 자체는 로그인하면 계속 쌓임).
alter table public.profiles add column if not exists rank_name text;
alter table public.profiles add column if not exists ranked_at timestamptz;
create unique index if not exists profiles_rank_name on public.profiles (lower(rank_name));

create or replace function public.get_weekly_ranking(since timestamptz, max_rows int default 50)
returns table (rank bigint, user_id uuid, rank_name text, best int, wins int)
language sql
stable
security definer
set search_path = ''
as $$
  with b as (
    select * from public.battles
    where not hidden and not is_mock and created_at >= since
  ),
  agg as (
    select
      b.user_id,
      max(b.p1_total)::int as best,
      count(distinct case when b.p1_won then b.p1_hash || ':' || b.p2_hash end)::int as wins
    from b
    group by b.user_id
  )
  select
    rank() over (order by a.best desc, a.wins desc) as rank,
    a.user_id,
    pr.rank_name,
    a.best,
    a.wins
  from agg a
  join public.profiles pr on pr.id = a.user_id and pr.rank_name is not null
  order by a.best desc, a.wins desc, pr.ranked_at asc
  limit max_rows;
$$;

revoke all on function public.get_weekly_ranking(timestamptz, int) from public, anon, authenticated;
grant execute on function public.get_weekly_ranking(timestamptz, int) to service_role;
