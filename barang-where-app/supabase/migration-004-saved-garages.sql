-- ============================================================
-- Migration: saved_garages (liking a whole garage, not just an item)
-- Run this once in your Supabase project's SQL Editor.
-- Safe on existing data -- only adds a new table.
-- ============================================================

create table if not exists public.saved_garages (
  user_id     uuid not null references auth.users(id) on delete cascade,
  garage_id   uuid not null references public.garages(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, garage_id)
);

alter table public.saved_garages enable row level security;

create policy "Users manage their own saved garages"
  on public.saved_garages for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
