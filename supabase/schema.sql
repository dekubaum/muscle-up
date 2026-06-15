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
  current_phase int NOT NULL DEFAULT 1 CHECK (current_phase BETWEEN 1 AND 3),
  -- Admins may broadcast announcements (see announcements table). Set manually:
  --   UPDATE profiles SET is_admin = true WHERE username = '<name>';
  is_admin      boolean NOT NULL DEFAULT false
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

-- ── Handstand practice ──────────────────────────────────────────────────────
-- Parallel to sessions, but keyed by `block` (app-defined content, so NO CHECK
-- constraint — adding a block must not require a schema migration).
CREATE TABLE IF NOT EXISTS handstand_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  block         text NOT NULL,
  session_date  date NOT NULL,
  exercises     jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz DEFAULT now()
);

ALTER TABLE handstand_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hs_select_all_auth" ON handstand_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "hs_insert_own" ON handstand_sessions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "hs_update_own" ON handstand_sessions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "hs_delete_own" ON handstand_sessions
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Real-time so the shared handstand standings update live.
ALTER PUBLICATION supabase_realtime ADD TABLE handstand_sessions;

-- ── Announcements ───────────────────────────────────────────────────────────
-- Admin broadcasts one message to everyone. Anyone may READ (so the banner can
-- show it), but only an admin may INSERT (enforced via the profiles.is_admin
-- flag — not key secrecy). Read state is per-user (announcement_reads below).
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

ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcement_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "announcements_select_all_auth" ON announcements
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "announcements_insert_admin" ON announcements
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = author_id
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );
CREATE POLICY "announcements_delete_admin" ON announcements
  FOR DELETE TO authenticated USING (
    auth.uid() = author_id
    AND EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );

-- Read receipts are private: each user sees and writes only their own.
CREATE POLICY "announcement_reads_select_own" ON announcement_reads
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "announcement_reads_insert_own" ON announcement_reads
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Real-time so a sent announcement pushes a live banner to open clients.
ALTER PUBLICATION supabase_realtime ADD TABLE announcements;

-- ── Feedback ────────────────────────────────────────────────────────────────
-- Anonymous feedback: any logged-in user may submit, but the row carries NO
-- user_id (and the app never sends one), so even an admin cannot tell who wrote
-- it. Only admins may READ/UPDATE/DELETE (the inbox + triage workflow); a
-- non-admin's SELECT returns nothing. `context` is jsonb (screen, mode, phase,
-- block, app_version, user_agent) so adding a field stays a code change, not a
-- migration. No realtime — the admin inbox loads on demand, not as a live feed.
CREATE TABLE IF NOT EXISTS feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type        text NOT NULL CHECK (type IN ('bug','idea','praise','other')),
  message     text NOT NULL,
  context     jsonb NOT NULL DEFAULT '{}',
  status      text NOT NULL DEFAULT 'new' CHECK (status IN ('new','planned','done','dismissed')),
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated may submit, but only as 'new' (no self-triaging). There
-- is no auth.uid() = user_id check because there is no user_id — that is the
-- anonymity guarantee.
CREATE POLICY "feedback_insert_any_auth" ON feedback
  FOR INSERT TO authenticated WITH CHECK (status = 'new');

-- Read / triage / delete are admin-only (gated by profiles.is_admin).
CREATE POLICY "feedback_select_admin" ON feedback
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );
CREATE POLICY "feedback_update_admin" ON feedback
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );
CREATE POLICY "feedback_delete_admin" ON feedback
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles p WHERE p.user_id = auth.uid() AND p.is_admin)
  );
