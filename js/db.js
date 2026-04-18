// js/db.js
window.DB = (() => {
  const SUPABASE_URL = 'https://bfwianyhjntvfklqczkd.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmd2lhbnloam50dmZrbHFjemtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NTQxNzQsImV4cCI6MjA5MjAzMDE3NH0.pWh1165Oz62cHma_e0Fly17j5BPAYcJTSnC7Q_Lj_xk';

  if (SUPABASE_URL === 'YOUR_SUPABASE_URL' || SUPABASE_ANON_KEY === 'YOUR_SUPABASE_ANON_KEY') {
    throw new Error('js/db.js: Replace SUPABASE_URL and SUPABASE_ANON_KEY before running.');
  }

  const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  async function getProfile(userName) {
    return client
      .from('profiles')
      .select('*')
      .eq('user_name', userName)
      .maybeSingle();
  }

  async function upsertProfile(userName, phase) {
    return client
      .from('profiles')
      .upsert({ user_name: userName, current_phase: phase }, { onConflict: 'user_name' });
  }

  async function getSessionCount(userName, phase) {
    return client
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_name', userName)
      .eq('phase', phase);
  }

  async function saveSession(userName, phase, exercises, sessionDate) {
    return client
      .from('sessions')
      .insert({
        user_name: userName,
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

  async function getLatestPartnerSession(partnerName) {
    return client
      .from('sessions')
      .select('*')
      .eq('user_name', partnerName)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
  }

  return { client, getProfile, upsertProfile, getSessionCount, saveSession, deleteSession, getLatestPartnerSession };
})();
