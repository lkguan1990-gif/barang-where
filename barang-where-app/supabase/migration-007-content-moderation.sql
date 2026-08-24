-- ============================================================
-- Migration: server-side content moderation for listings
-- Run this once in your Supabase project's SQL Editor.
--
-- WHY THIS EXISTS, SEPARATE FROM THE CLIENT-SIDE CHECK:
-- The check in app.js (reading moderation-keywords.js) only runs in the
-- browser. Anyone who calls the Supabase REST API directly -- skipping
-- your website's JavaScript entirely -- would bypass it completely. This
-- migration adds the same check as a database trigger, so it's enforced
-- no matter how someone tries to insert or update a listing.
--
-- KEEPING THIS IN SYNC:
-- The terms below are a snapshot of public/moderation-keywords.js at the
-- time this migration was written. If you add a keyword to that file
-- later, you also need to add it here (via a new migration that replaces
-- the function) for it to actually be enforced -- the two lists do not
-- sync automatically.
-- ============================================================

create or replace function public.check_forbidden_content()
returns trigger
language plpgsql
as $$
declare
  forbidden_terms text[] := array[
    -- Weapons
    'firearm','handgun','pistol','revolver','rifle','shotgun',
    'ammunition','ammo round','bullet cartridge','gun magazine',
    'grenade','detonator','gun silencer','gun suppressor',
    'flick knife','butterfly knife','balisong','gravity knife',
    'knuckle duster','brass knuckles','stun gun','taser',
    'pepper spray','crossbow','airsoft gun','bb gun replica',
    -- Drugs
    'cannabis','marijuana','weed for sale','cocaine','heroin',
    'methamphetamine','crystal meth','ecstasy pills','mdma',
    'ketamine','lsd tabs','opium','cbd oil','cannabis oil',
    'drug paraphernalia','bong for drugs','vape juice thc','thc oil',
    -- Explosives
    'fireworks for sale','firecracker','explosive device','gunpowder',
    'blasting cap','pipe bomb',
    -- Vapes (fully banned in Singapore)
    'vape','e-cigarette','electronic cigarette','vape pod',
    'vape juice','e-liquid','pod system device','heat-not-burn device',
    'juul','iqos',
    -- Wildlife
    'ivory','rhino horn','shark fin','tiger bone','pangolin scale',
    'turtle shell','exotic animal pelt','endangered species product',
    -- Adult content
    'sex toy','vibrator','dildo','adult video','pornographic content',
    'escort service','sex worker service','brothel','nude photo set',
    'adult content subscription','sex doll','fetish gear for sale',
    -- Counterfeit / stolen
    'counterfeit','replica currency','fake currency','stolen goods',
    'pirated software','cracked software','fake id card',
    'counterfeit passport','forged document','fake designer',
    -- Other
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
