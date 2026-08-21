-- ============================================================
-- Migration: add deleted_at to items (soft-delete)
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste this -> Run)
--
-- Why: previously, deleting a listing permanently removed its row,
-- which cascaded and destroyed any chat conversations/messages
-- about it too. From now on, deleting sets deleted_at instead --
-- the row (and any chat history tied to it) stays intact, but the
-- listing itself disappears from Nearby, garage pages, My Garage,
-- and Liked. Uploaded photos are still actually deleted from
-- storage to reclaim space -- only the database row is kept.
--
-- Safe to run on existing data -- only adds a new nullable column.
-- ============================================================

alter table public.items
  add column if not exists deleted_at timestamptz;
