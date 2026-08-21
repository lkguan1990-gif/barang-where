# Barang Where — Project Log

**Date:** August 2026
**Status:** Live and functional at `barang-where.lkguan1990.workers.dev`

---

## 1. The Concept

A hyperlocal marketplace for HDB residents to sell new or secondhand items
to neighbours within their block or nearby blocks — framed as walking
into someone's garage sale, but online.

**Core design decisions:**
- **Discovery**: GPS-based, auto-detects nearby garages within a radius
  (not manual block entry)
- **Vibe**: always-on hyperlocal marketplace, not scheduled "garage sale
  hours" events
- **Transactions**: in-app chat only — buyer and seller arrange price,
  meetup spot, and payment themselves. No built-in payment processing,
  no suggested meetup locations.
- **Privacy**: block number and rough distance only — never exact unit
  numbers or precise addresses. Location is rounded to ~100m before
  being stored.

---

## 2. Product & Design

Built a fully interactive mockup (single HTML file) establishing the
visual identity before any backend work:

- **Visual language**: HDB carpark/void-deck signage aesthetic —
  terrazzo-textured backgrounds, bold hand-painted block-number tiles as
  the signature visual element (used consistently as every garage's
  "avatar"), laundry-pole-inspired dashed section dividers
- **Palette**: warm terrazzo cream/grey base, HDB-signage red, zinc
  blue, sunny yellow, olive accents
- **Type**: Anton (display/block numbers), Inter (body), IBM Plex Mono
  (distances, prices, timestamps)
- **Screens**: Nearby (GPS feed), Garage page, Item detail, Chat list,
  Chat thread, My Garage, Add Item, Profile

---

## 3. Monetization

Two revenue features, deliberately avoiding ads:

### Boost
Pay to pin a listing to the top of Nearby search results.
- 24 hours — $1.50
- 3 days — $3.50
- 7 days — $6.90

### Pro Garage — $2.90/month
- 3 photos per item (up from 1 free photo for all users)
- Custom garage tagline
- Pro badge next to garage name
- **3 free boost credits per month**
- Basic listing stats *(designed, not yet built)*

**Key pivot during design**: originally considered capping free-tier
listings at 8 items and gating multiple photos behind Pro. Both were
reversed — unlimited free listings for everyone (to encourage
decluttering, the whole point of the app) and 1 free photo per item for
everyone (buyers need to see real condition, not an icon, to make a
purchase decision).

---

## 4. Business Strategy Decisions

- **Hosting cost model**: Supabase (Singapore region) + Cloudflare —
  effectively free at prototype/pilot scale, ~$30–40/month at small real
  launch scale. Bandwidth/egress identified as the real cost driver for
  a photo-heavy app, not storage — hence the Cloudflare-centric stack
  (zero egress fees).
- **App Store strategy**: Apple actively rejects plain web-wrapped apps
  under Guideline 4.2 as of 2026. Since the target community is
  iPhone-heavy, decided against chasing native App Store distribution
  for now. **Plan: PWA-first** — installable via Safari's "Add to Home
  Screen," which also unlocks real push notifications on iOS (supported
  since iOS 16.4+). Google Play remains a viable, low-effort path later
  via Trusted Web Activity. *(PWA manifest + service worker not yet
  built.)*

---

## 5. Naming

Extensive process of elimination — each of these was checked and ruled
out for a real conflict:

| Name | Why it was rejected |
|---|---|
| Void Deck | Felt architectural/cold, not warm |
| Next Door Lah | Too close to Nextdoor's trademark, same category |
| Kampung Corner | Read as an F&B brand |
| Blok Party | Doesn't fit — app isn't a scheduled event |
| Lobang (variants) | Crowded (multiple existing apps) + unfortunate meaning in Bahasa Indonesia |
| Barang Barang | **Real conflict** — established Singapore furniture retailer since 1994 |
| Sayang | Reads as a dating/romance app name |
| Kaki Lang | Already used in spirit by another SG app; phonetically close to an F&B chain |
| Karang Guni | Connotes junk/scrap, not curated marketplace; conceptual overlap with existing app "Dumpling" |
| Jiran | Existing apps (incl. MYJIRAN) with near-identical name and mission |
| Sebelah / Barang Sebelah | Not broadly known outside Malay speakers — fails "easy mention" across all races |
| Chope Barang | **Real conflict** — Chope is a major, currently-operating SG dining-reservation company |
| Neighbour Barang | "Neighbour/Neighbor" is the most crowded root word in this exact app category worldwide |

**Final name: Barang Where** — no conflicts found in available searches.
*(Note: verified via web search only — running it through IPOS Go,
Singapore's official free trademark/business-name/domain checker, is
still recommended before any serious commercial commitment.)*

---

## 6. Technical Build

### Stack
- **Frontend**: static HTML/CSS/JS, no framework, no build step
- **Backend**: Supabase — Postgres database, passwordless email auth,
  file storage, realtime subscriptions
- **Hosting**: Cloudflare (Workers/Pages, unified deployment)

### What's real (not mocked)
- Passwordless magic-link login
- Live Postgres database with Row Level Security policies (garages,
  items, conversations, messages, saved_items tables)
- Real photo uploads to Supabase Storage
- Browser geolocation for distance-based sorting (rounded before saving)
- Real-time chat between two actual accounts

### What's intentionally stubbed
- **Boost and Pro Garage payments** — currently write directly to the
  database with no real charge. Production would need Stripe or a
  PayNow provider (e.g. HitPay), with the database write happening from
  a server-side webhook after payment confirms, not from the client
  directly.

### Deliverables produced
- `barang-where.html` — standalone interactive mockup
- `barang-where-app/` — full deployable project:
  - `public/` — index.html, app.js, styles.css, config.js
  - `supabase/schema.sql` — full database schema + RLS policies +
    storage bucket setup
  - `wrangler.jsonc` — Cloudflare deployment config
  - `README.md` — full setup and deployment instructions
  - `.gitignore`

---

## 7. Deployment Journey

1. **First attempt — Netlify Drop**: worked initially, but hit several
   issues:
   - Magic-link redirect pointed at `localhost:3000` (Supabase's Site
     URL wasn't updated to match the deployed address)
   - `otp_expired` errors — likely link pre-scanning by email clients,
     or PKCE browser-mismatch
   - Hit Supabase's built-in email rate limit (~4 emails/hour) from
     repeated testing
   - Learned unclaimed Netlify Drop sites can expire within roughly an
     hour, and re-dropping generates a new random URL each time

2. **Decided to move to permanent, "properly hosted" infrastructure**:
   GitHub + Cloudflare Pages, connected via Git for automatic deploys on
   every push.

3. **Deployment debugging, in order encountered:**
   - `git commit` failed — no git identity configured on a fresh
     machine → fixed with `git config --global user.email/user.name`
   - Nested duplicate folder from zip extraction (`barang-where-app/`
     inside `barang-where-app/`) → initially attempted a local
     robocopy fix, but the nested structure ended up on GitHub anyway
   - Cloudflare build failed: `Could not detect a directory containing
     static files` — Cloudflare's deployment tooling now requires an
     explicit `wrangler.jsonc` pointing to the assets directory → added
     `wrangler.jsonc` directly via GitHub's web editor
   - Build still failed to find `public/` — repo root and actual
     project root didn't match (files sat inside a `barang-where-app`
     subfolder) → fixed via Cloudflare's **Root directory (advanced)**
     project setting, set to `barang-where-app`
   - Build succeeded — deployed to
     `https://barang-where.lkguan1990.workers.dev`
   - App loaded but showed a config warning — `config.js` still had
     placeholder Supabase credentials → fixed by editing the file on
     GitHub
   - Config warning persisted even after editing, in incognito → root
     cause was a stray line break inside the anon key string, breaking
     the file with a JavaScript syntax error → fixed by replacing the
     full file content cleanly
   - Magic link redirected to the old dead Netlify URL → fixed by
     updating Supabase's **Authentication → URL Configuration** (Site
     URL and Redirect URLs) to the new Cloudflare Workers URL

4. **Result**: successfully signed in on the live, permanently-hosted
   URL.

---

## 8. Current Status & Next Steps

**Confirmed working:** hosting, auto-deploy from GitHub, sign-in flow,
config connection to Supabase.

**In progress — validating the full loop:**
- [ ] Complete onboarding (name, block, town, location)
- [ ] List a test item with a real photo
- [ ] Confirm a second account can see it in Nearby
- [ ] Confirm real-time chat works between two accounts

**Not yet started:**
- [ ] Confirm `supabase/schema.sql` has actually been run in the
      Supabase project (flagged earlier as unverified)
- [ ] Attach a real custom domain
- [ ] Set up custom SMTP (e.g. Resend) — currently on Supabase's
      low-volume default email sender
- [ ] Build the PWA layer (manifest + service worker) for iPhone
      installability
- [ ] Run the final name through IPOS Go before any serious commercial
      commitment
- [ ] Wire Boost/Pro payments to a real payment provider before
      charging real money
