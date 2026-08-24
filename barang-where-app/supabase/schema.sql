-- ============================================================
-- Barang Where — Supabase schema
-- Run this once in your Supabase project's SQL Editor
-- (Dashboard → SQL Editor → New query → paste all of this → Run)
-- ============================================================

-- Needed for gen_random_uuid()
create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- GARAGES (one per user — their public seller profile)
-- ------------------------------------------------------------
create table public.garages (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text not null,
  block                text not null,
  town                 text not null default 'Sengkang',
  neighbourhood        text default '',  -- optional, cosmetic only (e.g. "Khatib") -- never used for search/matching
  lat                  double precision,   -- rounded to ~100m before saving, see app.js
  lng                  double precision,
  location_mode        text not null default 'fixed' check (location_mode in ('fixed','live')),
  tagline              text default '',
  is_pro               boolean not null default false,
  pro_expires_at       timestamptz,
  free_boost_credits   integer not null default 0,
  rating               numeric not null default 5.0,
  created_at           timestamptz not null default now()
);

alter table public.garages enable row level security;

create policy "Garages are publicly viewable"
  on public.garages for select
  using (true);

create policy "Users can create their own garage"
  on public.garages for insert
  with check (auth.uid() = id);

create policy "Users can update their own garage"
  on public.garages for update
  using (auth.uid() = id);

-- ------------------------------------------------------------
-- ITEMS (listings)
-- ------------------------------------------------------------
create table public.items (
  id                 uuid primary key default gen_random_uuid(),
  garage_id          uuid not null references public.garages(id) on delete cascade,
  title              text not null,
  price              numeric not null check (price >= 0),
  categories         text[] not null default '{}',   -- an item can belong to more than one category
  condition          text not null,
  description        text default '',
  photos             text[] not null default '{}',   -- public URLs in the item-photos bucket
  status             text not null default 'Available' check (status in ('Available','Reserved','Sold')),
  boosted            boolean not null default false,
  boost_expires_at   timestamptz,
  deleted_at         timestamptz,   -- soft-delete: set instead of removing the row, so old chats survive
  created_at         timestamptz not null default now()
);

alter table public.items enable row level security;

create policy "Items are publicly viewable"
  on public.items for select
  using (true);

create policy "Owners can insert their own items"
  on public.items for insert
  with check (auth.uid() = garage_id);

create policy "Owners can update their own items"
  on public.items for update
  using (auth.uid() = garage_id);

create policy "Owners can delete their own items"
  on public.items for delete
  using (auth.uid() = garage_id);

-- ------------------------------------------------------------
-- SAVED ITEMS (favorites)
-- ------------------------------------------------------------
create table public.saved_items (
  user_id     uuid not null references auth.users(id) on delete cascade,
  item_id     uuid not null references public.items(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.saved_items enable row level security;

create policy "Users manage their own saved items"
  on public.saved_items for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ------------------------------------------------------------
-- SAVED GARAGES (liking a whole seller, not just one item —
-- lets a buyer find their way back to a garage even if it's
-- currently outside their browsing radius or they're away
-- from home)
-- ------------------------------------------------------------
create table public.saved_garages (
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

-- ------------------------------------------------------------
-- CONVERSATIONS (one per buyer+item pair)
-- ------------------------------------------------------------
create table public.conversations (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.items(id) on delete cascade,
  buyer_id    uuid not null references public.garages(id) on delete cascade,
  seller_id   uuid not null references public.garages(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (item_id, buyer_id)
);

alter table public.conversations enable row level security;

create policy "Participants can view their conversations"
  on public.conversations for select
  using (auth.uid() = buyer_id or auth.uid() = seller_id);

create policy "Buyers can start a conversation"
  on public.conversations for insert
  with check (auth.uid() = buyer_id);

-- ------------------------------------------------------------
-- MESSAGES
-- ------------------------------------------------------------
create table public.messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.conversations(id) on delete cascade,
  sender_id         uuid not null references auth.users(id) on delete cascade,
  body              text not null,
  created_at        timestamptz not null default now()
);

alter table public.messages enable row level security;

create policy "Participants can view messages in their conversations"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

create policy "Participants can send messages in their conversations"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = conversation_id
        and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
    )
  );

-- ------------------------------------------------------------
-- REALTIME — let the client subscribe to live message inserts
-- ------------------------------------------------------------
alter publication supabase_realtime add table public.messages;

-- ------------------------------------------------------------
-- STORAGE — bucket for item photos
-- Photos are public-read (so buyers can view them without logging in
-- to see previews) but only the uploading user can write to their own
-- folder, named after their user id.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('item-photos', 'item-photos', true)
on conflict (id) do nothing;

create policy "Public read of item photos"
  on storage.objects for select
  using (bucket_id = 'item-photos');

create policy "Users upload photos into their own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'item-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users delete their own photos"
  on storage.objects for delete
  using (
    bucket_id = 'item-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ------------------------------------------------------------
-- CONTENT MODERATION — blocks listings referencing illegal or
-- adult-content terms at the database level, so it can't be bypassed
-- by calling the API directly instead of using the website. Keep this
-- in sync with public/moderation-keywords.js when adding new terms --
-- see the comments in migration-007-content-moderation.sql.
-- ------------------------------------------------------------
create or replace function public.check_forbidden_content()
returns trigger
language plpgsql
as $$
declare
  forbidden_terms text[] := array[
    'firearm','handgun','pistol','revolver','rifle','shotgun',
    'ammunition','ammo round','bullet cartridge','gun magazine',
    'grenade','detonator','gun silencer','gun suppressor',
    'flick knife','butterfly knife','balisong','gravity knife',
    'knuckle duster','brass knuckles','stun gun','taser',
    'pepper spray','crossbow','airsoft gun','bb gun replica',
    'cannabis','marijuana','weed for sale','cocaine','heroin',
    'methamphetamine','crystal meth','ecstasy pills','mdma',
    'ketamine','lsd tabs','opium','cbd oil','cannabis oil',
    'drug paraphernalia','bong for drugs','vape juice thc','thc oil',
    'fireworks for sale','firecracker','explosive device','gunpowder',
    'blasting cap','pipe bomb',
    'vape','e-cigarette','electronic cigarette','vape pod',
    'vape juice','e-liquid','pod system device','heat-not-burn device',
    'juul','iqos',
    'ivory','rhino horn','shark fin','tiger bone','pangolin scale',
    'turtle shell','exotic animal pelt','endangered species product',
    'sex toy','vibrator','dildo','adult video','pornographic content',
    'escort service','sex worker service','brothel','nude photo set',
    'adult content subscription','sex doll','fetish gear for sale',
    'counterfeit','replica currency','fake currency','stolen goods',
    'pirated software','cracked software','fake id card',
    'counterfeit passport','forged document','fake designer',
    'prescription medication for sale','controlled medicine',
    'unregistered pharmaceutical','human organ'
  ];
  combined_text text;
  term text;
begin
  combined_text := lower(coalesce(new.title, '') || ' ' || coalesce(new.description, ''));
  foreach term in array forbidden_terms loop
    if combined_text like '%' || term || '%' then
      raise exception 'Listing blocked: contains a restricted term ("%").', term;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists items_content_moderation on public.items;
create trigger items_content_moderation
  before insert or update on public.items
  for each row execute function public.check_forbidden_content();

-- ------------------------------------------------------------
-- Done. Next steps are in README.md.
-- ------------------------------------------------------------
