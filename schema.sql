-- SECRET MVP schema
-- Run this in Supabase SQL Editor for shared rooms across devices.
-- IMPORTANT: These permissive policies are for a private prototype/demo only.
-- Before public launch, add host authentication, rate limiting, abuse protection,
-- and stricter policies / server-side validation.

create table if not exists public.rooms (
  code text primary key,
  title text not null default 'Untitled experiment',
  status text not null default 'waiting' check (status in ('waiting','voting','revealed')),
  created_at timestamptz not null default now()
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
  unique(room_code, question_id, participant_id, phase)
);

alter table public.rooms enable row level security;
alter table public.questions enable row level security;
alter table public.responses enable row level security;

-- Prototype policies: anonymous users can access demo room data.
-- Do not use these policies for a production public service.
create policy "prototype rooms read" on public.rooms for select to anon, authenticated using (true);
create policy "prototype rooms create" on public.rooms for insert to anon, authenticated with check (true);
create policy "prototype rooms update" on public.rooms for update to anon, authenticated using (true) with check (true);

create policy "prototype questions read" on public.questions for select to anon, authenticated using (true);
create policy "prototype questions create" on public.questions for insert to anon, authenticated with check (true);

create policy "prototype responses read" on public.responses for select to anon, authenticated using (true);
create policy "prototype responses create" on public.responses for insert to anon, authenticated with check (true);
create policy "prototype responses update" on public.responses for update to anon, authenticated using (true) with check (true);

-- Enable realtime updates for live room responses/status.
alter publication supabase_realtime add table public.responses;
alter publication supabase_realtime add table public.rooms;
