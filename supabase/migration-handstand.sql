-- ============================================================================
-- Migration: add the Handstand practice feature
-- ============================================================================
-- Adds a `handstand_sessions` table parallel to `sessions`. Idempotent and safe
-- to run on the live (dennis/clemens) project that already has data — it touches
-- nothing existing. Run this once in the Supabase SQL editor; re-running is a
-- no-op.
--
-- No manual dashboard step is required (the "Confirm email" change from the auth
-- migration already applies app-wide). Realtime is enabled below in SQL.
-- ============================================================================

-- 1. Table. `block` is app-defined content (a-warmup … e-skill); intentionally
--    NO CHECK constraint, so adding a block later stays a code change, not a
--    schema migration.
CREATE TABLE IF NOT EXISTS handstand_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block         text NOT NULL,
  session_date  date NOT NULL,
  exercises     jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz DEFAULT now()
);

-- 2. RLS — mirror sessions: any logged-in user may READ all rows (shared
--    standings), but may only WRITE their own. DROP-then-CREATE makes the policy
--    creation idempotent (CREATE POLICY has no IF NOT EXISTS).
ALTER TABLE handstand_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "hs_select_all_auth" ON handstand_sessions;
CREATE POLICY "hs_select_all_auth" ON handstand_sessions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "hs_insert_own" ON handstand_sessions;
CREATE POLICY "hs_insert_own" ON handstand_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "hs_update_own" ON handstand_sessions;
CREATE POLICY "hs_update_own" ON handstand_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "hs_delete_own" ON handstand_sessions;
CREATE POLICY "hs_delete_own" ON handstand_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- 3. Realtime. Guarded — ALTER PUBLICATION … ADD TABLE errors if the table is
--    already a member, so only add it when it isn't.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'handstand_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE handstand_sessions;
  END IF;
END $$;

-- Verify (optional):
-- SELECT policyname FROM pg_policies WHERE tablename = 'handstand_sessions';        -- 4 rows
-- SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'handstand_sessions';
