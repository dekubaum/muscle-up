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

The announcement feature adds an `is_admin` column to `profiles` plus `announcements` and
`announcement_reads` tables: they ship in `schema.sql` for fresh projects, and an existing project
gets them by running the idempotent
[supabase/migration-announcements.sql](supabase/migration-announcements.sql) once (safe to re-run;
until it runs, the banner/compose UI stay empty and reads queue offline). **One-time manual step:**
grant yourself admin so the in-app compose form appears —
`UPDATE profiles SET is_admin = true WHERE username = '<name>';`. Only admins can INSERT
announcements (RLS-enforced).

The feedback feature adds one table, `feedback` (anonymous user feedback → admin-only inbox). It
ships in `schema.sql` for fresh projects, and an existing project gets it by running the idempotent
[supabase/migration-feedback.sql](supabase/migration-feedback.sql) once (safe to re-run; until it
runs, submissions queue offline and the inbox stays empty). It reuses the existing admin grant — no
new manual step. The same admin flag gates the in-app inbox.
[supabase/ACTIVATION-feedback.md](supabase/ACTIVATION-feedback.md) is the full checklist, and also
covers the **on-demand AI triage workflow**: `scripts/fetch-feedback.sh` signs in as the admin
(creds in a gitignored `supabase/.env.local`, copied from `.env.local.example`) and reads the table
through admin RLS into `docs/feedback/inbox.json`; [docs/feedback/ANALYSIS.md](docs/feedback/ANALYSIS.md)
is the runbook that turns it into a dated `triage-*.md` to choose from. After shipping an item, mark
it `done`/`dismissed` in-app so the next fetch skips it.

**Required manual dashboard step:** in Supabase → Authentication, **disable "Confirm email"**.
Usernames have no real email — the app maps a username to a synthetic `<slug>@muscleup.local`
address (see [js/auth.js](js/auth.js)), which can never be confirmed. With confirmations on,
`signUp` returns no session and login is permanently broken. (Consequence: password reset is not
supported — admin/manual only.)

Six tables, all keyed by the Auth user id (`auth.users.id`) **except `feedback`, which deliberately
has no `user_id`** (anonymity); Realtime is enabled on `sessions`, `handstand_sessions`, and
`announcements` (**not** `feedback`):
- `sessions` — one row per completed muscle-up workout (`user_id`, `phase`, `session_date`,
  `exercises` jsonb)
- `handstand_sessions` — one row per completed handstand block (`user_id`, `block`, `session_date`,
  `exercises` jsonb). Parallel to `sessions` but keyed by `block` text, not a phase number.
- `profiles` — one row per user (`user_id` PK, unique `username`, `current_phase`, `is_admin`)
- `announcements` — one row per broadcast message (`author_id`, `title`, `body`, `created_at`)
- `announcement_reads` — per-user read receipt (`announcement_id` + `user_id` composite PK,
  `read_at`); absence of a row means unread
- `feedback` — one row per anonymous submission (`type` CHECK bug/idea/praise/other, `message`,
  `context` jsonb, `status` CHECK new/planned/done/dismissed, `created_at`). **No `user_id`** — that
  is the anonymity guarantee; `context` is jsonb (screen, mode, phase, block, app_version,
  user_agent) so adding a field stays a code change.

RLS: any logged-in user can **read all** rows (for the leaderboard/standings) but **write only their
own** (`auth.uid() = user_id`). Exceptions: `announcements` is **read-all but INSERT/DELETE
admin-only** (gated by `profiles.is_admin`, not key secrecy), `announcement_reads` is **private**
(each user reads/writes only their own receipts), and `feedback` is **INSERT-any (as `new`) but
SELECT/UPDATE/DELETE admin-only** — there is no "select own" path, so a submitter can't read their
feedback back (reinforcing anonymity).
`phase`/`current_phase` keep `CHECK (… BETWEEN 1 AND 3)`, so changing the number of phases still
requires a schema migration. `handstand_sessions.block` has **no CHECK** by design — block ids are
app-defined content, so adding a block stays a code change, not a migration. `feedback.type`/`status`
**do** keep CHECKs (stable enums; the triage fetch filters on `status='new'`), so adding a value
there is a small migration. Usernames are unbounded
(no CHECK); uniqueness is enforced by the synthetic-email uniqueness plus a `UNIQUE(username)`
constraint.

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
- **[js/sync.js](js/sync.js)** —
  `subscribeToSessions`/`subscribeToHandstand`/`subscribeToAnnouncements`/`unsubscribe`: subscribes to
  **all** INSERTs on `sessions` (live leaderboard), `handstand_sessions` (live standings), and
  `announcements` (live banner) via Realtime. Must be called only after a session exists (the SDK
  applies the JWT to the realtime socket asynchronously). Three separate channels; each `subscribe*`
  clears only its own, and `unsubscribe` tears **all** down on logout and before each re-subscribe.
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
`mu_handstand_block_<userId>` (last-picked handstand block), `mu_pending_reads` (offline queue of
announcement read receipts `[{ announcement_id, user_id }]`; global, like `mu_pending_sessions`), and
`mu_pending_feedback` (offline queue of anonymous feedback `[{ id, type, message, context }]`; global,
**no `user_id`** — feedback is anonymous).

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

**Announcements (admin broadcast → banner → archive).** An admin sends one message to everyone; on
next open each user sees `#announcement-banner` (placed inside `<main>` *above* the `.page` sections,
so it surfaces on every tab and both modes — unlike the phase banner, which lives in `page-today`).
The banner is collapsed by default and **expands inline** (`announceExpanded`, UI-only) to show each
unread message with a **Gelesen** button; once all are read it hides. All messages (read + unread)
live in **Settings → Nachrichten** (`renderMessagesList`). Like handstand, it reuses the existing
machinery rather than extending it — its own `render*` (`renderAnnouncementBanner`,
`renderMessagesList`), its own offline queue, and its own realtime channel. Specifics:
- **Admin-gated compose**: `state.isAdmin` (from `profiles.is_admin`) toggles the `#announce-compose`
  form in Settings; `onSendAnnouncement` calls `DB.createAnnouncement`, optimistically prepends the
  row, and marks it read for the author so they never see their own banner. RLS also enforces
  admin-only INSERT, so the username check is UI convenience, not the security boundary.
- **Offline-first** mirrors `completeSession`: marking read queues `{ announcement_id, user_id }` in
  `mu_pending_reads`, flushed by `retryPendingReads()` (alongside the other retries on load and the
  `online` event). A duplicate insert (`23505`) is treated as success.
- **State**: `isAdmin`, `announcements` (all, newest first), `readIds` (Set of read ids); loaded in
  `loadMainScreen` via `loadAnnouncements` (fetches `getAnnouncements` + `getMyReads`, folds in
  queued offline receipts). `handleSignedOut` resets all three.
- **Realtime** (`onNewAnnouncement`) prepends a live INSERT (dedup by id) and re-renders.

**Feedback (anonymous submit → admin-only inbox → AI triage).** Any user opens a **modal** (the
`Feedback geben` menu item, bound in `initNav`; `openFeedbackModal`/`closeFeedbackModal`) reachable
from any tab/mode, picks a type (Bug/Idee/Lob/Sonstiges → `feedbackType`), writes a message, and
sends. The submit is **deliberately anonymous**: `onSubmitFeedback` builds a `context` object
(`state.tab`, `state.mode`, `state.currentPhase`, `state.handstandBlock`, `APP_VERSION`,
`navigator.userAgent`) but **never a user_id**. Like the others, it reuses existing machinery rather
than extending it — its own `render*`, its own offline queue, **no realtime**. Specifics:
- **Offline-first** mirrors `completeSession`: queue key `mu_pending_feedback`, flushed by
  `retryPendingFeedback()` (alongside the other retries on load and the `online` event). The modal
  shows a "Danke" then closes regardless of online/offline (the queue handles delivery).
- **Admin inbox** lives in **Settings → Feedback** (`#feedback-inbox`, gated by `state.isAdmin` like
  `#announce-compose`). `renderSettings` lazily calls `loadFeedback().then(renderFeedbackInbox)` on
  each visit (fresh data, no realtime). `renderFeedbackInbox` shows type/status badges + the context
  summary; status buttons call `updateFeedbackStatus`, delete calls `deleteFeedback` (both optimistic,
  reverting via `loadFeedback` on error).
- **State**: `isAdmin` (reused), `feedback` (all rows, newest first; empty for non-admins, since RLS
  SELECT is admin-only). `handleSignedOut` resets `feedback`.
- **AI triage** is an external on-demand dev workflow, not in-app — see `scripts/fetch-feedback.sh`,
  `supabase/.env.local`, and `docs/feedback/ANALYSIS.md` (documented under Backend setup).
- `APP_VERSION` (top of `app.js`) is a hand-bumped release marker captured into `context`.

**Settings page (`renderSettings`).** Independent tools, all on `page-settings`:
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
