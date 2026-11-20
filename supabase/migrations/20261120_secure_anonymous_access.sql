-- Run once in Supabase SQL Editor after enabling Anonymous Sign-Ins.
-- Legacy rooms created before this migration have no verified host identity.
-- They remain readable only through the invite bundle RPC; create new rooms
-- after migration because legacy host controls cannot be safely transferred.

alter table public.rooms add column if not exists host_user_id uuid references auth.users(id) on delete set null;
alter table public.responses add column if not exists user_id uuid references auth.users(id) on delete set null;

alter table public.rooms enable row level security;
alter table public.questions enable row level security;
alter table public.responses enable row level security;

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

-- Private helpers and room lookup. SECURITY DEFINER is tightly scoped and
-- exposes only the requested room bundle, never a list of room codes.
create or replace function public.is_room_host(p_room_code text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rooms r
    where r.code = p_room_code and r.host_user_id = (select auth.uid())
  );
$$;

create or replace function public.is_room_revealed(p_room_code text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.rooms r
    where r.code = p_room_code and r.status = 'revealed'
  );
$$;

create or replace function public.is_valid_room_response(
  p_room_code text, p_question_id text, p_answer text
)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.questions q
    where q.id = p_question_id
      and q.room_code = p_room_code
      and p_answer = any(q.options)
  );
$$;

create or replace function public.get_room_bundle(p_code text)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'room', (
      to_jsonb(r) - 'host_user_id'
      || case when r.host_user_id = (select auth.uid())
        then jsonb_build_object('host_user_id', r.host_user_id)
        else '{}'::jsonb
      end
    ),
    'questions', coalesce(
      jsonb_agg(to_jsonb(q) order by q.position)
        filter (where q.id is not null),
      '[]'::jsonb
    )
  )
  from public.rooms r
  left join public.questions q on q.room_code = r.code
  where r.code = p_code and (select auth.uid()) is not null
  group by r.code;
$$;

revoke all on function public.is_room_host(text) from public, anon;
revoke all on function public.is_room_revealed(text) from public, anon;
revoke all on function public.is_valid_room_response(text,text,text) from public, anon;
revoke all on function public.get_room_bundle(text) from public, anon;
grant execute on function public.is_room_host(text) to authenticated;
grant execute on function public.is_room_revealed(text) to authenticated;
grant execute on function public.is_valid_room_response(text,text,text) to authenticated;
grant execute on function public.get_room_bundle(text) to authenticated;

-- Room metadata and questions are not enumerable through table SELECT.
create policy "rooms host read" on public.rooms
for select to authenticated
using (host_user_id = (select auth.uid()));

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

create policy "questions host read" on public.questions
for select to authenticated
using (public.is_room_host(room_code));

create policy "questions host create" on public.questions
for insert to authenticated
with check (public.is_room_host(room_code));

create policy "questions host update" on public.questions
for update to authenticated
using (public.is_room_host(room_code))
with check (public.is_room_host(room_code));

create policy "questions host delete" on public.questions
for delete to authenticated
using (public.is_room_host(room_code));

create policy "responses controlled read" on public.responses
for select to authenticated
using (
  user_id = (select auth.uid())
  or public.is_room_host(room_code)
  or public.is_room_revealed(room_code)
);

create policy "responses own create" on public.responses
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_valid_room_response(room_code, question_id, answer)
);

create policy "responses own update" on public.responses
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and public.is_valid_room_response(room_code, question_id, answer)
);

create policy "responses own or host delete" on public.responses
for delete to authenticated
using (user_id = (select auth.uid()) or public.is_room_host(room_code));

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
