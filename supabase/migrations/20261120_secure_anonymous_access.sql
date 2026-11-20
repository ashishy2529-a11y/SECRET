-- Apply once in Supabase SQL Editor after enabling Anonymous Sign-Ins.
-- Existing rooms have no trustworthy host identity and are intentionally not
-- auto-assigned. Create new rooms after this migration; old rooms are legacy.
-- SECRET secure anonymous MVP schema
-- Anonymous Auth must be enabled in Supabase before participants use the cloud app.

create table if not exists public.rooms (
  code text primary key,
  title text not null default 'Untitled experiment',
  status text not null default 'waiting' check (status in ('waiting','voting','revealed')),
  created_at timestamptz not null default now(),
  host_user_id uuid references auth.users(id) on delete set null
);

create table if not exists public.questions (
  id text primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  prompt text not null,
  options text[] not null,
  position integer not null
);

create table if not exists public.responses (
  id text primary key,
  room_code text not null references public.rooms(code) on delete cascade,
  question_id text not null references public.questions(id) on delete cascade,
  participant_id text not null,
  answer text not null,
  phase text not null check (phase in ('initial','after_reveal')),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  unique(room_code, question_id, participant_id, phase)
);

alter table public.rooms add column if not exists host_user_id uuid references auth.users(id) on delete set null;
alter table public.responses add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.rooms enable row level security;
alter table public.questions enable row level security;
alter table public.responses enable row level security;

-- Remove every old policy on these tables. Permissive policies are OR-combined,
-- so leaving even one prototype policy would bypass the restrictions below.
do $$
declare p record;
begin
  for p in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('rooms','questions','responses')
  loop
    execute format('drop policy if exists %I on %I.%I', p.policyname, p.schemaname, p.tablename);
  end loop;
end $$;

-- Room codes are the invite capability. Only authenticated anonymous sessions
-- can use the app; room metadata/questions are visible to people with the code.
create policy "rooms invite read" on public.rooms
for select to authenticated using (true);

create policy "rooms host create" on public.rooms
for insert to authenticated
with check (host_user_id = (select auth.uid()));

create policy "rooms host update" on public.rooms
for update to authenticated
using (host_user_id = (select auth.uid()))
with check (host_user_id = (select auth.uid()));

create policy "rooms host delete" on public.rooms
for delete to authenticated
using (host_user_id = (select auth.uid()));

create policy "questions room read" on public.questions
for select to authenticated
using (exists (
  select 1 from public.rooms r where r.code = questions.room_code
));

create policy "questions host create" on public.questions
for insert to authenticated
with check (exists (
  select 1 from public.rooms r
  where r.code = questions.room_code and r.host_user_id = (select auth.uid())
));

create policy "questions host update" on public.questions
for update to authenticated
using (exists (
  select 1 from public.rooms r
  where r.code = questions.room_code and r.host_user_id = (select auth.uid())
))
with check (exists (
  select 1 from public.rooms r
  where r.code = questions.room_code and r.host_user_id = (select auth.uid())
));

create policy "questions host delete" on public.questions
for delete to authenticated
using (exists (
  select 1 from public.rooms r
  where r.code = questions.room_code and r.host_user_id = (select auth.uid())
));

-- Participants can see their own rows and the host can see all rows.
-- Everyone in the room can see responses only after the host reveals results.
create policy "responses controlled read" on public.responses
for select to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.rooms r
    where r.code = responses.room_code and r.host_user_id = (select auth.uid())
  )
  or exists (
    select 1 from public.rooms r
    where r.code = responses.room_code and r.status = 'revealed'
  )
);

create policy "responses own create" on public.responses
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.questions q
    where q.id = responses.question_id
      and q.room_code = responses.room_code
      and responses.answer = any(q.options)
  )
);

create policy "responses own update" on public.responses
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from public.questions q
    where q.id = responses.question_id
      and q.room_code = responses.room_code
      and responses.answer = any(q.options)
  )
);

create policy "responses own or host delete" on public.responses
for delete to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1 from public.rooms r
    where r.code = responses.room_code and r.host_user_id = (select auth.uid())
  )
);

-- Realtime is used by the live room UI. Ignore duplicate-publication errors.
do $$
begin
  alter publication supabase_realtime add table public.responses;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null;
end $$;
