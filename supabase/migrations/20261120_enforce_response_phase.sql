-- Enforce response phase timing at the database boundary.
-- Initial answers are accepted before reveal; reflection answers only after reveal.
-- Run this migration in Supabase SQL Editor after the earlier security migration.

drop policy if exists "responses own create" on public.responses;
drop policy if exists "responses own update" on public.responses;

revoke all on function public.is_valid_room_response(text,text,text) from public, anon, authenticated;
drop function if exists public.is_valid_room_response(text,text,text);

create or replace function public.is_valid_room_response(
  p_room_code text,
  p_question_id text,
  p_answer text,
  p_phase text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.questions q
    join public.rooms r on r.code = q.room_code
    where q.id = p_question_id
      and q.room_code = p_room_code
      and p_answer = any(q.options)
      and (
        (p_phase = 'initial' and r.status in ('waiting', 'voting'))
        or
        (p_phase = 'after_reveal' and r.status in ('revealed', 'voting'))
      )
  );
$$;

revoke all on function public.is_valid_room_response(text,text,text,text) from public, anon;
grant execute on function public.is_valid_room_response(text,text,text,text) to authenticated;

create policy "responses own create" on public.responses
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_valid_room_response(room_code, question_id, answer, phase)
);

create policy "responses own update" on public.responses
for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and public.is_valid_room_response(room_code, question_id, answer, phase)
);
