// js/app.js

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  userId: null,         // auth.users.id (uuid) of the logged-in user
  username: null,       // display name (from profiles.username)
  currentPhase: 1,
  sessionCount: 0,      // sessions completed in current phase
  checkedSets: new Set(), // 'exerciseId-setIndex' strings
  isOnline: navigator.onLine,
  lastSession: null,    // { localId, supabaseId, exercises, phase }
};

// ── LocalStorage helpers ───────────────────────────────────────────────────
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}

function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Misc helpers ───────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('#screen-auth, #screen-main')
    .forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ── Auth screen ────────────────────────────────────────────────────────────
let authMode = 'login'; // 'login' | 'signup'

function initAuthScreen() {
  document.getElementById('auth-form').addEventListener('submit', onAuthSubmit);
  document.getElementById('auth-toggle').addEventListener('click', (e) => {
    e.preventDefault();
    authMode = authMode === 'login' ? 'signup' : 'login';
    renderAuthMode();
  });
  renderAuthMode();
}

function renderAuthMode() {
  const signup = authMode === 'signup';
  document.getElementById('auth-title').textContent = signup ? 'Konto erstellen' : 'Anmelden';
  document.getElementById('auth-submit').textContent = signup ? 'Registrieren' : 'Einloggen';
  document.getElementById('auth-toggle').textContent =
    signup ? 'Schon ein Konto? Einloggen' : 'Neu hier? Konto erstellen';
  setAuthError('');
}

function setAuthError(msg) {
  document.getElementById('auth-error').textContent = msg || '';
}

async function onAuthSubmit(e) {
  e.preventDefault();
  setAuthError('');
  const username = document.getElementById('auth-username').value;
  const password = document.getElementById('auth-password').value;
  const submit = document.getElementById('auth-submit');
  submit.disabled = true;

  const { error } = authMode === 'signup'
    ? await Auth.signUp(username, password)
    : await Auth.signIn(username, password);

  submit.disabled = false;
  if (error) {
    setAuthError(error);
    return;
  }
  // Success: the onChange(SIGNED_IN) handler routes to the main screen.
}

// ── Auth state routing ─────────────────────────────────────────────────────
function handleSignedOut() {
  state.userId = null;
  state.username = null;
  state.sessionCount = 0;
  state.lastSession = null;
  Sync.unsubscribe();
  showScreen('screen-auth');
  const u = document.getElementById('auth-username');
  const p = document.getElementById('auth-password');
  if (u) u.value = '';
  if (p) p.value = '';
  setAuthError('');
}

// ── Main screen loader ─────────────────────────────────────────────────────
async function loadMainScreen(userId) {
  state.userId = userId;
  showScreen('screen-main');

  // Unsubscribe any previous real-time subscription before re-subscribing
  Sync.unsubscribe();

  // Load phase from localStorage immediately (instant render), then sync
  state.currentPhase = lsGet(`mu_phase_${userId}`) || 1;

  const { data: profile } = await DB.getProfile(userId);
  if (profile) {
    state.username = profile.username;
    state.currentPhase = profile.current_phase;
    lsSet(`mu_phase_${userId}`, profile.current_phase);
  } else {
    // Defensive: profile row missing (e.g. interrupted signup). Recreate it
    // from the auth session's stored username.
    const session = await Auth.getSession();
    state.username = session?.user?.user_metadata?.username || 'Unbekannt';
    await DB.upsertProfile(userId, state.currentPhase, state.username);
  }
  renderHeader();

  const { count } = await DB.getSessionCount(userId, state.currentPhase);
  state.sessionCount = count || 0;

  renderPhaseBanner();
  renderWorkout();
  renderPlanReference();
  checkPhaseTransition();

  await renderLeaderboard();
  retryPendingSessions();

  // Subscribe only now — after the session (and its JWT) is confirmed.
  Sync.subscribeToSessions(() => renderLeaderboard());
}

// ── Header (username + logout) ─────────────────────────────────────────────
function renderHeader() {
  const el = document.getElementById('current-username');
  if (el) el.textContent = state.username || '';
}

function initLogout() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await Auth.signOut(); // onChange(SIGNED_OUT) does the teardown
  });
}

// ── Phase banner ───────────────────────────────────────────────────────────
function renderPhaseBanner() {
  const phase = PLAN.phases[state.currentPhase - 1];
  const [weeksStart, weeksEnd] = phase.weeks.split('-').map(Number);
  const phaseWeekCount = weeksEnd - weeksStart + 1;
  const week = Math.min(Math.floor(state.sessionCount / 2) + 1, phaseWeekCount);

  document.getElementById('phase-label').textContent =
    `Phase ${phase.number} · Woche ${week}`;
  document.getElementById('phase-badge').textContent =
    `${state.sessionCount}/${phase.totalSessions} Sessions`;

  const pct = Math.min((state.sessionCount / phase.totalSessions) * 100, 100);
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

// ── Workout rendering ──────────────────────────────────────────────────────
function renderWorkout() {
  hidePostSessionBar();
  const phase = PLAN.phases[state.currentPhase - 1];
  const list = document.getElementById('exercise-list');
  list.innerHTML = '';
  state.checkedSets.clear();

  phase.exercises.forEach(exercise => {
    const row = document.createElement('div');
    row.className = 'exercise-row';

    const info = document.createElement('div');
    info.className = 'exercise-info';
    info.innerHTML =
      `<div class="exercise-name">${exercise.name}</div>` +
      `<div class="exercise-detail">${exercise.sets} × ${exercise.reps} · ${exercise.focus}</div>`;

    const boxes = document.createElement('div');
    boxes.className = 'exercise-checkboxes';

    for (let i = 0; i < exercise.sets; i++) {
      const setId = `${exercise.id}-${i}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = setId;
      cb.addEventListener('change', () => {
        hidePostSessionBar();
        if (cb.checked) state.checkedSets.add(setId);
        else state.checkedSets.delete(setId);
        updateCompleteButton(phase);
      });
      boxes.appendChild(cb);
    }

    row.appendChild(info);
    row.appendChild(boxes);
    list.appendChild(row);
  });

  document.getElementById('btn-complete').disabled = true;
  document.getElementById('btn-complete').onclick = completeSession;
}

function updateCompleteButton(phase) {
  // Every exercise must have at least one set checked
  const allCovered = phase.exercises.every(ex =>
    Array.from({ length: ex.sets }, (_, i) => `${ex.id}-${i}`)
      .some(id => state.checkedSets.has(id))
  );
  document.getElementById('btn-complete').disabled = !allCovered;
}

// ── Session completion ─────────────────────────────────────────────────────
async function completeSession() {
  document.getElementById('btn-complete').disabled = true;
  const exercises = Array.from(state.checkedSets);
  const sessionRecord = {
    id: Date.now(),
    user_id: state.userId,
    phase: state.currentPhase,
    session_date: new Date().toISOString().split('T')[0],
    exercises,
  };

  // Write to localStorage first (offline safety)
  const pending = lsGet('mu_pending_sessions') || [];
  pending.push(sessionRecord);
  lsSet('mu_pending_sessions', pending);

  // Attempt Supabase write
  const { data, error } = await DB.saveSession(
    sessionRecord.user_id,
    sessionRecord.phase,
    sessionRecord.exercises
  );

  if (!error) {
    const updated = (lsGet('mu_pending_sessions') || [])
      .filter(s => s.id !== sessionRecord.id);
    lsSet('mu_pending_sessions', updated);
  }

  state.lastSession = {
    localId: sessionRecord.id,
    supabaseId: data?.id ?? null,
    exercises,
    phase: state.currentPhase,
  };

  state.sessionCount++;
  renderPhaseBanner();
  renderWorkout();
  checkPhaseTransition();
  renderLeaderboard();
  showPostSessionBar();
}

// ── Post-session bar ───────────────────────────────────────────────────────
function showPostSessionBar() {
  document.getElementById('post-session-bar').classList.remove('hidden');
  document.getElementById('btn-undo-session').onclick = undoLastSession;
  document.getElementById('btn-repeat-session').onclick = repeatLastSession;
}

function hidePostSessionBar() {
  document.getElementById('post-session-bar').classList.add('hidden');
}

async function undoLastSession() {
  if (!state.lastSession) return;

  const { localId, supabaseId } = state.lastSession;

  const updated = (lsGet('mu_pending_sessions') || []).filter(s => s.id !== localId);
  lsSet('mu_pending_sessions', updated);

  if (supabaseId) {
    await DB.deleteSession(supabaseId);
  }

  state.sessionCount--;
  state.lastSession = null;
  hidePostSessionBar();
  renderPhaseBanner();
  renderWorkout();
  checkPhaseTransition();
  renderLeaderboard();
}

async function repeatLastSession() {
  if (!state.lastSession) return;

  const { exercises } = state.lastSession;
  const sessionRecord = {
    id: Date.now(),
    user_id: state.userId,
    phase: state.currentPhase,
    session_date: new Date().toISOString().split('T')[0],
    exercises,
  };

  const pending = lsGet('mu_pending_sessions') || [];
  pending.push(sessionRecord);
  lsSet('mu_pending_sessions', pending);

  const { data, error } = await DB.saveSession(
    sessionRecord.user_id,
    sessionRecord.phase,
    sessionRecord.exercises
  );

  if (!error) {
    const updated = (lsGet('mu_pending_sessions') || []).filter(s => s.id !== sessionRecord.id);
    lsSet('mu_pending_sessions', updated);
  }

  state.lastSession = {
    localId: sessionRecord.id,
    supabaseId: data?.id ?? null,
    exercises,
    phase: state.currentPhase,
  };

  state.sessionCount++;
  renderPhaseBanner();
  checkPhaseTransition();
  renderLeaderboard();
}

// ── Leaderboard ────────────────────────────────────────────────────────────
async function renderLeaderboard() {
  if (!state.userId) return;
  const container = document.getElementById('leaderboard');

  if (!state.isOnline) {
    container.innerHTML = '<p class="offline-text">Offline</p>';
    return;
  }

  let profiles, sessions;
  try {
    const [pRes, sRes] = await Promise.all([DB.getAllProfiles(), DB.getAllSessions()]);
    if (pRes.error || sRes.error) throw (pRes.error || sRes.error);
    profiles = pRes.data || [];
    sessions = sRes.data || [];
  } catch (e) {
    container.innerHTML = '<p class="offline-text">Offline</p>';
    return;
  }

  if (!profiles.length) {
    container.innerHTML = '<p class="no-data-text">Noch keine Nutzer.</p>';
    return;
  }

  // Rank: furthest in the program first — current phase, then sessions in it.
  const ranked = profiles.map(p => {
    const inPhase = sessions.filter(s => s.user_id === p.user_id && s.phase === p.current_phase).length;
    const total = PLAN.phases[p.current_phase - 1].totalSessions;
    return { user_id: p.user_id, username: p.username, phase: p.current_phase, inPhase, total };
  }).sort((a, b) => b.phase - a.phase || b.inPhase - a.inPhase);

  container.innerHTML = ranked.map((u, i) => {
    const pct = Math.min((u.inPhase / u.total) * 100, 100);
    const isMe = u.user_id === state.userId;
    return `
      <div class="leaderboard-row${isMe ? ' is-me' : ''}">
        <span class="lb-rank">${i + 1}</span>
        <div class="lb-main">
          <div class="lb-top">
            <span class="lb-name">${escapeHtml(u.username)}</span>
            <span class="lb-phase-badge">Phase ${u.phase} · ${u.inPhase}/${u.total}</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      </div>`;
  }).join('');
}

// ── Plan reference ─────────────────────────────────────────────────────────
function renderPlanReference() {
  const container = document.getElementById('plan-reference');

  container.innerHTML = PLAN.phases.map(phase => `
    <div class="plan-phase ${phase.number === state.currentPhase ? 'active' : ''}">
      <div class="plan-phase-title">${phase.name} (Woche ${phase.weeks})</div>
      <table class="plan-table">
        <thead>
          <tr>
            <th>Übung</th>
            <th>Sätze × Wdh.</th>
            <th>Fokus</th>
          </tr>
        </thead>
        <tbody>
          ${phase.exercises.map(ex => `
            <tr>
              <td>${ex.name}</td>
              <td>${ex.sets} × ${ex.reps}</td>
              <td>${ex.focus}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');
}

// ── Phase transition ───────────────────────────────────────────────────────
function checkPhaseTransition() {
  const phase = PLAN.phases[state.currentPhase - 1];
  const banner = document.getElementById('phase-transition');
  const content = document.getElementById('phase-transition-content');
  const btn = document.getElementById('btn-advance-phase');

  if (state.sessionCount < phase.totalSessions || state.currentPhase >= 3) {
    banner.classList.add('hidden');
    return;
  }

  // Check if user already dismissed this transition (per user)
  const dismissKey = `mu_phase${state.currentPhase}_transition_dismissed_${state.userId}`;
  if (lsGet(dismissKey)) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');

  if (state.currentPhase === 1) {
    content.innerHTML = `
      <h3>Bereit für Phase 2?</h3>
      <p>Du hast alle ${phase.totalSessions} Sessions abgeschlossen!</p>
    `;
    btn.disabled = false;
  } else if (state.currentPhase === 2) {
    content.innerHTML = `
      <h3>Bereit für Phase 3?</h3>
      <p>Bestätige die folgenden Punkte bevor du weitermachst:</p>
      <div class="checklist">
        ${PLAN.phase3Checklist.map((item, i) => `
          <label class="checklist-item">
            <input type="checkbox" class="phase3-check" data-index="${i}">
            ${item}
          </label>
        `).join('')}
      </div>
    `;
    btn.disabled = true;

    content.querySelectorAll('.phase3-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = content.querySelectorAll('.phase3-check:checked').length;
        btn.disabled = checked < PLAN.phase3Checklist.length;
      });
    });
  }

  btn.onclick = advancePhase;

  // Add dismiss button
  if (!content.querySelector('.btn-dismiss')) {
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Später';
    dismissBtn.className = 'btn-dismiss';
    dismissBtn.style.cssText = 'background:none;border:none;color:var(--text-muted);font-size:0.85rem;cursor:pointer;margin-top:8px;padding:4px 0;';
    dismissBtn.addEventListener('click', () => {
      lsSet(dismissKey, true);
      banner.classList.add('hidden');
    });
    content.appendChild(dismissBtn);
  }
}

async function advancePhase() {
  document.getElementById('btn-advance-phase').disabled = true;
  state.currentPhase++;
  state.sessionCount = 0;

  lsSet(`mu_phase_${state.userId}`, state.currentPhase);
  try {
    await DB.upsertProfile(state.userId, state.currentPhase);
  } catch (e) {
    console.warn('Phase sync to Supabase failed, will retry on next load:', e);
  }

  document.getElementById('phase-transition').classList.add('hidden');
  renderPhaseBanner();
  renderWorkout();
  renderPlanReference();
  renderLeaderboard();
}

// ── Offline / pending session retry ────────────────────────────────────────
async function retryPendingSessions() {
  if (!state.userId) return;
  const pending = lsGet('mu_pending_sessions') || [];
  if (!pending.length) return;

  const remaining = [];
  for (const session of pending) {
    let userId = session.user_id;
    if (!userId) {
      // Legacy entry from the old (user_name) app: adopt only if it's clearly
      // the same person on this device, otherwise drop it to avoid misattribution.
      if (session.user_name && Auth.slug(state.username) === Auth.slug(session.user_name)) {
        userId = state.userId;
      } else {
        continue;
      }
    }
    const { error } = await DB.saveSession(
      userId,
      session.phase,
      session.exercises,
      session.session_date
    );
    if (error) remaining.push({ ...session, user_id: userId });
  }
  lsSet('mu_pending_sessions', remaining);
  renderLeaderboard();
}

// ── Network listeners (registered once) ───────────────────────────────────
function initNetworkListeners() {
  window.addEventListener('online', () => {
    state.isOnline = true;
    retryPendingSessions();
    renderLeaderboard();
  });
  window.addEventListener('offline', () => {
    state.isOnline = false;
    const lb = document.getElementById('leaderboard');
    if (lb) lb.innerHTML = '<p class="offline-text">Offline</p>';
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  initAuthScreen();
  initNetworkListeners();
  initLogout();

  // Subsequent auth transitions: login (SIGNED_IN), logout (SIGNED_OUT), token
  // refresh. INITIAL_SESSION is ignored here — the explicit getSession() below
  // owns the first route, so a blank screen never depends on the SDK's initial
  // emission. Heavy work is deferred out of the callback (calling Supabase
  // inside onAuthStateChange can deadlock).
  Auth.onChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    if (!session) {
      handleSignedOut();
      return;
    }
    const uid = session.user.id;
    if (uid === state.userId) return; // ignore token refreshes for the same user
    state.userId = uid;
    setTimeout(() => {
      loadMainScreen(uid).catch(err => console.error('loadMainScreen failed:', err));
    }, 0);
  });

  // First route, straight from the persisted session (reads localStorage; works
  // offline). Show the auth screen on any failure rather than leaving it blank.
  try {
    const session = await Auth.getSession();
    if (session) {
      state.userId = session.user.id;
      await loadMainScreen(session.user.id);
    } else {
      handleSignedOut();
    }
  } catch (err) {
    console.error('Initial session check failed:', err);
    handleSignedOut();
  }
});
