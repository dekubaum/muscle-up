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

  // Reset helpers ───────────────────────────────────────────────────────────
  // Oldest-first list of a phase's sessions, so callers can keep the first N
  // (= completed weeks) and delete the rest.
  async function getSessions(userId, phase) {
    return client
      .from('sessions')
      .select('id, session_date, created_at')
      .eq('user_id', userId)
      .eq('phase', phase)
      .order('session_date', { ascending: true })
      .order('created_at', { ascending: true });
  }

  async function deleteSessionsForPhase(userId, phase) {
    return client
      .from('sessions')
      .delete()
      .eq('user_id', userId)
      .eq('phase', phase);
  }

  async function deleteSessionsByIds(ids) {
    return client
      .from('sessions')
      .delete()
      .in('id', ids);
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

  // Handstand practice ────────────────────────────────────────────────────────
  // Parallel to the muscle-up sessions, but keyed by `block` (a-warmup … e-skill)
  // instead of a phase number. Same offline-first + RLS + realtime model.
  async function saveHandstandSession(userId, block, exercises, sessionDate) {
    return client
      .from('handstand_sessions')
      .insert({
        user_id: userId,
        block,
        session_date: sessionDate || new Date().toISOString().split('T')[0],
        exercises,
      })
      .select('id')
      .single();
  }

  async function getHandstandCount(userId) {
    return client
      .from('handstand_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);
  }

  async function deleteHandstandSession(id) {
    return client
      .from('handstand_sessions')
      .delete()
      .eq('id', id);
  }

  // Standings read — tiny data, aggregate client-side (count rows per user).
  async function getAllHandstandSessions() {
    return client
      .from('handstand_sessions')
      .select('user_id, block');
  }

  // Announcements ───────────────────────────────────────────────────────────
  // Admin broadcasts a message; everyone reads it; each user records their own
  // read receipt. Same offline-first + RLS + realtime model as the rest.
  async function getAnnouncements() {
    return client
      .from('announcements')
      .select('*')
      .order('created_at', { ascending: false });
  }

  async function getMyReads(userId) {
    return client
      .from('announcement_reads')
      .select('announcement_id')
      .eq('user_id', userId);
  }

  async function markAnnouncementRead(announcementId, userId) {
    return client
      .from('announcement_reads')
      .insert({ announcement_id: announcementId, user_id: userId });
  }

  async function createAnnouncement(authorId, title, body) {
    return client
      .from('announcements')
      .insert({ author_id: authorId, title, body })
      .select('*')
      .single();
  }

  async function deleteAnnouncement(id) {
    return client
      .from('announcements')
      .delete()
      .eq('id', id);
  }

  return { client, getProfile, upsertProfile, getSessionCount, saveSession, deleteSession, getSessions, deleteSessionsForPhase, deleteSessionsByIds, getAllProfiles, getAllSessions, saveHandstandSession, getHandstandCount, deleteHandstandSession, getAllHandstandSessions, getAnnouncements, getMyReads, markAnnouncementRead, createAnnouncement, deleteAnnouncement };
})();
