-- Reflection answers must not be accepted until the host has revealed the room.
-- Existing rooms in "voting" remain intact; their host can reveal them before round two.

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
        (p_phase = 'after_reveal' and r.status = 'revealed')
      )
  );
$$;

revoke all on function public.is_valid_room_response(text,text,text,text) from public, anon;
grant execute on function public.is_valid_room_response(text,text,text,text) to authenticated;
