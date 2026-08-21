-- ============================================================
-- Migration: multi-category support for items
-- Run this once in your Supabase project's SQL Editor.
--
-- Converts the single `category` text column into a `categories`
-- text array, so an item can be tagged with more than one category
-- (e.g. a kids' desk lamp as both "Baby & Kids" and "Electronics").
--
-- Safe on existing data: every item's current category is preserved
-- as the first (and only) entry in its new categories array.
-- ============================================================

-- 1. Add the new array column.
alter table public.items
  add column if not exists categories text[] not null default '{}';

-- 2. Copy each item's existing single category into the new array,
--    only for rows that haven't been migrated yet.
update public.items
set categories = array[category]
where category is not null
  and (categories is null or categories = '{}');

-- 3. Drop the old single-category column now that data is preserved.
alter table public.items
  drop column if exists category;
