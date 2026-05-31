-- ============================================================================
-- Migration: hardcoded dennis/clemens  ->  real Supabase Auth accounts
-- ============================================================================
-- Moves identity from the text column `user_name` to the Auth user id
-- (auth.users.id), preserving the existing sessions and current phases.
--
-- Auth accounts are created by the APP (signUp), so user_id cannot be backfilled
-- until those accounts exist. Run this in three ordered phases, using the app in
-- between. Run each STEP block in the Supabase SQL editor.
--
-- MANUAL DASHBOARD STEP (do this first, cannot be done in SQL):
--   Authentication → Providers/Settings → disable "Confirm email".
--   Synthetic @muscleup.local addresses can never be confirmed; with it ON,
--   signUp returns no session and login is permanently broken.
--
-- TIP: flush any unsynced sessions on the OLD app (just go online once) before
--      cutover, so nothing is stranded in localStorage with the old user_name.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- STEP 1 — additive schema. Run BEFORE using the new app. This is the cutover
--          point: the old anon app stops working once the policies below change.
-- ----------------------------------------------------------------------------

-- 1a. Add nullable user_id to both tables (nullable so existing rows survive).
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- 1b. Add username to profiles (display + leaderboard source of truth).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username text;

-- 1c. Drop the hardcoded ('dennis','clemens') CHECK constraints (auto-generated
--     names) on both tables. The `phase BETWEEN 1 AND 3` checks are left intact.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname, conrelid::regclass AS tbl
    FROM pg_constraint
    WHERE contype = 'c'
      AND conrelid IN ('sessions'::regclass, 'profiles'::regclass)
      AND pg_get_constraintdef(oid) ILIKE '%user_name%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;
END $$;

-- 1d. Relax legacy user_name so the new app (which writes user_id) can insert,
--     and free profiles' primary key so user_id can become the key later.
ALTER TABLE sessions ALTER COLUMN user_name DROP NOT NULL;
ALTER TABLE profiles DROP CONSTRAINT profiles_pkey;
ALTER TABLE profiles ALTER COLUMN user_name DROP NOT NULL;
ALTER TABLE profiles ADD CONSTRAINT profiles_username_unique UNIQUE (username);

-- 1e. Replace the allow-all policies with auth-scoped policies.
DROP POLICY IF EXISTS "allow_all_sessions" ON sessions;
DROP POLICY IF EXISTS "allow_all_profiles" ON profiles;

CREATE POLICY "profiles_select_all_auth" ON profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert_own" ON profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_update_own" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_delete_own" ON profiles
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "sessions_select_all_auth" ON sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessions_insert_own" ON sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_update_own" ON sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "sessions_delete_own" ON sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- STEP 2 — register the two real users IN THE APP (not here).
--   Open the new app and sign up `dennis` and `clemens` with their passwords.
--   The app inserts a profiles row for each (user_id, username, current_phase=1).
--   Then capture the new account ids:
-- ----------------------------------------------------------------------------
-- SELECT id, email, raw_user_meta_data->>'username' AS username
-- FROM auth.users ORDER BY created_at;


-- ----------------------------------------------------------------------------
-- STEP 3 — backfill + lock down. Run AFTER both accounts exist.
-- ----------------------------------------------------------------------------

-- 3a. Point legacy sessions at the new account ids (matched via synthetic email).
UPDATE sessions s
SET user_id = u.id
FROM auth.users u
WHERE u.email = s.user_name || '@muscleup.local'
  AND s.user_id IS NULL;

-- 3b. Copy each preserved current_phase from the legacy profile row onto the
--     new auth-keyed profile row (which the app created with current_phase=1).
UPDATE profiles p_new
SET current_phase = p_old.current_phase
FROM profiles p_old, auth.users u
WHERE p_old.user_id IS NULL                       -- p_old = legacy row
  AND u.email = p_old.user_name || '@muscleup.local'
  AND p_new.user_id = u.id;                        -- p_new = new auth-keyed row

-- 3c. Remove the legacy (user_id IS NULL) profile rows.
DELETE FROM profiles WHERE user_id IS NULL;

-- 3d. SAFETY CHECK — this must return 0 before the NOT NULL locks below.
--     If it is not 0, some legacy sessions had a user_name with no matching
--     account; create/rename that account, re-run 3a, and re-check.
-- SELECT count(*) AS orphans FROM sessions WHERE user_id IS NULL;

-- 3e. Lock down: user_id becomes the real identity.
ALTER TABLE sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE profiles ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (user_id);

-- 3f. Drop the now-unused legacy columns.
ALTER TABLE sessions DROP COLUMN user_name;
ALTER TABLE profiles DROP COLUMN user_name;

-- Realtime: the existing `ALTER PUBLICATION supabase_realtime ADD TABLE sessions`
-- persists across these ALTERs; no need to re-run. Verify if unsure:
-- SELECT * FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
