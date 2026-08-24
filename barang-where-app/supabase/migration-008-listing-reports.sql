-- ============================================================
-- Migration: listing reports (Fake, Spam, Offensive, etc.)
-- Run this once in your Supabase project's SQL Editor.
--
-- This is the human backstop for the keyword content-moderation guard --
-- for anything that slips through it (misspellings, a bad photo with an
-- innocent title, etc.), any signed-in user can flag a specific listing.
-- Reports never auto-hide or auto-delete anything -- they just notify
-- you by email so you can review and decide manually.
-- ============================================================

-- 1. The reports table itself.
create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  item_id      uuid not null references public.items(id) on delete cascade,
  reporter_id  uuid not null references auth.users(id) on delete cascade,
  reason       text not null check (reason in ('Prohibited item','Offensive','Fake or counterfeit','Spam','Scam attempt','Other')),
  details      text default '',
  created_at   timestamptz not null default now(),
  unique (reporter_id, item_id) -- one report per person per listing
);

alter table public.reports enable row level security;

-- Anyone signed in can file a report on any item, but only as themselves.
create policy "Users can report items"
  on public.reports for insert
  with check (auth.uid() = reporter_id);

-- Deliberately no select policy -- reports are private, visible only via
-- the Supabase SQL Editor (or a service_role key), not through the app.
-- This matches the "manual review only" approach: nobody, including the
-- reporter, can see report contents through the client.


-- 2. Email notification on every new report.
-- Requires the pg_net extension (Dashboard -> Database -> Extensions,
-- or the line below) -- this is the same extension that powers
-- Supabase's own Database Webhooks feature, so it's a standard,
-- well-supported capability, not a workaround.
create extension if not exists pg_net;

create or replace function public.notify_new_report()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_title text;
  reporter_email text;
begin
  select title into item_title from public.items where id = new.item_id;
  select email into reporter_email from auth.users where id = new.reporter_id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer YOUR_RESEND_API_KEY',   -- same key used for SMTP earlier
      'Content-Type', 'application/json'
    ),
    body := jsonb_build_object(
      'from', 'reports@YOURDOMAIN.com',                -- must be on your verified Resend domain
      'to', 'YOUR_OWN_EMAIL@example.com',               -- where you want to actually receive these
      'subject', 'New listing report: ' || coalesce(item_title, 'Unknown item'),
      'html',
        '<p><b>Reason:</b> ' || new.reason || '</p>' ||
        '<p><b>Details:</b> ' || coalesce(nullif(new.details, ''), '(none provided)') || '</p>' ||
        '<p><b>Item:</b> ' || coalesce(item_title, 'Unknown') || ' (id: ' || new.item_id || ')</p>' ||
        '<p><b>Reported by:</b> ' || coalesce(reporter_email, 'unknown') || '</p>' ||
        '<p><b>Reported at:</b> ' || new.created_at || '</p>'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_new_report on public.reports;
create trigger on_new_report
  after insert on public.reports
  for each row execute function public.notify_new_report();

-- ============================================================
-- BEFORE THIS WORKS, replace three placeholders above:
--   1. YOUR_RESEND_API_KEY  -- the same key you used for SMTP earlier
--   2. YOURDOMAIN.com       -- your verified Resend sending domain
--   3. YOUR_OWN_EMAIL       -- wherever you want report emails to land
-- ============================================================
