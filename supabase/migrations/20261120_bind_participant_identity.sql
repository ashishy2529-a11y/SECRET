-- Bind one anonymous participant identity to each authenticated session per room.
-- Existing authenticated responses are consolidated to the latest answer per question/phase.
-- No names, emails, phone numbers, or auth user IDs are exposed to other participants.

create table if not exists public.room_participants (
  room_code text not null references public.rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  participant_id text not null,
  created_at timestamptz not null default now(),
  primary key (room_code, user_id),
  unique (room_code, participant_id)
);

-- Preserve the latest response where an older browser created multiple participant IDs
-- for the same authenticated user in the same room.
with ranked as (
  select
    id,
    row_number() over (
      partition by room_code, user_id, question_id, phase
      order by created_at desc nulls last, id desc
    ) as position
  from public.responses
  where user_id is not null
)
delete from public.responses r
using ranked x
where r.id = x.id and x.position > 1;

insert into public.room_participants (room_code, user_id, participant_id)
select pairs.room_code, pairs.user_id, pg_catalog.gen_random_uuid()::text
from (
  select distinct room_code, user_id
  from public.responses
  where user_id is not null
) pairs
on conflict (room_code, user_id) do nothing;

-- Move historical responses onto the canonical room identity.
update public.responses r
set participant_id = rp.participant_id
from public.room_participants rp
where r.room_code = rp.room_code
  and r.user_id = rp.user_id
  and r.participant_id <> rp.participant_id;

alter table public.room_participants enable row level security;
revoke all on public.room_participants from public, anon, authenticated;

create or replace function public.get_room_participant_id(p_room_code text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_participant_id text;
begin
  if v_user_id is null then
    raise exception 'An anonymous session is required.';
  end if;

  insert into public.room_participants (room_code, user_id, participant_id)
  select p_room_code, v_user_id, pg_catalog.gen_random_uuid()::text
  where exists (select 1 from public.rooms r where r.code = p_room_code)
  on conflict (room_code, user_id) do nothing;

  select rp.participant_id
  into v_participant_id
  from public.room_participants rp
  where rp.room_code = p_room_code
    and rp.user_id = v_user_id;

  if v_participant_id is null then
    raise exception 'Room not found or participant identity could not be created.';
  end if;

  return v_participant_id;
end;
$$;

create or replace function public.is_room_participant(
  p_room_code text,
  p_participant_id text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.room_participants rp
    where rp.room_code = p_room_code
      and rp.participant_id = p_participant_id
      and rp.user_id = (select auth.uid())
  );
$$;

revoke all on function public.get_room_participant_id(text) from public, anon;
revoke all on function public.is_room_participant(text,text) from public, anon;
grant execute on function public.get_room_participant_id(text) to authenticated;
grant execute on function public.is_room_participant(text,text) to authenticated;

drop policy if exists "responses own create" on public.responses;
drop policy if exists "responses own update" on public.responses;

create policy "responses own create" on public.responses
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_room_participant(room_code, participant_id)
  and public.is_valid_room_response(room_code, question_id, answer, phase)
);

create policy "responses own update" on public.responses
for update to authenticated
using (
  user_id = (select auth.uid())
  and public.is_room_participant(room_code, participant_id)
)
with check (
  user_id = (select auth.uid())
  and public.is_room_participant(room_code, participant_id)
  and public.is_valid_room_response(room_code, question_id, answer, phase)
);
