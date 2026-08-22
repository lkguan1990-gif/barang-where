-- ============================================================
-- Migration: optional neighbourhood field for garages
-- Run this once in your Supabase project's SQL Editor.
-- Safe on existing data -- only adds a new nullable column,
-- defaulting to empty for every existing garage.
--
-- This is purely cosmetic (e.g. "Khatib", "near Pioneer MRT") --
-- it's never used for search, filtering, or distance matching.
-- The official Town field remains the one used for all of that.
-- ============================================================

alter table public.garages
  add column if not exists neighbourhood text default '';
