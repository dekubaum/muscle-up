-- ============================================================================
-- Migration: add the Feedback feature
-- ============================================================================
-- Adds one new table, `feedback`. Idempotent and safe to run on the live
-- project that already has data — it touches nothing existing. Run this once in
-- the Supabase SQL editor; re-running is a no-op.
--
-- No new column on `profiles` is needed (the announcements migration already
-- added `is_admin`). No realtime is enabled by design — the admin inbox loads on
-- demand, not as a live feed (unlike announcements, which need a live banner).
--
-- Until this runs, feedback simply can't be saved: the submit form queues the
-- entry offline (mu_pending_feedback) and the admin inbox stays empty. The app
-- degrades quietly.
--
-- ANONYMITY: the table has NO user_id column, and the app never sends one, so
-- even an admin cannot tell who submitted a row. Do not add a user_id later
-- without revisiting that guarantee.
-- ============================================================================

-- 1. Table.
CREATE TABLE IF NOT EXISTS feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('bug','idea','praise','other')),
  message     text NOT NULL,
  context     jsonb NOT NULL DEFAULT '{}',   -- { screen, mode, phase, block, app_version, user_agent }
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','planned','done','dismissed')),
  created_at  timestamptz DEFAULT now()
);

-- 2. RLS. Anyone authenticated may INSERT (only as 'new'); read/triage/delete
--    are admin-only (gated by profiles.is_admin). There is no "select own"
--    policy — the submitter cannot read their feedback back, which reinforces
--    anonymity. DROP-then-CREATE makes policy creation idempotent.
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_insert_any_auth" ON feedback;
CREATE POLICY "feedback_insert_any_auth" ON feedback
  FOR INSERT TO authenticated WITH CHECK (status = 'new');

DROP POLICY IF EXISTS "feedback_select_admin" ON feedback;
CREATE POLICY "feedback_select_admin" ON feedback
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );

DROP POLICY IF EXISTS "feedback_update_admin" ON feedback;
CREATE POLICY "feedback_update_admin" ON feedback
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );

DROP POLICY IF EXISTS "feedback_delete_admin" ON feedback;
CREATE POLICY "feedback_delete_admin" ON feedback
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );

-- (No ALTER PUBLICATION — realtime is intentionally off for feedback.)

-- Verify (optional):
-- SELECT policyname FROM pg_policies WHERE tablename = 'feedback';   -- expect 4 rows
-- SELECT 1 FROM pg_publication_tables
--   WHERE pubname = 'supabase_realtime' AND tablename = 'feedback';  -- expect 0 rows
