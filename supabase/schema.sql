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

-- 4) 보안: 브라우저(공개 키)에서는 아무 표도 직접 못 읽고 못 씀.
--    읽기·쓰기는 전부 서버(비밀 키)를 거친다.
alter table public.profiles enable row level security;
alter table public.photo_scores enable row level security;
alter table public.battles enable row level security;

-- 서버(비밀 키 = service_role)는 읽고 쓸 수 있게 권한을 명시한다.
-- (최근 Supabase 프로젝트는 새 표에 기본 권한을 자동으로 주지 않을 수 있음)
grant select, insert, update, delete on public.profiles, public.photo_scores, public.battles to service_role;
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
    where not hidden and (since is null or created_at >= since)
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
