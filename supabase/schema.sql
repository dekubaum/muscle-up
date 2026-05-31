-- Run this once in the Supabase SQL editor for a FRESH project.
-- (For an existing dennis/clemens project with data to preserve, use migration-auth.sql instead.)
--
-- Identity is the Supabase Auth user id (auth.users.id). Usernames have no real
-- email: the app maps a username to a synthetic <slug>@muscleup.local address.
--
-- IMPORTANT manual step (cannot be done in SQL):
--   Supabase Dashboard → Authentication → disable "Confirm email".
--   Synthetic @muscleup.local addresses can never be confirmed; with confirmations
--   ON, signUp returns no session and login is permanently broken.

CREATE TABLE IF NOT EXISTS profiles (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      text UNIQUE NOT NULL,
  current_phase int NOT NULL DEFAULT 1 CHECK (current_phase BETWEEN 1 AND 3)
);

CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  phase         int NOT NULL CHECK (phase BETWEEN 1 AND 3),
  session_date  date NOT NULL,
  exercises     jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz DEFAULT now()
);

-- Row Level Security: any logged-in user may READ everyone (leaderboard),
-- but may only WRITE their own rows.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

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

-- Enable real-time on sessions (the live leaderboard listens to INSERTs).
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
