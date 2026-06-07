# Handstand feature — activation checklist

The code is committed (`feat: add handstand practice program`). One manual step makes it live:
running the database migration. Until you do, the app already degrades gracefully — handstand
completions queue in `localStorage` (`mu_pending_handstand`) and the standings show "Offline";
nothing is lost, and they flush automatically once the table exists.

Work top to bottom.

## 1. Run the migration

1. Open the Supabase dashboard → **SQL Editor**.
2. Paste the full contents of [`migration-handstand.sql`](migration-handstand.sql) and run it.
3. It's idempotent — run it again; it should succeed with no errors (proves re-run safety).

## 2. Verify the database (optional but quick)

Run these in the SQL Editor:

```sql
-- Expect 4 rows: hs_select_all_auth, hs_insert_own, hs_update_own, hs_delete_own
SELECT policyname FROM pg_policies WHERE tablename = 'handstand_sessions';

-- Expect 1 row (realtime is enabled)
SELECT 1 FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'handstand_sessions';
```

No dashboard auth change is needed — the "Confirm email" setting from the original auth migration
already applies app-wide.

## 3. Smoke-test in the app

Serve over HTTP (never `file://`) and log in:

```
python3 -m http.server 8000   # then open http://localhost:8000
```

- [ ] Menu → **Handstand** opens; title reads "Handstand"; the 5 block chips render with one active.
- [ ] Switch blocks → the exercise list swaps and the selection resets.
- [ ] Tap **"Anleitung anzeigen"** on an exercise → the German how-to expands; tap again → collapses.
- [ ] Check **≥1** exercise → "Einheit abschließen" enables; uncheck all → it disables again.
- [ ] Complete → the badge count goes up, a green bar appears, and the checkboxes reset.
      Confirm a new row in `handstand_sessions` (Table Editor or `SELECT * FROM handstand_sessions;`).
- [ ] Tap **Rückgängig** → the row is deleted and the count goes back down.
- [ ] Offline test (DevTools → Network → Offline): complete an einheit → check
      `localStorage['mu_pending_handstand']` holds one record → go back online → the queue empties and
      the row appears in the DB.
- [ ] Cross-user: log in as the other user, complete a block → the **Handstand Rangliste** on the
      first account reflects both totals (live, or on next open of the page).
- [ ] Reload while logged in → the count matches the server total (no double-count).

Done — feature is live.
