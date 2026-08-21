-- ============================================================
-- Migration: add location_mode to garages
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste this -> Run)
--
-- This is safe to run even if you've already listed items or
-- set your location -- it only adds a new column with a default
-- value, it doesn't touch or remove any existing data.
-- ============================================================

alter table public.garages
  add column if not exists location_mode text not null default 'fixed'
  check (location_mode in ('fixed','live'));
