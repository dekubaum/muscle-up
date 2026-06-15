-- ============================================================================
-- Migration: add the Announcements feature
-- ============================================================================
-- Adds an `is_admin` flag to profiles plus two new tables (`announcements`,
-- `announcement_reads`). Idempotent and safe to run on the live project that
-- already has data — it touches nothing existing. Run this once in the Supabase
-- SQL editor; re-running is a no-op.
--
-- No manual dashboard step is required (the "Confirm email" change from the auth
-- migration already applies app-wide). Realtime is enabled below in SQL.
--
-- Until this runs, announcements simply don't appear; the app degrades quietly
-- (no banner, empty messages list, no compose form).
-- ============================================================================

-- 1. Admin flag on profiles. Defaults false; you grant it manually (STEP 5).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- 2. Tables.
CREATE TABLE IF NOT EXISTS announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title       text NOT NULL,
  body        text NOT NULL,
  created_at  timestamptz DEFAULT now()
);

-- One row per (announcement, user) the user has read. Absence = unread.
CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id uuid NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at         timestamptz DEFAULT now(),
  PRIMARY KEY (announcement_id, user_id)
);

-- 3. RLS. Everyone READs announcements (so the banner can show them); only an
--    admin (profiles.is_admin) may INSERT/DELETE. Read receipts are private.
--    DROP-then-CREATE makes policy creation idempotent (no IF NOT EXISTS).
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcements_select_all_auth" ON announcements;
CREATE POLICY "announcements_select_all_auth" ON announcements
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "announcements_insert_admin" ON announcements;
CREATE POLICY "announcements_insert_admin" ON announcements
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );

DROP POLICY IF EXISTS "announcements_delete_admin" ON announcements;
CREATE POLICY "announcements_delete_admin" ON announcements
  FOR DELETE TO authenticated USING (
    auth.uid() = author_id
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );

DROP POLICY IF EXISTS "announcement_reads_select_own" ON announcement_reads;
CREATE POLICY "announcement_reads_select_own" ON announcement_reads
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "announcement_reads_insert_own" ON announcement_reads;
CREATE POLICY "announcement_reads_insert_own" ON announcement_reads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- 4. Realtime. Guarded — ALTER PUBLICATION … ADD TABLE errors if the table is
--    already a member, so only add it when it isn't.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'announcements'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE announcements;
  END IF;
END $$;

-- 5. Grant yourself admin (one-time, do this manually — replace <name>):
-- UPDATE profiles SET is_admin = true WHERE username = '<name>';

-- Verify (optional):
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'profiles' AND column_name = 'is_admin';                  -- 1 row
-- SELECT policyname FROM pg_policies WHERE tablename = 'announcements';          -- 3 rows
-- SELECT policyname FROM pg_policies WHERE tablename = 'announcement_reads';     -- 2 rows
-- SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'announcements';
