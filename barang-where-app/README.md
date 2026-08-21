# Barang Where — deployable app

A real, working version of the prototype: Supabase for auth/database/photo
storage/realtime chat, and a plain static frontend (no build step — just
HTML/CSS/JS) that you can host anywhere that serves static files.

This is a working MVP, not a finished commercial product. What it *does*
give you: real accounts, a real database, real photo uploads, and real
live chat between neighbours. What it does **not** give you: actual
payment processing for Boost/Pro (see "What's stubbed out" below).

---

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. Pick the **Singapore (ap-southeast-1)** region — your users are all
   local, and this keeps latency low and data physically in-country.
3. Once it's created, open **SQL Editor → New query**, paste in the
   entire contents of `supabase/schema.sql`, and run it. This creates
   every table, security policy, the photo storage bucket, and turns on
   realtime for chat messages.
4. Go to **Project Settings → API**. You'll need two values from here:
   - **Project URL**
   - **anon / public key**

## 2. Configure the app

Open `public/config.js` and replace the placeholder values:

```js
window.NDL_CONFIG = {
  SUPABASE_URL: "https://your-project-ref.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-public-key",
  DEFAULT_TOWN: "Sengkang"
};
```

The anon key is safe to expose in client-side code — it's meant to be
public. Real access control comes from the Row Level Security policies
in `schema.sql`, not from hiding this key.

## 3. Turn on email login

By default Supabase sends magic-link emails from its own shared sender,
which is fine for testing but rate-limited and not meant for production.

- For testing: it works out of the box, no setup needed.
- For real use: go to **Authentication → Providers → Email** and, when
  you're ready, **Project Settings → Auth → SMTP Settings** to connect
  your own email sender (e.g. Resend, Postmark) so magic links are
  reliable at real volume.

Also set **Authentication → URL Configuration → Site URL** to whatever
domain you deploy the app to in step 4 — this is where magic links will
redirect back to.

## 4. Deploy the frontend, the proper way (GitHub + Cloudflare Pages)

Everything the browser needs lives in the `public/` folder — plain
static files, no build step. Connecting it to GitHub means every future
change ships automatically the moment you push, with full version
history as a bonus.

### Push this project to GitHub

From this project's root folder (the one containing this README):

```bash
git init
git add .
git commit -m "Initial commit"
```

Then create a new, empty repository on [github.com/new](https://github.com/new)
(don't initialize it with a README — this project already has one), and
push:

```bash
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPO-NAME.git
git branch -M main
git push -u origin main
```

### Connect Cloudflare Pages to that repo

This repo includes a `wrangler.jsonc` file at its root, which tells
Cloudflare's deploy tooling exactly where the static site lives
(`./public`). This is required — without it, Cloudflare's build step
(`wrangler deploy`) won't know which folder to publish and the deploy
will fail with a "Could not detect a directory containing static files"
error.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com), go to
   **Workers & Pages → Create → Pages → Connect to Git**.
2. Authorize Cloudflare to access your GitHub account, then pick the
   repo you just pushed.
3. Cloudflare will detect the `wrangler.jsonc` file automatically —
   you shouldn't need to set a build command or output directory
   manually.
4. Click **Save and Deploy**. You'll get a working `*.pages.dev` URL
   within a minute or two.

From now on, shipping an update is just:

```bash
git add .
git commit -m "describe what changed"
git push
```

Cloudflare picks up the push automatically and redeploys — no manual
uploading, ever again.

### Add your own domain

In the Pages project → **Custom domains** → **Set up a custom domain**,
enter your domain, and Cloudflare provisions free HTTPS for it
automatically.

### Point Supabase at the real domain

Go back to **Authentication → URL Configuration** in Supabase (see step 3
above) and update **Site URL** and **Redirect URLs** to your real domain
— not the `*.pages.dev` one, if you've attached a custom domain, and
definitely not `localhost`. This is the step that's easy to forget and
causes magic links to redirect somewhere dead.

<details>
<summary>Prefer to skip GitHub and just drag-and-drop? (click to expand)</summary>

You can still deploy without git: Cloudflare Pages → Create → Pages →
**Upload assets**, and drag in the `public` folder directly — same
motion as Netlify Drop, except the resulting site doesn't expire. You'll
just need to re-upload manually for every future change, instead of
`git push` doing it for you.
</details>

## 5. Try it

1. Open your deployed URL, enter your email, and check your inbox for
   the magic link.
2. Click it — you'll land back in the app, signed in.
3. Fill in your name, block, and town. Allow location when prompted
   (this is what powers "sort by distance" — we round it to ~100m
   before saving, so no one gets your exact doorstep).
4. Go to **My Garage → List a new item**, add a photo, and publish.
5. Open the app in a second browser (or incognito window) with a
   different email to simulate a second neighbour, and try messaging
   yourself across the two sessions — chat is real-time.

---

## What's stubbed out (and what to do about it)

**Boost and Pro Garage payments.** Tapping "Confirm boost" or "Start Pro
Garage" writes the boosted/Pro status directly to the database — no
money changes hands. Before charging real users, you'd wire these
buttons to a payment provider (Stripe Checkout is the most
straightforward path for SGD; PayNow via a payment facilitator like
HitPay or Xfers is a Singapore-specific alternative) and only flip
`boosted` / `is_pro` in the database from a **server-side webhook**
after payment confirms — never directly from the client, or anyone could
give themselves Pro for free by editing the request.

**Nothing else is faked** — auth, listings, photo storage, geolocation-based
distance sorting, and chat are all real and backed by your database.

## A note on scale

This schema and app will comfortably handle a single estate's pilot on
Supabase's free tier. Revisit hosting costs (covered earlier in this
conversation) once you have real usage data — the free tier is generous
enough that you shouldn't need to think about billing until you have
genuine traction.
