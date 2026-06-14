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
[supabase/migration-auth.sql](supabase/migration-auth.sql) instead. The handstand feature adds a
`handstand_sessions` table: it ships in `schema.sql` for fresh projects, and an existing project
gets it by running the idempotent [supabase/migration-handstand.sql](supabase/migration-handstand.sql)
once (safe to re-run; until it runs, handstand completions just queue offline and standings show
"Offline"). [supabase/ACTIVATION-handstand.md](supabase/ACTIVATION-handstand.md) is the full
activation checklist with verification queries and an in-app smoke test.

**Required manual dashboard step:** in Supabase → Authentication, **disable "Confirm email"**.
Usernames have no real email — the app maps a username to a synthetic `<slug>@muscleup.local`
address (see [js/auth.js](js/auth.js)), which can never be confirmed. With confirmations on,
`signUp` returns no session and login is permanently broken. (Consequence: password reset is not
supported — admin/manual only.)

Three tables, keyed by the Auth user id (`auth.users.id`); Realtime is enabled on `sessions` and
`handstand_sessions`:
- `sessions` — one row per completed muscle-up workout (`user_id`, `phase`, `session_date`,
  `exercises` jsonb)
- `handstand_sessions` — one row per completed handstand block (`user_id`, `block`, `session_date`,
  `exercises` jsonb). Parallel to `sessions` but keyed by `block` text, not a phase number.
- `profiles` — one row per user (`user_id` PK, unique `username`, `current_phase`)

RLS: any logged-in user can **read all** rows (for the leaderboard/standings) but **write only their
own** (`auth.uid() = user_id`). `phase`/`current_phase` keep `CHECK (… BETWEEN 1 AND 3)`, so changing
the number of phases still requires a schema migration. `handstand_sessions.block` has **no CHECK** by
design — block ids are app-defined content, so adding a block stays a code change, not a migration.
Usernames are unbounded (no CHECK); uniqueness is enforced by the synthetic-email uniqueness plus a
`UNIQUE(username)` constraint.

## Architecture

Vanilla JS, no framework. Seven scripts load in a **fixed order** (see [index.html](index.html));
each attaches a global the next one depends on, so the order cannot be changed casually:

`supabase.min.js` → `data.js` (`window.PLAN`) → `handstand-data.js` (`window.HANDSTAND`) → `db.js` (`window.DB`) → `auth.js` (`window.Auth`) → `sync.js` (`window.Sync`) → `app.js`

- **[js/data.js](js/data.js)** — `PLAN`: the hardcoded 3-phase muscle-up program (exercises,
  sets/reps, and `phase3Checklist`). This is the source of truth for what's displayed; no exercise
  data lives in the database.
- **[js/handstand-data.js](js/handstand-data.js)** — `HANDSTAND`: the hardcoded handstand program,
  `{ blocks: [{ id, letter, name, duration, goal, exercises:[{ id, name, prescription, howto }] }] }`.
  Five blocks (A–E); each exercise carries a German `howto` cue shown inline. Pure data, no
  dependency on `DB`/`Auth`, so it loads right after `data.js`.
- **[js/db.js](js/db.js)** — thin Supabase wrapper (IIFE returning async query functions).
  All database access goes through here. `createClient` enables `persistSession` (keep logged in).
- **[js/auth.js](js/auth.js)** — username↔synthetic-email auth: `signUp`/`signIn`/`signOut`,
  `updatePassword`, `getSession`, `onChange`, and the `slug()`/`emailFor()` that map a username to
  its `@muscleup.local` email.
- **[js/sync.js](js/sync.js)** — `subscribeToSessions`/`subscribeToHandstand`/`unsubscribe`:
  subscribes to **all** INSERTs on `sessions` (live leaderboard) and `handstand_sessions` (live
  standings) via Realtime. Must be called only after a session exists (the SDK applies the JWT to the
  realtime socket asynchronously). Two separate channels; each `subscribe*` clears only its own, and
  `unsubscribe` tears **both** down on logout and before each re-subscribe.
- **[js/app.js](js/app.js)** — everything else: one global `state` object, imperative DOM rendering
  (`render*` functions), and the session lifecycle. Two layers of routing:
  - **Auth-gated screen switch** — `showScreen` toggles `#screen-auth` vs `#screen-app`.
  - **In-app mode + tab router** — inside `#screen-app` the app has two **modes** (`state.mode`:
    `'muscleup'` | `'handstand'`), switched by an always-visible segmented toggle in the top bar
    (`.mode-toggle` / `.mode-btn[data-mode]`, bound in `initNav`; `setMode` persists it to
    `mu_mode_<userId>` and calls `syncModeToggle`). The hamburger menu holds four logical **tabs**
    (`data-tab`: `today`, `leaderboard`, `plan`, `settings`) decoupled from the concrete `.page`
    sections. `navigate(tab)` resolves the section via `PAGES[state.mode][tab]`, shows it, marks the
    active nav item, and lazily re-renders it; `setMode` re-runs `navigate(state.tab)` so switching
    mode swaps the content in place on the same tab. Section map: muscleup → `page-today`,
    `page-leaderboard`, `page-plan`; handstand → `page-handstand` (today/picker),
    `page-handstand-standings`, `page-handstand-plan`; **`page-settings` is shared across both modes**.
    There is no top-bar title and no separate "Handstand" menu item — the mode owns that. Adding a tab
    means adding a `data-tab` button plus an entry in each mode's `PAGES` map.

### Key patterns

**Offline-first writes.** `completeSession` writes the session to `localStorage`
(`mu_pending_sessions`) *before* attempting the Supabase insert. On success it's removed from the
queue; on failure it stays. `retryPendingSessions()` flushes the queue on app load and on the
`online` event. The original `session_date` is stored locally so a delayed upload keeps the real
workout date. Network listeners are registered once at startup (not per screen load) to avoid
duplicate handlers.

**Auth gates everything; the persisted Supabase session is the identity.** On load `app.js` does
the first route itself via an explicit `await Auth.getSession()` (reads localStorage, works offline),
then routes to `#screen-app` or `#screen-auth`. `Auth.onChange` is registered for *subsequent*
transitions only (`SIGNED_IN`/`SIGNED_OUT`/token refresh) and deliberately **ignores
`INITIAL_SESSION`**, so a blank screen never depends on the SDK's initial emission. There is no
`mu_user` key — identity comes from the session (`session.user.id`). Inside the `onChange` callback
the heavy `loadMainScreen` is deferred via `setTimeout(0)` (calling Supabase inside the callback can
deadlock), and same-user token refreshes are short-circuited (`uid === state.userId`).

**localStorage is the instant-render cache; Supabase is the shared truth.** On load,
`loadMainScreen` reads the phase from `localStorage` first for an instant render, then reconciles
with the `profiles` row. Keys: `mu_phase_<userId>`, `mu_pending_sessions` (records carry `user_id`),
`mu_phase<N>_transition_dismissed_<userId>`, `mu_mode_<userId>` (last-used training mode),
`mu_handstand_block_<userId>` (last-picked handstand block).

**Phase progression.** `state.sessionCount` counts sessions in the *current* phase. When it
reaches that phase's `totalSessions`, a transition banner appears. The 2→3 transition is gated
behind ticking all `phase3Checklist` items; `advancePhase` increments the phase, resets the count,
and writes to both `localStorage` and the `profiles` table.

**Post-session undo/repeat.** After `completeSession`, a bar offers Undo/Repeat against
`state.lastSession` (`{ localId, supabaseId, exercises, phase }`). `undoLastSession` removes the row
from both the pending queue and Supabase (by `supabaseId`); `repeatLastSession` writes another
session with the same exercises. Both adjust `state.sessionCount` and re-render.

**Handstand practice (handstand mode).** A parallel program, not a phase progression: the user
picks ONE block (A–E) to train today via chips, ticks the exercises they did, and completes to log a
`handstand_sessions` row. It deliberately reuses the muscle-up machinery rather than extending it —
its own `render*` functions (`renderHandstand` and the `renderHandstand*` helpers), its own offline
queue, and its own realtime channel — because the data model differs (block vs. phase, one checkbox
per exercise vs. per set). In the mode/tab router (above) handstand mode spreads across three
sections: `page-handstand` is the today/picker (`renderHandstand` = progress + blocks + exercises),
`page-handstand-standings` is the Rangliste tab, and `page-handstand-plan` is the read-only program
overview (`renderHandstandPlan`, mirrors `renderPlanReference`). Specifics:
- **Completion rule differs**: `updateHandstandButton` enables Complete once **≥1** exercise is
  checked (`state.checkedHandstand.size`), since a block is a pick-what-you-did menu — unlike
  `updateCompleteButton`, which requires every exercise covered.
- **Offline-first** mirrors `completeSession`: queue key `mu_pending_handstand`, flushed by
  `retryPendingHandstand()` (invoked alongside `retryPendingSessions` on load and the `online` event).
- **State**: `handstandCount` (loaded once in `loadMainScreen`, optimistically `++`'d on complete),
  `handstandBlock` (persisted to `mu_handstand_block_<userId>` for an instant default),
  `checkedHandstand` (Set), `lastHandstandSession` (Undo target; no Repeat).
- **Shared standings** (`renderHandstandStandings`) aggregate total completed sessions per user from
  `getAllHandstandSessions` — separate from the phase-based Rangliste, rendered on the handstand
  mode's Rangliste tab (`page-handstand-standings`).
- `handleSignedOut` resets the handstand state (and `state.mode` back to `'muscleup'`) so the next
  user never sees the prior count or mode.

**Settings page (`renderSettings`).** Three independent tools, all on `page-settings`:
- **Display name** (`onNameSubmit`) writes only `profiles.username` via `upsertProfile`. **Gotcha:**
  this does *not* change login — the synthetic email/slug is fixed at signup, so you always log in
  with the *original* name even after renaming. The unique-violation (`23505`) path reports
  "name taken".
- **Password** (`onPasswordSubmit`) calls `Auth.updatePassword` — the active session authorizes it,
  so no current password is required.
- **Progress reset** — `onRewind` rewinds to a chosen Phase/Week: keeps the oldest `(week-1)*2`
  sessions of the target phase (2 sessions = 1 week), deletes the rest *and every later phase's*
  sessions, then moves the `current_phase` pointer back. `onClearPhase` deletes just one phase's
  sessions. Both also prune the offline queue and the per-phase `…_transition_dismissed_…` flags
  (`pruneLocalAfterReset`) so banners re-evaluate cleanly.

**Naming drift — do not "fix".** The app is branded "Schla-Muscle-App" in the UI, but internal
identifiers were intentionally left unchanged: localStorage keys are `mu_*`, the synthetic email
domain is `@muscleup.local`, and Supabase table/column names are unchanged. Renaming any of these is
a data migration, not a cosmetic edit.

UI language is German.

## Reference documents

- [muscle-up-trainingsplan.md](muscle-up-trainingsplan.md) — the German source training plan that
  `js/data.js` encodes. If the plan content changes, both must be updated together.
- [docs/superpowers/](docs/superpowers/) — the original design spec and implementation plan
  (2026-04-17). Historical context; the sections above reflect the current state where they differ.
