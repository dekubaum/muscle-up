// js/db.js
window.DB = (() => {
  const SUPABASE_URL = 'https://bfwianyhjntvfklqczkd.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmd2lhbnloam50dmZrbHFjemtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NTQxNzQsImV4cCI6MjA5MjAzMDE3NH0.pWh1165Oz62cHma_e0Fly17j5BPAYcJTSnC7Q_Lj_xk';

  if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    throw new Error('js/db.js: Replace SUPABASE_URL and SUPABASE_ANON_KEY before running.');
  }

  // persistSession keeps the user logged in across reloads (stored in localStorage,
  // readable offline); autoRefreshToken keeps the JWT fresh. Explicit even though
  // these are the SDK defaults — guards against a future vendored-bundle swap.
  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  async function getProfile(userId) {
    return client
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
  }

  async function upsertProfile(userId, phase, username) {
    const row = { user_id: userId, current_phase: phase };
    if (username) row.username = username;
    return client
      .from('profiles')
      .upsert(row, { onConflict: 'user_id' });
  }

  async function getSessionCount(userId, phase) {
    return client
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('phase', phase);
  }

  async function saveSession(userId, phase, exercises, sessionDate) {
    return client
      .from('sessions')
      .insert({
        user_id: userId,
        phase,
        session_date: sessionDate || new Date().toISOString().split('T')[0],
        exercises,
      })
      .select('id')
      .single();
  }

  async function deleteSession(id) {
    return client
      .from('sessions')
      .delete()
      .eq('id', id);
  }

  // Leaderboard reads — tiny data, so fetch all and aggregate client-side.
  async function getAllProfiles() {
    return client
      .from('profiles')
      .select('user_id, username, current_phase');
  }

  async function getAllSessions() {
    return client
      .from('sessions')
      .select('user_id, phase');
  }

  return { client, getProfile, upsertProfile, getSessionCount, saveSession, deleteSession, getAllProfiles, getAllSessions };
})();
