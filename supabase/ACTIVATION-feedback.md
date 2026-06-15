# Feedback feature — activation checklist

The code is committed. Two manual steps make it live: running the database migration, and (only
if you want the AI triage workflow) creating a local credentials file. Until the migration runs,
the app already degrades gracefully — submitted feedback queues in `localStorage`
(`mu_pending_feedback`) and the admin inbox stays empty; nothing is lost, and it flushes
automatically once the table exists.

You must already be an **admin** to see the inbox (the announcements feature's one-time grant:
`UPDATE profiles SET is_admin = true WHERE username = '<name>';`). The same flag gates the feedback
inbox — no second grant needed.

Work top to bottom.

## 1. Run the migration

1. Open the Supabase dashboard → **SQL Editor**.
2. Paste the full contents of [`migration-feedback.sql`](migration-feedback.sql) and run it.
3. It's idempotent — run it again; it should succeed with no errors (proves re-run safety).

## 2. Verify the database (optional but quick)

```sql
-- Expect 4 rows: feedback_insert_any_auth, feedback_select_admin,
--                feedback_update_admin, feedback_delete_admin
SELECT policyname FROM pg_policies WHERE tablename = 'feedback';

-- Expect 0 rows (realtime is intentionally OFF for feedback)
SELECT 1 FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND tablename = 'feedback';

-- Expect NO 'user_id' column (the anonymity guarantee)
SELECT column_name FROM information_schema.columns WHERE table_name = 'feedback';
```

No dashboard auth change is needed — the "Confirm email" setting from the original auth migration
already applies app-wide.

## 3. Smoke-test in the app

Serve over HTTP (never `file://`) and log in:

```
python3 -m http.server 8000   # then open http://localhost:8000
```

- [ ] Open the menu on any tab/mode → **Feedback geben** opens the modal over the current screen.
- [ ] Pick a type (Bug / Idee / Lob / Sonstiges); the selection highlights. Empty message → Senden
      stays disabled / shows a hint.
- [ ] Submit → modal closes with a confirmation; the form notes the feedback is anonymous.
      Confirm a new row in `feedback` (Table Editor or `SELECT * FROM feedback;`) with the right
      `type`, `message`, populated `context` (screen, mode, phase/block, app_version, user_agent),
      `status = 'new'`, and **no user_id**.
- [ ] Offline test (DevTools → Network → Offline): submit → check `localStorage['mu_pending_feedback']`
      holds one record → go back online → the queue empties and the row appears in the DB.
- [ ] As an **admin**, open Settings → the **Feedback** section lists the items with type/status
      badges and the captured context. As a **non-admin**, the section is absent and `getFeedback`
      returns nothing.
- [ ] Mark an item **Geplant / Erledigt / Verworfen** → the status badge updates and persists on
      reload. **Löschen** removes it.

## 4. (Optional) Enable the AI triage workflow

The triage workflow lets an AI agent (run locally, e.g. Claude Code) read the feedback DB and
produce a ranked plan you review. It signs in **as you** (your admin login) and reads through the
admin-only RLS policy — no service-role key.

1. Copy the example and fill in your admin login:

   ```
   cp supabase/.env.local.example supabase/.env.local
   ```

   Set `SUPABASE_ADMIN_EMAIL` to your synthetic address — it's `<slug>@muscleup.local`, where
   `<slug>` is your username lowercased with non-alphanumerics turned to `_` (see `js/auth.js`
   `slug()`). Set `SUPABASE_ADMIN_PASSWORD` to your password. `supabase/.env.local` is gitignored.

2. Fetch the open feedback:

   ```
   ./scripts/fetch-feedback.sh
   ```

   It writes `docs/feedback/inbox.json` (gitignored) containing only `status = 'new'` rows.

3. Hand it to your agent with [`docs/feedback/ANALYSIS.md`](../docs/feedback/ANALYSIS.md) — the
   runbook that turns `inbox.json` into a dated triage doc you choose from. After you ship an item,
   mark it `done`/`dismissed` in-app so the next fetch skips it.

Done — feature is live.
