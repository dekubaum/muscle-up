# Muscle Up Trainingsplan App — Design Spec

**Date:** 2026-04-17
**Users:** Dennis & Clemens

---

## Overview

A mobile-friendly web app for two users to follow their Muscle Up training plan, track workout progress, and see each other's activity in real-time. No build step, no framework — just HTML/CSS/JS served as a static file.

---

## Platform & Stack

| Concern | Decision |
| --- | --- |
| Frontend | Vanilla HTML/CSS/JS — no framework, no build step |
| Backend/DB | Supabase (Postgres + real-time subscriptions) |
| Persistence | Supabase as shared store; `localStorage` as local fallback |
| Hosting | Static file — GitHub Pages, Netlify, or opened locally |

---

## Users

Two hardcoded profiles: **Dennis** and **Clemens**.

- On first visit, a profile selection screen shows two large buttons
- Choice is stored in `localStorage` and skipped on subsequent visits
- No authentication required

---

## Data Model

Two Supabase tables:

```sql
CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name     text NOT NULL,         -- 'dennis' | 'clemens'
  phase         int NOT NULL,          -- 1, 2, or 3
  session_date  date NOT NULL,
  exercises     jsonb NOT NULL,        -- array of checked exercise IDs
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE profiles (
  user_name     text PRIMARY KEY,      -- 'dennis' | 'clemens'
  current_phase int NOT NULL DEFAULT 1
);
```

The `profiles` table is seeded with one row per user on first app load if not present. Phase advances are written here.

Example `exercises` value:

```json
["explosive-pullups-1", "explosive-pullups-2", "chest-to-bar-1", "dips-1"]
```

Each exercise ID encodes the exercise slug and set number (e.g. `explosive-pullups-2` = second set of Explosive Pull-Ups).

---

## Screens

### 1. Profile Selection

Shown once on first visit. Two large buttons: "Dennis" / "Clemens". Selection saved to `localStorage`. Not shown again unless localStorage is cleared.

### 2. Main Screen (single page, stacked layout)

#### Phase Banner

- Shows current phase (1/2/3), current week, and session count (e.g. "Phase 1 · Woche 2 · Session 3/6")
- Progress bar showing sessions completed in current phase

#### Today's Workout

- Lists all exercises for the current phase
- Each exercise row has one checkbox per set (e.g. 4 checkboxes for "Explosive Pull-Ups · 4×5")
- "Session abschließen" button becomes active once **all exercises** each have at least one set checked
- Tapping the button saves the session to Supabase and `localStorage`

#### Partner Card

- Shows the other user's most recent session: phase, exercises completed, time elapsed (e.g. "Clemens · Phase 1 · 4/5 Übungen · vor 2h")
- Updates in real-time via Supabase real-time subscription
- Displays "Offline" gracefully if the subscription drops

#### Plan Reference

- Full training plan (all three phases) rendered below the partner card
- Always accessible by scrolling — no navigation required

---

## Phase Progression

**Phase 1 → 2:** After 6 completed sessions in Phase 1, a dismissible banner appears: "Bereit für Phase 2?" with a "Jetzt wechseln" confirm button.

**Phase 2 → 3:** After 6 completed sessions in Phase 2, the same banner appears but includes the "Bereit für Phase 3?" checklist from the training document:

- [ ] 3 saubere Chest-to-Bar Pull-Ups ohne Band
- [ ] 1–2 Negative Muscle Ups mit Kontrolle (mind. 3 Sek. Absenkzeit)
- [ ] Explosive Pull-Ups erreichen konstant Kinnhöhe über der Stange

The user must tick all 3 criteria before the "Jetzt wechseln" button activates.

Phase is stored per-user in `profiles.current_phase` in Supabase, mirrored to `localStorage` for offline access.

---

## Real-Time Sync

- Supabase real-time subscription watches the `sessions` table filtered to the partner's `user_name`
- Any new session the partner logs appears in the partner card within seconds
- On connection loss: partner card shows "Offline", local functionality continues unaffected
- On reconnect: subscription resumes automatically

---

## Offline Behavior

- Session data written to `localStorage` first, then to Supabase
- If Supabase write fails (offline), data stays in `localStorage` and is retried on next app open
- No data loss: `localStorage` is the authoritative local store

---

## Testing

Manual testing only — this is a two-person personal tool. Key scenarios:

1. Profile selection on first visit, skipped on return
2. Checking off exercise sets, completing a session
3. Session appears in partner card (open two browser tabs, one per profile)
4. Phase progression banner appears after session 6
5. Phase 2→3 checklist gate blocks advancement until all criteria are ticked
6. Offline: app works locally, partner card shows "Offline"

---

## Out of Scope

- Push notifications
- Session history / log view
- Weight or rep number logging (simple completion only)
- More than two users
