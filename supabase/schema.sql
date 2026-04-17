-- Run this once in the Supabase SQL editor

CREATE TABLE IF NOT EXISTS sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_name     text NOT NULL CHECK (user_name IN ('dennis', 'clemens')),
  phase         int NOT NULL CHECK (phase BETWEEN 1 AND 3),
  session_date  date NOT NULL,
  exercises     jsonb NOT NULL DEFAULT '[]',
  created_at    timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
  user_name     text PRIMARY KEY CHECK (user_name IN ('dennis', 'clemens')),
  current_phase int NOT NULL DEFAULT 1 CHECK (current_phase BETWEEN 1 AND 3)
);

-- Enable Row Level Security (allow all for now — anon key is fine for personal use)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_sessions" ON sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_profiles" ON profiles FOR ALL USING (true) WITH CHECK (true);

-- Enable real-time on sessions
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;
