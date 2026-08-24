// Barang Where — forbidden listing keywords
//
// Purpose: block listings for items that are illegal to sell/possess under
// Singapore law, or that don't belong on a family-friendly neighbourhood
// marketplace (adult content). This file is the single place to add new
// terms — nothing else in the app needs to change when you extend a list.
//
// HOW TO ADD A KEYWORD
// Just add a new string to the relevant array below, lowercase. Multi-word
// phrases are checked as whole phrases (e.g. "flick knife"), which is
// deliberate — see the false-positive note below.
//
// IMPORTANT: THIS FILE ONLY DRIVES THE CLIENT-SIDE CHECK.
// Client-side JavaScript can be bypassed by anyone who calls the Supabase
// API directly instead of using this website — it stops honest mistakes,
// not a determined bad actor. Real enforcement also needs a database-level
// check. See supabase/migration-007-content-moderation.sql, which embeds
// its own copy of these terms in a Postgres trigger. If you add a keyword
// here, add it there too — the two lists are NOT automatically synced.
//
// FALSE POSITIVES — READ BEFORE ADDING SINGLE, COMMON WORDS
// This is a real secondhand marketplace. Bare words like "knife" or "gun"
// would block completely legal listings (kitchen knives, Nerf guns, toy
// water guns). Prefer specific multi-word phrases ("flick knife", "brass
// knuckles") over single common words wherever possible. If you must add a
// broad single word, test it against ordinary listings first.

window.FORBIDDEN_KEYWORDS = {

  // Real firearms, ammunition, and restricted weapons.
  // Singapore: Arms and Explosives Act; Corrosive and Explosive Substances
  // and Offensive Weapons Act. Airsoft/BB guns are also tightly restricted
  // for private ownership in Singapore, unlike many other countries.
  weapons: [
    "firearm", "handgun", "pistol", "revolver", "rifle", "shotgun",
    "ammunition", "ammo round", "bullet cartridge", "gun magazine",
    "grenade", "detonator", "gun silencer", "gun suppressor",
    "flick knife", "butterfly knife", "balisong", "gravity knife",
    "knuckle duster", "brass knuckles", "stun gun", "taser",
    "pepper spray", "crossbow", "airsoft gun", "bb gun replica",
  ],

  // Controlled substances and related paraphernalia.
  // Singapore: Misuse of Drugs Act — notably, CBD is also controlled here,
  // unlike in many other countries where it's sold openly.
  drugs: [
    "cannabis", "marijuana", "weed for sale", "cocaine", "heroin",
    "methamphetamine", "crystal meth", "ecstasy pills", "mdma",
    "ketamine", "lsd tabs", "opium", "cbd oil", "cannabis oil",
    "drug paraphernalia", "bong for drugs", "vape juice thc", "thc oil",
  ],

  // Explosives and fireworks.
  explosives: [
    "fireworks for sale", "firecracker", "explosive device", "gunpowder",
    "blasting cap", "pipe bomb",
  ],

  // Vapes and e-cigarettes — fully banned in Singapore (possession,
  // import, sale, and distribution), unlike most other countries.
  vapes: [
    "vape", "e-cigarette", "electronic cigarette", "vape pod",
    "vape juice", "e-liquid", "pod system device", "heat-not-burn device",
    "juul", "iqos",
  ],

  // Endangered species products.
  // Singapore: Endangered Species (Import & Export) Act.
  wildlife: [
    "ivory", "rhino horn", "shark fin", "tiger bone", "pangolin scale",
    "turtle shell", "exotic animal pelt", "endangered species product",
  ],

  // Adult/sexual content — not illegal generally, but not appropriate for
  // a neighbourhood family marketplace.
  adultContent: [
    "sex toy", "vibrator", "dildo", "adult video", "pornographic content",
    "escort service", "sex worker service", "brothel", "nude photo set",
    "adult content subscription", "sex doll", "fetish gear for sale",
  ],

  // Counterfeit, stolen, or fraudulent goods.
  counterfeitAndStolen: [
    "counterfeit", "replica currency", "fake currency", "stolen goods",
    "pirated software", "cracked software", "fake id card",
    "counterfeit passport", "forged document", "fake designer",
  ],

  // Other Singapore-specific restricted items.
  other: [
    "prescription medication for sale", "controlled medicine",
    "unregistered pharmaceutical", "human organ",
  ],
};
