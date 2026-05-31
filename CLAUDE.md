# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the app

No build step, bundler, package manager, lint, or tests — it's a static site. It must be
served over HTTP (not opened as `file://`, which breaks localStorage and the Supabase client):

    python3 -m http.server 8000   # then open http://localhost:8000

The Supabase JS SDK is vendored at `js/vendor/supabase.min.js` (not loaded from a CDN), so the
app keeps working offline once loaded.

## Backend setup

Backend is Supabase with **real Supabase Auth** (username + password). The anon key in
[js/db.js](js/db.js) is intentional — RLS is the gate, not key secrecy. For a fresh project, run
[supabase/schema.sql](supabase/schema.sql) once in the Supabase SQL editor; to migrate an existing
`dennis`/`clemens` project while preserving its data, follow the ordered steps in
[supabase/migration-auth.sql](supabase/migration-auth.sql) instead.

**Required manual dashboard step:** in Supabase → Authentication, **disable "Confirm email"**.
Usernames have no real email — the app maps a username to a synthetic `<slug>@muscleup.local`
address (see [js/auth.js](js/auth.js)), which can never be confirmed. With confirmations on,
`signUp` returns no session and login is permanently broken. (Consequence: password reset is not
supported — admin/manual only.)

Two tables, keyed by the Auth user id (`auth.users.id`); Realtime is enabled on `sessions`:
- `sessions` — one row per completed workout (`user_id`, `phase`, `session_date`, `exercises` jsonb)
- `profiles` — one row per user (`user_id` PK, unique `username`, `current_phase`)

RLS: any logged-in user can **read all** rows (for the leaderboard) but **write only their own**
(`auth.uid() = user_id`). `phase`/`current_phase` keep `CHECK (… BETWEEN 1 AND 3)`, so changing the
number of phases still requires a schema migration. Usernames are unbounded (no CHECK); uniqueness
is enforced by the synthetic-email uniqueness plus a `UNIQUE(username)` constraint.

## Architecture

Vanilla JS, no framework. Six scripts load in a **fixed order** (see [index.html](index.html));
each attaches a global the next one depends on, so the order cannot be changed casually:

`supabase.min.js` → `data.js` (`window.PLAN`) → `db.js` (`window.DB`) → `auth.js` (`window.Auth`) → `sync.js` (`window.Sync`) → `app.js`

- **[js/data.js](js/data.js)** — `PLAN`: the hardcoded 3-phase program (exercises, sets/reps,
  and `phase3Checklist`). This is the source of truth for what's displayed; no exercise data
  lives in the database.
- **[js/db.js](js/db.js)** — thin Supabase wrapper (IIFE returning async query functions).
  All database access goes through here. `createClient` enables `persistSession` (keep logged in).
- **[js/auth.js](js/auth.js)** — username↔synthetic-email auth: `signUp`/`signIn`/`signOut`,
  `getSession`, `onChange`, and the `slug()` that maps a username to its `@muscleup.local` email.
- **[js/sync.js](js/sync.js)** — `subscribeToSessions`: subscribes to **all** `sessions` INSERTs
  via Realtime to refresh the live leaderboard. Must be called only after a session exists (the
  SDK applies the JWT to the realtime socket asynchronously).
- **[js/app.js](js/app.js)** — everything else: one global `state` object, auth-gated two-screen
  routing (`showScreen` over `#screen-auth`/`#screen-main`, driven by `Auth.onChange`), imperative
  DOM rendering (`render*` functions including `renderLeaderboard`), and the session lifecycle.

### Key patterns

**Offline-first writes.** `completeSession` writes the session to `localStorage`
(`mu_pending_sessions`) *before* attempting the Supabase insert. On success it's removed from the
queue; on failure it stays. `retryPendingSessions()` flushes the queue on app load and on the
`online` event. The original `session_date` is stored locally so a delayed upload keeps the real
workout date. Network listeners are registered once at startup (not per screen load) to avoid
duplicate handlers.

**Auth gates everything; the persisted Supabase session is the identity.** On load `app.js`
registers `Auth.onChange`, which fires `INITIAL_SESSION` with the persisted session (or null) and
routes to `#screen-main` or `#screen-auth`. There is no `mu_user` key anymore — identity comes from
the session (`session.user.id`). The heavy `loadMainScreen` is deferred out of the `onChange`
callback via `setTimeout(0)` (calling Supabase inside the callback can deadlock).

**localStorage is the instant-render cache; Supabase is the shared truth.** On load,
`loadMainScreen` reads the phase from `localStorage` first for an instant render, then reconciles
with the `profiles` row. Keys: `mu_phase_<userId>`, `mu_pending_sessions` (records carry `user_id`),
`mu_phase<N>_transition_dismissed_<userId>`.

**Phase progression.** `state.sessionCount` counts sessions in the *current* phase. When it
reaches that phase's `totalSessions`, a transition banner appears. The 2→3 transition is gated
behind ticking all `phase3Checklist` items; `advancePhase` increments the phase, resets the count,
and writes to both `localStorage` and the `profiles` table.

UI language is German.
