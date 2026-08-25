-- ============================================================
-- Migration: separate garage (home) location from browse-from location
-- Run this once in your Supabase project's SQL Editor.
--
-- WHY: previously, a single lat/lng pair served two different jobs at
-- once -- where your garage is advertised to buyers, AND where you
-- personally browse from. Switching to Live mode to browse other
-- sellers elsewhere would silently "move" your own garage's advertised
-- address too. This migration splits them:
--   home_lat/home_lng    -- your garage's permanent address (rare to
--                           change -- only when you actually move house)
--   browse_lat/browse_lng -- where YOU are searching from right now
--                            (Fixed mirrors home; Live tracks your GPS)
-- ============================================================

-- 1. Rename the existing columns -- this becomes the permanent home address.
alter table public.garages rename column lat to home_lat;
alter table public.garages rename column lng to home_lng;

-- 2. Add the new browse-from columns, backfilled from home so nothing
--    breaks for existing rows (everyone starts out "browsing from home").
alter table public.garages add column if not exists browse_lat double precision;
alter table public.garages add column if not exists browse_lng double precision;
update public.garages set browse_lat = home_lat, browse_lng = home_lng
  where browse_lat is null;
