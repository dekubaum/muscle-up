// js/app.js

// Bump on each release. Captured into feedback context so the admin/AI triage
// knows which build a report came from.
const APP_VERSION = '1.0.0';

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  userId: null,         // auth.users.id (uuid) of the logged-in user
  username: null,       // display name (from profiles.username)
  mode: 'muscleup',     // active training mode: 'muscleup' | 'handstand'
  tab: 'today',         // active logical tab: 'today' | 'leaderboard' | 'plan' | 'settings'
  currentPhase: 1,
  sessionCount: 0,      // sessions completed in current phase
  checkedSets: new Set(), // 'exerciseId-setIndex' strings
  isOnline: navigator.onLine,
  lastSession: null,    // { localId, supabaseId, exercises, phase }

  // Handstand practice (parallel program; see js/handstand-data.js)
  handstandCount: 0,         // total completed handstand sessions (current user)
  handstandBlock: 'a-warmup', // currently selected block id
  checkedHandstand: new Set(), // checked exercise ids for the active block
  lastHandstandSession: null,  // { localId, supabaseId, block, exercises }

  // Announcements (admin broadcast → banner → settings archive)
  isAdmin: false,            // may compose/send announcements + read feedback inbox
  announcements: [],         // all messages, newest first
  readIds: new Set(),        // announcement ids this user has read

  // Feedback (anonymous submit → admin-only inbox). Admin-only field.
  feedback: [],              // all feedback rows, newest first (empty for non-admins)

  // Deferred destructive reset awaiting its undo window (see onRewind/onClearPhase).
  // { kind:'rewind'|'clear', P, W?, keep?, keptCount?, label, prevState, timer } | null
  pendingReset: null,
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
  document.querySelectorAll('#screen-auth, #screen-app')
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
  state.mode = 'muscleup';
  state.tab = 'today';
  syncModeToggle();
  state.sessionCount = 0;
  state.lastSession = null;
  state.handstandCount = 0;
  state.lastHandstandSession = null;
  state.checkedHandstand.clear();
  state.isAdmin = false;
  state.announcements = [];
  state.readIds.clear();
  state.feedback = [];
  // Abandon any pending reset (safe direction: nothing was deleted server-side).
  clearPendingResetTimer();
  state.pendingReset = null;
  Sync.unsubscribe();
  closeMenu();
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
  showScreen('screen-app');

  // Unsubscribe any previous real-time subscription before re-subscribing
  Sync.unsubscribe();

  // Load phase from localStorage immediately (instant render), then sync
  state.currentPhase = lsGet(`mu_phase_${userId}`) || 1;
  state.handstandBlock = lsGet(`mu_handstand_block_${userId}`) || 'a-warmup';
  state.mode = lsGet(`mu_mode_${userId}`) || 'muscleup';
  syncModeToggle();

  const { data: profile } = await DB.getProfile(userId);
  if (profile) {
    state.username = profile.username;
    state.currentPhase = profile.current_phase;
    state.isAdmin = !!profile.is_admin;
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

  const { count: hsCount } = await DB.getHandstandCount(userId);
  state.handstandCount = hsCount || 0;

  renderPhaseBanner();
  renderWorkout();
  renderPlanReference();
  checkPhaseTransition();

  await renderLeaderboard();
  await loadAnnouncements();
  retryPendingSessions();
  retryPendingHandstand();
  retryPendingReads();
  retryPendingFeedback();

  // Land on the Today tab (resolves to the active mode's section + active nav state).
  navigate('today');

  // Subscribe only now — after the session (and its JWT) is confirmed.
  Sync.subscribeToSessions(() => renderLeaderboard());
  Sync.subscribeToHandstand(() => renderHandstandStandings());
  Sync.subscribeToAnnouncements(onNewAnnouncement);
}

// ── Header (username in the menu) ──────────────────────────────────────────
function renderHeader() {
  const el = document.getElementById('nav-username');
  if (el) el.textContent = state.username || '';
}

function initLogout() {
  document.getElementById('btn-logout').addEventListener('click', async () => {
    await Auth.signOut(); // onChange(SIGNED_OUT) does the teardown
  });
}

// ── Navigation: modes + tabs + hamburger menu ──────────────────────────────
// A logical `tab` is decoupled from the concrete page section: the active `mode`
// decides which section a tab resolves to, so the whole app reskins per mode.
const PAGES = {
  muscleup: {
    today:       'page-today',
    leaderboard: 'page-leaderboard',
    plan:        'page-plan',
    settings:    'page-settings',
  },
  handstand: {
    today:       'page-handstand',
    leaderboard: 'page-handstand-standings',
    plan:        'page-handstand-plan',
    settings:    'page-settings',
  },
};

function navigate(tab) {
  // Leaving the current view flushes any reset still in its undo window.
  if (state.pendingReset) commitPendingReset();
  const pageId = PAGES[state.mode][tab];

  const proceed = () => {
    state.tab = tab;
    document.querySelectorAll('.page').forEach(p =>
      p.classList.toggle('hidden', p.id !== pageId));
    document.querySelectorAll('.nav-item[data-tab]').forEach(item =>
      item.classList.toggle('active', item.dataset.tab === tab));

    closeMenu();
    window.scrollTo(0, 0);

    // Render the content for the resolved (mode, tab) combination.
    if (tab === 'today' && state.mode === 'handstand') renderHandstand();
    else if (tab === 'leaderboard') {
      state.mode === 'handstand' ? renderHandstandStandings() : renderLeaderboard();
    } else if (tab === 'plan' && state.mode === 'handstand') renderHandstandPlan();
    else if (tab === 'settings') renderSettings();
  };

  // Give the outgoing page a brief exit fade before swapping content; skip the
  // delay entirely when re-navigating to the page already showing.
  const current = document.querySelector('.page:not(.hidden)');
  if (current && current.id !== pageId) {
    clearTimeout(current._leaveTimer);
    current.classList.add('leaving');
    current._leaveTimer = setTimeout(() => {
      current.classList.remove('leaving');
      proceed();
    }, 120);
  } else {
    proceed();
  }
}

// Switch training mode: persist it, update the toggle, and re-resolve the
// current tab so the content swaps in place.
function setMode(mode) {
  if (mode === state.mode) return;
  state.mode = mode;
  if (state.userId) lsSet(`mu_mode_${state.userId}`, mode);
  syncModeToggle();
  navigate(state.tab);
}

function syncModeToggle() {
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    const on = btn.dataset.mode === state.mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function openMenu() {
  document.getElementById('nav-menu').classList.add('open');
  document.getElementById('nav-scrim').classList.add('open');
  document.getElementById('btn-menu').classList.add('open');
  document.getElementById('btn-menu').setAttribute('aria-expanded', 'true');
  document.getElementById('nav-menu').setAttribute('aria-hidden', 'false');
  document.body.classList.add('nav-open');
}

function closeMenu() {
  const menu = document.getElementById('nav-menu');
  if (!menu) return;
  menu.classList.remove('open');
  menu.setAttribute('aria-hidden', 'true');
  document.getElementById('nav-scrim').classList.remove('open');
  const btn = document.getElementById('btn-menu');
  btn.classList.remove('open');
  btn.setAttribute('aria-expanded', 'false');
  document.body.classList.remove('nav-open');
}

function initNav() {
  document.getElementById('btn-menu').addEventListener('click', () => {
    document.getElementById('nav-menu').classList.contains('open') ? closeMenu() : openMenu();
  });
  document.getElementById('nav-scrim').addEventListener('click', closeMenu);
  document.querySelectorAll('.nav-item[data-tab]').forEach(item =>
    item.addEventListener('click', () => navigate(item.dataset.tab)));
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn =>
    btn.addEventListener('click', () => setMode(btn.dataset.mode)));
  const fb = document.querySelector('.nav-item[data-feedback]');
  if (fb) fb.addEventListener('click', openFeedbackModal);
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
  const fill = document.getElementById('progress-fill');
  fill.style.width = `${pct}%`;
  fill.classList.toggle('is-complete', pct >= 100);
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

// ── Handstand practice ──────────────────────────────────────────────────────
// A parallel program (see js/handstand-data.js): pick ONE block to train today,
// tick the exercises you did, complete to log a session. Reuses the offline-first
// + realtime + standings patterns from the muscle-up side.
function renderHandstand() {
  renderHandstandProgress();
  renderHandstandBlocks();
  renderHandstandExercises();
}

// Read-only overview of the whole handstand program (handstand "Trainingsplan").
// Mirrors renderPlanReference: one card per block, reusing the .plan-* styling.
function renderHandstandPlan() {
  const container = document.getElementById('handstand-plan');
  if (!container) return;

  container.innerHTML = HANDSTAND.blocks.map(block => `
    <div class="plan-phase active">
      <div class="plan-phase-title">
        ${escapeHtml(block.letter)} · ${escapeHtml(block.name)} (${escapeHtml(block.duration)})
      </div>
      <div class="plan-phase-goal">${escapeHtml(block.goal)}</div>
      <table class="plan-table">
        <thead>
          <tr>
            <th>Übung</th>
            <th>Vorgabe</th>
            <th>Anleitung</th>
          </tr>
        </thead>
        <tbody>
          ${block.exercises.map(ex => `
            <tr>
              <td>${escapeHtml(ex.name)}</td>
              <td>${escapeHtml(ex.prescription)}</td>
              <td>${escapeHtml(ex.howto)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `).join('');
}

function renderHandstandProgress() {
  const label = document.getElementById('handstand-label');
  const badge = document.getElementById('handstand-badge');
  if (label) label.textContent = 'Handstand-Praxis';
  if (badge) badge.textContent =
    `${state.handstandCount} ${state.handstandCount === 1 ? 'Einheit' : 'Einheiten'}`;
}

function renderHandstandBlocks() {
  const container = document.getElementById('handstand-blocks');
  if (!container) return;

  container.innerHTML = HANDSTAND.blocks.map(b => {
    const active = b.id === state.handstandBlock ? ' active' : '';
    return `<button type="button" class="hs-block-chip${active}" data-block="${b.id}">` +
      `${escapeHtml(b.letter)} · ${escapeHtml(b.name)}</button>`;
  }).join('');

  container.querySelectorAll('.hs-block-chip').forEach(chip =>
    chip.addEventListener('click', () => {
      state.handstandBlock = chip.dataset.block;
      lsSet(`mu_handstand_block_${state.userId}`, state.handstandBlock);
      renderHandstandBlocks();
      renderHandstandExercises();
    }));
}

function renderHandstandExercises() {
  const list = document.getElementById('handstand-exercise-list');
  if (!list) return;
  hideHandstandBar();
  state.checkedHandstand.clear();

  const block = HANDSTAND.blocks.find(b => b.id === state.handstandBlock) || HANDSTAND.blocks[0];

  const goalHtml = block.goal
    ? `<p class="hs-block-goal">${escapeHtml(block.duration)} · Ziel: ${escapeHtml(block.goal)}</p>`
    : '';

  list.innerHTML = goalHtml + block.exercises.map(ex => {
    const detail = ex.prescription
      ? `<div class="exercise-detail">${escapeHtml(ex.prescription)}</div>` : '';
    const howto = ex.howto
      ? `<button type="button" class="hs-howto-toggle" data-id="${ex.id}" aria-expanded="false">Anleitung anzeigen</button>` +
        `<div class="hs-exercise-howto hidden" id="howto-${ex.id}">${escapeHtml(ex.howto)}</div>`
      : '';
    return `
      <div class="hs-exercise">
        <div class="hs-exercise-head">
          <div class="exercise-info">
            <div class="exercise-name">${escapeHtml(ex.name)}</div>
            ${detail}
          </div>
          <div class="exercise-checkboxes">
            <input type="checkbox" id="hs-${ex.id}" data-id="${ex.id}">
          </div>
        </div>
        ${howto}
      </div>`;
  }).join('');

  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      hideHandstandBar();
      const id = cb.dataset.id;
      if (cb.checked) state.checkedHandstand.add(id);
      else state.checkedHandstand.delete(id);
      updateHandstandButton();
    });
  });

  list.querySelectorAll('.hs-howto-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(`howto-${btn.dataset.id}`);
      if (!panel) return;
      const open = !panel.classList.toggle('hidden'); // toggle returns true when now hidden
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Anleitung verbergen' : 'Anleitung anzeigen';
    });
  });

  const btn = document.getElementById('btn-complete-handstand');
  btn.disabled = true;
  btn.onclick = completeHandstandSession;
}

function updateHandstandButton() {
  // One block is a pick-what-you-did menu, so a single checked exercise is enough.
  const btn = document.getElementById('btn-complete-handstand');
  if (btn) btn.disabled = state.checkedHandstand.size === 0;
}

async function completeHandstandSession() {
  document.getElementById('btn-complete-handstand').disabled = true;
  const exercises = Array.from(state.checkedHandstand);
  const record = {
    id: Date.now(),
    user_id: state.userId,
    block: state.handstandBlock,
    session_date: new Date().toISOString().split('T')[0],
    exercises,
  };

  // Write to localStorage first (offline safety), like completeSession.
  const pending = lsGet('mu_pending_handstand') || [];
  pending.push(record);
  lsSet('mu_pending_handstand', pending);

  const { data, error } = await DB.saveHandstandSession(
    record.user_id, record.block, record.exercises);

  if (!error) {
    const updated = (lsGet('mu_pending_handstand') || []).filter(s => s.id !== record.id);
    lsSet('mu_pending_handstand', updated);
  }

  state.lastHandstandSession = {
    localId: record.id,
    supabaseId: data?.id ?? null,
    block: record.block,
    exercises,
  };

  state.handstandCount++;
  renderHandstandProgress();
  renderHandstandExercises(); // clears checkboxes
  renderHandstandStandings();
  showHandstandBar();
}

function showHandstandBar() {
  document.getElementById('handstand-bar').classList.remove('hidden');
  document.getElementById('btn-undo-handstand').onclick = undoLastHandstandSession;
}

function hideHandstandBar() {
  const bar = document.getElementById('handstand-bar');
  if (bar) bar.classList.add('hidden');
}

async function undoLastHandstandSession() {
  if (!state.lastHandstandSession) return;
  const { localId, supabaseId } = state.lastHandstandSession;

  const updated = (lsGet('mu_pending_handstand') || []).filter(s => s.id !== localId);
  lsSet('mu_pending_handstand', updated);

  if (supabaseId) await DB.deleteHandstandSession(supabaseId);

  state.handstandCount--;
  state.lastHandstandSession = null;
  hideHandstandBar();
  renderHandstandProgress();
  renderHandstandStandings();
}

async function renderHandstandStandings() {
  if (!state.userId) return;
  const container = document.getElementById('handstand-standings');
  if (!container) return;

  if (!state.isOnline) {
    container.innerHTML = '<p class="offline-text">Offline</p>';
    return;
  }

  let profiles, sessions;
  try {
    const [pRes, sRes] = await Promise.all([DB.getAllProfiles(), DB.getAllHandstandSessions()]);
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

  const counts = {};
  sessions.forEach(s => { counts[s.user_id] = (counts[s.user_id] || 0) + 1; });

  const ranked = profiles
    .map(p => ({ user_id: p.user_id, username: p.username, total: counts[p.user_id] || 0 }))
    .sort((a, b) => b.total - a.total);

  container.innerHTML = ranked.map((u, i) => {
    const isMe = u.user_id === state.userId;
    return `
      <div class="leaderboard-row${isMe ? ' is-me' : ''}">
        <span class="lb-rank">${i + 1}</span>
        <div class="lb-main">
          <div class="lb-top">
            <span class="lb-name">${escapeHtml(u.username)}</span>
            <span class="lb-phase-badge">${u.total} ${u.total === 1 ? 'Einheit' : 'Einheiten'}</span>
          </div>
        </div>
      </div>`;
  }).join('');
}

async function retryPendingHandstand() {
  if (!state.userId) return;
  const pending = lsGet('mu_pending_handstand') || [];
  if (!pending.length) return;

  const remaining = [];
  for (const s of pending) {
    if (!s.user_id) continue; // no legacy entries exist for this newer feature
    const { error } = await DB.saveHandstandSession(s.user_id, s.block, s.exercises, s.session_date);
    if (error) remaining.push(s);
  }
  lsSet('mu_pending_handstand', remaining);
  renderHandstandStandings();
}

// ── Announcements ───────────────────────────────────────────────────────────
// Admin broadcasts a message (Settings → "Nachricht senden"); everyone else
// sees a banner on next open, expands it inline, and taps "Gelesen" to mark it
// read. Read messages stay in Settings → "Nachrichten". Mirrors the offline-first
// + realtime patterns of sessions: read receipts queue in `mu_pending_reads`.
let announceExpanded = false; // banner expand state (UI only, not persisted)

async function loadAnnouncements() {
  if (!state.userId) return;
  try {
    const [aRes, rRes] = await Promise.all([DB.getAnnouncements(), DB.getMyReads(state.userId)]);
    if (aRes.error || rRes.error) throw (aRes.error || rRes.error);
    state.announcements = aRes.data || [];
    state.readIds = new Set((rRes.data || []).map(r => r.announcement_id));
    // Fold in any queued offline receipts so the UI stays consistent pre-flush.
    (lsGet('mu_pending_reads') || []).forEach(p => {
      if (p.user_id === state.userId) state.readIds.add(p.announcement_id);
    });
  } catch (e) {
    // Offline, or the announcements table isn't migrated yet — degrade quietly.
  }
  renderAnnouncementBanner();
  renderMessagesList();
}

function unreadAnnouncements() {
  return state.announcements.filter(a => !state.readIds.has(a.id));
}

function formatAnnounceDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function renderAnnouncementBanner() {
  const banner = document.getElementById('announcement-banner');
  if (!banner) return;
  const unread = unreadAnnouncements();

  if (!unread.length) {
    banner.classList.add('hidden');
    announceExpanded = false;
    return;
  }

  banner.classList.remove('hidden');
  document.getElementById('announce-head-label').textContent =
    unread.length === 1 ? 'Neue Nachricht' : `${unread.length} neue Nachrichten`;

  const toggle = document.getElementById('announce-toggle');
  const body = document.getElementById('announce-body');
  const bodyInner = document.getElementById('announce-body-inner');
  toggle.setAttribute('aria-expanded', String(announceExpanded));
  body.classList.toggle('expanded', announceExpanded);

  bodyInner.innerHTML = unread.map(a => `
    <div class="announce-item">
      <div class="announce-item-title">${escapeHtml(a.title)}</div>
      <div class="announce-item-date">${formatAnnounceDate(a.created_at)}</div>
      <div class="announce-item-text">${escapeHtml(a.body)}</div>
      <button type="button" class="btn-announce-read" data-id="${escapeHtml(a.id)}">Gelesen</button>
    </div>
  `).join('');

  bodyInner.querySelectorAll('.btn-announce-read').forEach(btn =>
    btn.addEventListener('click', () => markAnnouncementRead(btn.dataset.id)));
}

function toggleAnnounceBanner() {
  announceExpanded = !announceExpanded;
  renderAnnouncementBanner();
}

async function markAnnouncementRead(id) {
  if (!id || state.readIds.has(id)) return;
  state.readIds.add(id);

  // Offline-first: queue the receipt before the network attempt.
  const pending = lsGet('mu_pending_reads') || [];
  if (!pending.some(p => p.announcement_id === id && p.user_id === state.userId)) {
    pending.push({ announcement_id: id, user_id: state.userId });
    lsSet('mu_pending_reads', pending);
  }

  renderAnnouncementBanner();
  renderMessagesList();

  const { error } = await DB.markAnnouncementRead(id, state.userId);
  // 23505 = already recorded; treat as success and drop from the queue.
  if (!error || error.code === '23505') {
    const updated = (lsGet('mu_pending_reads') || [])
      .filter(p => !(p.announcement_id === id && p.user_id === state.userId));
    lsSet('mu_pending_reads', updated);
  }
}

async function retryPendingReads() {
  if (!state.userId) return;
  const pending = lsGet('mu_pending_reads') || [];
  if (!pending.length) return;

  const remaining = [];
  for (const p of pending) {
    if (!p.user_id) continue;
    const { error } = await DB.markAnnouncementRead(p.announcement_id, p.user_id);
    if (error && error.code !== '23505') remaining.push(p);
  }
  lsSet('mu_pending_reads', remaining);
}

// Realtime: an admin just broadcast a message — show it live.
function onNewAnnouncement(row) {
  if (!row || state.announcements.some(a => a.id === row.id)) return;
  state.announcements.unshift(row);
  renderAnnouncementBanner();
  renderMessagesList();
}

async function onSendAnnouncement(e) {
  e.preventDefault();
  setSettingsMsg('announce-msg', '');
  const title = document.getElementById('announce-title').value.trim();
  const body = document.getElementById('announce-body-input').value.trim();
  if (!title || !body) {
    setSettingsMsg('announce-msg', 'Bitte Titel und Nachricht ausfüllen.', 'error');
    return;
  }

  const submit = e.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  const { data, error } = await DB.createAnnouncement(state.userId, title, body);
  submit.disabled = false;

  if (error) {
    setSettingsMsg('announce-msg', error.message || 'Konnte nicht gesendet werden.', 'error');
    return;
  }

  // Optimistically add it, then mark it read for the author so they don't get
  // their own banner (markAnnouncementRead also persists the receipt).
  if (data && !state.announcements.some(a => a.id === data.id)) {
    state.announcements.unshift(data);
  }
  if (data) markAnnouncementRead(data.id);

  e.target.reset();
  renderAnnouncementBanner();
  renderMessagesList();
  setSettingsMsg('announce-msg', 'Nachricht gesendet.', 'success');
}

// Settings → "Nachrichten": the full archive (read + unread), newest first.
function renderMessagesList() {
  const list = document.getElementById('messages-list');
  if (!list) return;

  if (!state.announcements.length) {
    list.innerHTML = '<p class="messages-empty">Noch keine Nachrichten.</p>';
    return;
  }

  list.innerHTML = state.announcements.map(a => {
    const unread = !state.readIds.has(a.id);
    const tag = unread ? '<span class="message-new-tag">neu</span>' : '';
    const readBtn = unread
      ? `<button type="button" class="btn-announce-read" data-id="${escapeHtml(a.id)}">Gelesen</button>`
      : '';
    return `
      <div class="message-item">
        <div class="message-top">
          <span class="message-title">${escapeHtml(a.title)}</span>
          ${tag}
        </div>
        <div class="message-date">${formatAnnounceDate(a.created_at)}</div>
        <div class="message-text">${escapeHtml(a.body)}</div>
        ${readBtn}
      </div>`;
  }).join('');

  list.querySelectorAll('.btn-announce-read').forEach(btn =>
    btn.addEventListener('click', () => markAnnouncementRead(btn.dataset.id)));
}

// ── Feedback ─────────────────────────────────────────────────────────────────
// Any user submits anonymous feedback from a modal reachable anywhere (the menu).
// No user_id is ever sent — the row can't be traced to its author. Mirrors the
// offline-first pattern of completeSession: the entry queues in `mu_pending_feedback`
// before the network attempt. The admin-only inbox lives in Settings (no realtime —
// it loads fresh each visit).
const FEEDBACK_TYPES = [
  { id: 'bug',    label: 'Bug' },
  { id: 'idea',   label: 'Idee' },
  { id: 'praise', label: 'Lob' },
  { id: 'other',  label: 'Sonstiges' },
];
const FEEDBACK_STATUSES = {
  new:       'Neu',
  planned:   'Geplant',
  done:      'Erledigt',
  dismissed: 'Verworfen',
};
let feedbackType = null; // currently picked type id in the modal (null = none yet)

function initFeedback() {
  const form = document.getElementById('feedback-form');
  if (form) form.addEventListener('submit', onSubmitFeedback);
  const close = document.getElementById('feedback-close');
  if (close) close.addEventListener('click', closeFeedbackModal);
  const modal = document.getElementById('feedback-modal');
  // Click on the dim backdrop (not the card) closes.
  if (modal) modal.addEventListener('click', (e) => {
    if (e.target === modal) closeFeedbackModal();
  });
  document.querySelectorAll('#feedback-type .fb-type-btn').forEach(btn =>
    btn.addEventListener('click', () => selectFeedbackType(btn.dataset.ftype)));
  const ta = document.getElementById('feedback-message');
  if (ta) ta.addEventListener('input', updateFeedbackSubmit);
}

function openFeedbackModal() {
  closeMenu();
  feedbackType = null;
  const form = document.getElementById('feedback-form');
  if (form) form.reset();
  syncFeedbackTypeButtons();
  updateFeedbackSubmit();
  setSettingsMsg('feedback-msg', '');
  const modal = document.getElementById('feedback-modal');
  clearTimeout(modal._closeTimer);
  modal.classList.remove('closing');
  modal.classList.remove('hidden');
  document.body.classList.add('nav-open'); // reuse scroll-lock
  const ta = document.getElementById('feedback-message');
  if (ta) setTimeout(() => ta.focus(), 50);
}

function closeFeedbackModal() {
  const modal = document.getElementById('feedback-modal');
  modal.classList.add('closing');
  clearTimeout(modal._closeTimer);
  modal._closeTimer = setTimeout(() => {
    modal.classList.add('hidden');
    modal.classList.remove('closing');
  }, 150);
  document.body.classList.remove('nav-open');
}

function selectFeedbackType(id) {
  feedbackType = id;
  syncFeedbackTypeButtons();
  updateFeedbackSubmit();
}

function syncFeedbackTypeButtons() {
  document.querySelectorAll('#feedback-type .fb-type-btn').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.ftype === feedbackType));
}

function updateFeedbackSubmit() {
  const btn = document.getElementById('feedback-submit');
  const msg = (document.getElementById('feedback-message').value || '').trim();
  if (btn) btn.disabled = !(feedbackType && msg);
}

async function onSubmitFeedback(e) {
  e.preventDefault();
  setSettingsMsg('feedback-msg', '');
  const message = document.getElementById('feedback-message').value.trim();
  if (!feedbackType || !message) {
    setSettingsMsg('feedback-msg', 'Bitte Art wählen und etwas schreiben.', 'error');
    return;
  }

  // Context is deliberately identity-free (no user_id, no username).
  const context = {
    screen: state.tab,
    mode: state.mode,
    phase: state.currentPhase,
    block: state.handstandBlock,
    app_version: APP_VERSION,
    user_agent: navigator.userAgent,
  };
  const record = { id: Date.now(), type: feedbackType, message, context };

  // Offline-first: queue before the network attempt (like completeSession).
  const pending = lsGet('mu_pending_feedback') || [];
  pending.push(record);
  lsSet('mu_pending_feedback', pending);

  const submit = document.getElementById('feedback-submit');
  if (submit) submit.disabled = true;
  const { error } = await DB.submitFeedback(record.type, record.message, record.context);
  if (!error) {
    const updated = (lsGet('mu_pending_feedback') || []).filter(r => r.id !== record.id);
    lsSet('mu_pending_feedback', updated);
  }

  // It either reached the server or is safely queued — either way, thank them,
  // then close. (No status leak about online/offline; the queue handles it.)
  setSettingsMsg('feedback-msg', 'Danke für dein Feedback!', 'success');
  setTimeout(closeFeedbackModal, 1200);
}

async function retryPendingFeedback() {
  const pending = lsGet('mu_pending_feedback') || [];
  if (!pending.length) return;
  const remaining = [];
  for (const r of pending) {
    const { error } = await DB.submitFeedback(r.type, r.message, r.context);
    if (error) remaining.push(r);
  }
  lsSet('mu_pending_feedback', remaining);
}

// Admin inbox (Settings → Feedback). Loaded fresh each Settings visit.
async function loadFeedback() {
  if (!state.userId || !state.isAdmin) return;
  try {
    const { data, error } = await DB.getFeedback();
    if (error) throw error;
    state.feedback = data || [];
  } catch (e) {
    // Offline, or the feedback table isn't migrated yet — degrade quietly.
  }
}

function feedbackContextSummary(ctx) {
  if (!ctx) return '';
  const parts = [];
  if (ctx.mode) parts.push(ctx.mode === 'handstand' ? 'Handstand' : 'Muscle Up');
  if (ctx.screen) parts.push(ctx.screen);
  if (ctx.mode === 'handstand' && ctx.block) parts.push(`Block ${ctx.block}`);
  else if (ctx.phase != null) parts.push(`Phase ${ctx.phase}`);
  if (ctx.app_version) parts.push(`v${ctx.app_version}`);
  return parts.join(' · ');
}

function renderFeedbackInbox() {
  const list = document.getElementById('feedback-list');
  if (!list) return;

  if (!state.feedback.length) {
    list.innerHTML = '<p class="messages-empty">Noch kein Feedback.</p>';
    return;
  }

  list.innerHTML = state.feedback.map(f => {
    const typeLabel = (FEEDBACK_TYPES.find(t => t.id === f.type) || {}).label || f.type;
    const statusLabel = FEEDBACK_STATUSES[f.status] || f.status;
    const ctx = f.context || {};
    const summary = feedbackContextSummary(ctx);
    const ua = ctx.user_agent ? `<div class="fb-ua">${escapeHtml(ctx.user_agent)}</div>` : '';
    const statusBtns = ['planned', 'done', 'dismissed']
      .filter(s => s !== f.status)
      .map(s => `<button type="button" class="btn-fb-status" data-id="${escapeHtml(f.id)}" data-status="${s}">${FEEDBACK_STATUSES[s]}</button>`)
      .join('');
    return `
      <div class="feedback-item">
        <div class="fb-top">
          <span class="fb-type fb-type-${escapeHtml(f.type)}">${escapeHtml(typeLabel)}</span>
          <span class="fb-status fb-status-${escapeHtml(f.status)}">${escapeHtml(statusLabel)}</span>
          <span class="fb-date">${formatAnnounceDate(f.created_at)}</span>
        </div>
        <div class="fb-message">${escapeHtml(f.message)}</div>
        ${summary ? `<div class="fb-context">${escapeHtml(summary)}</div>` : ''}
        ${ua}
        <div class="fb-actions">
          ${statusBtns}
          <button type="button" class="btn-fb-delete" data-id="${escapeHtml(f.id)}">Löschen</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.btn-fb-status').forEach(btn =>
    btn.addEventListener('click', () => onFeedbackStatus(btn.dataset.id, btn.dataset.status)));
  list.querySelectorAll('.btn-fb-delete').forEach(btn =>
    btn.addEventListener('click', () => onFeedbackDelete(btn.dataset.id)));
}

async function onFeedbackStatus(id, status) {
  const item = state.feedback.find(f => f.id === id);
  if (item) item.status = status; // optimistic
  renderFeedbackInbox();
  const { error } = await DB.updateFeedbackStatus(id, status);
  if (error) { await loadFeedback(); renderFeedbackInbox(); }
}

async function onFeedbackDelete(id) {
  state.feedback = state.feedback.filter(f => f.id !== id); // optimistic
  renderFeedbackInbox();
  const { error } = await DB.deleteFeedback(id);
  if (error) { await loadFeedback(); renderFeedbackInbox(); }
}

// ── Settings: name, password, progress reset ───────────────────────────────
function initSettings() {
  document.getElementById('name-form').addEventListener('submit', onNameSubmit);
  document.getElementById('password-form').addEventListener('submit', onPasswordSubmit);
  document.getElementById('rewind-phase').addEventListener('change', renderRewindWeeks);
  document.getElementById('btn-rewind').addEventListener('click', onRewind);
  document.getElementById('announce-form').addEventListener('submit', onSendAnnouncement);
  document.getElementById('announce-toggle').addEventListener('click', toggleAnnounceBanner);
  document.getElementById('btn-reset-undo').addEventListener('click', undoPendingReset);

  // Show/hide toggles for the password fields.
  initPasswordToggles();

  // Inline validation on blur (submit still re-validates and focuses the field).
  document.getElementById('settings-name').addEventListener('blur', validateNameField);
  document.getElementById('settings-password2').addEventListener('blur', validatePasswordFields);
}

// Flip each password field between hidden and visible.
function initPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Verbergen' : 'Zeigen';
      btn.setAttribute('aria-pressed', show ? 'true' : 'false');
      btn.setAttribute('aria-label', show ? 'Passwort verbergen' : 'Passwort anzeigen');
    });
  });
}

// Reset both password fields back to hidden (called on each Settings render).
function resetPasswordToggles() {
  document.querySelectorAll('.pw-toggle').forEach(btn => {
    const input = document.getElementById(btn.dataset.target);
    if (input) input.type = 'password';
    btn.textContent = 'Zeigen';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Passwort anzeigen');
  });
}

// Inline validators — reuse the same rules as the submit handlers, surfaced via
// the existing role="alert" message elements. Empty fields clear the message.
function validateNameField() {
  const name = document.getElementById('settings-name').value.trim();
  if (!name) { setSettingsMsg('name-msg', ''); return; }
  const s = Auth.slug(name);
  if (s.length < 2 || s.length > 30) {
    setSettingsMsg('name-msg', 'Name muss 2 bis 30 Zeichen (Buchstaben/Zahlen) enthalten.', 'error');
  } else {
    setSettingsMsg('name-msg', '');
  }
}

function validatePasswordFields() {
  const pw = document.getElementById('settings-password').value;
  const pw2 = document.getElementById('settings-password2').value;
  if (!pw2) { setSettingsMsg('password-msg', ''); return; }
  if (pw2.length < 6) {
    setSettingsMsg('password-msg', 'Passwort muss mindestens 6 Zeichen lang sein.', 'error');
  } else if (pw !== pw2) {
    setSettingsMsg('password-msg', 'Die Passwörter stimmen nicht überein.', 'error');
  } else {
    setSettingsMsg('password-msg', '');
  }
}

function setSettingsMsg(id, msg, kind) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg || '';
  el.classList.remove('error', 'success');
  if (kind) el.classList.add(kind);
}

function renderSettings() {
  const nameInput = document.getElementById('settings-name');
  if (nameInput) nameInput.value = state.username || '';
  document.getElementById('settings-password').value = '';
  document.getElementById('settings-password2').value = '';
  resetPasswordToggles();
  setSettingsMsg('name-msg', '');
  setSettingsMsg('password-msg', '');
  setSettingsMsg('announce-msg', '');

  // Sync the deferred-reset undo bar with any reset still in its window.
  const undoBar = document.getElementById('reset-undo');
  if (state.pendingReset) {
    document.getElementById('reset-undo-text').textContent = state.pendingReset.label || '';
    undoBar.classList.remove('hidden');
  } else {
    undoBar.classList.add('hidden');
    setSettingsMsg('reset-msg', '');
  }

  // Messages archive (all users) + compose form (admins only).
  renderMessagesList();
  document.getElementById('announce-compose').classList.toggle('hidden', !state.isAdmin);

  // Feedback inbox (admins only). Load fresh each visit — no realtime.
  const inbox = document.getElementById('feedback-inbox');
  inbox.classList.toggle('hidden', !state.isAdmin);
  if (state.isAdmin) {
    renderFeedbackInbox();
    loadFeedback().then(renderFeedbackInbox);
  }

  // Rewind target phase: only phases up to (and including) the current one — you
  // rewind backwards, never skip ahead.
  const phaseSel = document.getElementById('rewind-phase');
  phaseSel.innerHTML = PLAN.phases
    .filter(p => p.number <= state.currentPhase)
    .map(p => `<option value="${p.number}">Phase ${p.number}</option>`)
    .join('');
  phaseSel.value = String(state.currentPhase);
  renderRewindWeeks();

  renderPhaseClearList();
}

function renderRewindWeeks() {
  const phaseNum = Number(document.getElementById('rewind-phase').value);
  const phase = PLAN.phases[phaseNum - 1];
  const [weeksStart, weeksEnd] = phase.weeks.split('-').map(Number);
  const weekCount = weeksEnd - weeksStart + 1;

  // For the current phase, only offer weeks up to where you actually are.
  let maxWeek = weekCount;
  if (phaseNum === state.currentPhase) {
    maxWeek = Math.min(Math.floor(state.sessionCount / 2) + 1, weekCount);
  }

  let opts = '';
  for (let w = 1; w <= maxWeek; w++) {
    opts += `<option value="${w}">Woche ${w}</option>`;
  }
  document.getElementById('rewind-week').innerHTML = opts;
}

function renderPhaseClearList() {
  const list = document.getElementById('phase-clear-list');
  if (!list) return;

  // Render rows immediately; counts fill in asynchronously.
  list.innerHTML = PLAN.phases.map(p => `
    <div class="phase-clear-row">
      <div class="phase-clear-info">
        <span class="phase-clear-name">Phase ${p.number}</span>
        <span class="phase-clear-count" id="phase-count-${p.number}">…</span>
      </div>
      <button type="button" class="btn-clear" data-phase="${p.number}">Leeren</button>
    </div>`).join('');

  list.querySelectorAll('.btn-clear').forEach(btn =>
    btn.addEventListener('click', () => onClearPhase(Number(btn.dataset.phase))));

  PLAN.phases.forEach(async (p) => {
    // While a reset is pending, show its optimistic count instead of fetching.
    const override = pendingResetCountFor(p.number);
    if (override !== null) {
      const el = document.getElementById(`phase-count-${p.number}`);
      if (el) el.textContent = `${override} Sessions`;
      return;
    }
    const { count } = await DB.getSessionCount(state.userId, p.number);
    const el = document.getElementById(`phase-count-${p.number}`);
    if (el) el.textContent = `${count || 0} Sessions`;
  });
}

async function onNameSubmit(e) {
  e.preventDefault();
  setSettingsMsg('name-msg', '');
  const name = document.getElementById('settings-name').value.trim();
  const s = Auth.slug(name);
  if (s.length < 2 || s.length > 30) {
    setSettingsMsg('name-msg', 'Name muss 2 bis 30 Zeichen (Buchstaben/Zahlen) enthalten.', 'error');
    document.getElementById('settings-name').focus();
    return;
  }
  if (name === state.username) {
    setSettingsMsg('name-msg', 'Das ist bereits dein Name.', 'error');
    document.getElementById('settings-name').focus();
    return;
  }

  const submit = e.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  const { error } = await DB.upsertProfile(state.userId, state.currentPhase, name);
  submit.disabled = false;

  if (error) {
    const msg = error.code === '23505'
      ? 'Dieser Name ist bereits vergeben.'
      : (error.message || 'Name konnte nicht geändert werden.');
    setSettingsMsg('name-msg', msg, 'error');
    return;
  }

  state.username = name;
  renderHeader();
  renderLeaderboard();
  setSettingsMsg('name-msg', 'Name gespeichert.', 'success');
}

async function onPasswordSubmit(e) {
  e.preventDefault();
  setSettingsMsg('password-msg', '');
  const pw = document.getElementById('settings-password').value;
  const pw2 = document.getElementById('settings-password2').value;

  if (pw.length < 6) {
    setSettingsMsg('password-msg', 'Passwort muss mindestens 6 Zeichen lang sein.', 'error');
    document.getElementById('settings-password').focus();
    return;
  }
  if (pw !== pw2) {
    setSettingsMsg('password-msg', 'Die Passwörter stimmen nicht überein.', 'error');
    document.getElementById('settings-password2').focus();
    return;
  }

  const submit = e.target.querySelector('button[type="submit"]');
  submit.disabled = true;
  const { error } = await Auth.updatePassword(pw);
  submit.disabled = false;

  if (error) {
    setSettingsMsg('password-msg', error, 'error');
    return;
  }

  document.getElementById('settings-password').value = '';
  document.getElementById('settings-password2').value = '';
  setSettingsMsg('password-msg', 'Passwort geändert.', 'success');
}

// Re-render everything that depends on session counts / phase after a reset.
function applyResetUi() {
  hidePostSessionBar();
  renderPhaseBanner();
  renderWorkout();
  renderPlanReference();
  checkPhaseTransition();
  renderLeaderboard();
  renderSettings();
}

// ── Deferred destructive resets (undo window) ──────────────────────────────
// Rewind / clear-phase update the UI optimistically, then commit the real DB
// deletes after a short window. Undo just cancels the timer — nothing was
// deleted server-side, so it is a pure UI restore. Leaving the screen (navigate
// / sign-out) or starting another reset flushes the pending one first.
const RESET_UNDO_MS = 6000;

// The optimistic session count a phase should read while a reset is pending, or
// null if this phase is unaffected (so renderPhaseClearList fetches the real one).
function pendingResetCountFor(phaseNumber) {
  const pr = state.pendingReset;
  if (!pr) return null;
  if (pr.kind === 'clear') return phaseNumber === pr.P ? 0 : null;
  // rewind: the target phase keeps `keptCount`; every later phase is emptied.
  if (phaseNumber === pr.P) return pr.keptCount;
  if (phaseNumber > pr.P) return 0;
  return null;
}

function clearPendingResetTimer() {
  if (state.pendingReset && state.pendingReset.timer) {
    clearTimeout(state.pendingReset.timer);
    state.pendingReset.timer = null;
  }
}

function onRewind() {
  commitPendingReset();               // flush any earlier pending reset first
  const P = Number(document.getElementById('rewind-phase').value);
  const W = Number(document.getElementById('rewind-week').value);
  const keep = (W - 1) * 2;

  const prevState = {
    currentPhase: state.currentPhase,
    sessionCount: state.sessionCount,
    lastSession: state.lastSession,
  };
  // Optimistic kept-count estimate; commit recomputes the exact value from the DB.
  const keptCount = P === state.currentPhase ? Math.min(keep, state.sessionCount) : keep;

  state.currentPhase = P;
  state.sessionCount = keptCount;
  state.lastSession = null;
  state.pendingReset = {
    kind: 'rewind', P, W, keep, keptCount,
    label: `Zurückgespult auf Phase ${P}, Woche ${W}.`,
    prevState, timer: null,
  };
  applyResetUi();
  state.pendingReset.timer = setTimeout(commitPendingReset, RESET_UNDO_MS);
}

function onClearPhase(P) {
  commitPendingReset();               // flush any earlier pending reset first

  const prevState = {
    currentPhase: state.currentPhase,
    sessionCount: state.sessionCount,
    lastSession: state.lastSession,
  };
  if (P === state.currentPhase) {
    state.sessionCount = 0;
    state.lastSession = null;
  }
  state.pendingReset = {
    kind: 'clear', P,
    label: `Phase ${P} geleert.`,
    prevState, timer: null,
  };
  applyResetUi();
  state.pendingReset.timer = setTimeout(commitPendingReset, RESET_UNDO_MS);
}

// Undo: cancel the timer and restore the pre-action state. No DB work needed.
function undoPendingReset() {
  const pr = state.pendingReset;
  if (!pr) return;
  clearPendingResetTimer();
  state.pendingReset = null;
  state.currentPhase = pr.prevState.currentPhase;
  state.sessionCount = pr.prevState.sessionCount;
  state.lastSession = pr.prevState.lastSession;
  applyResetUi();
}

// Commit: perform the actual DB deletes. Claims the pending reset up front so
// re-entrant calls (navigate, a second reset) can't run it twice. On failure it
// rolls back to the pre-action state — nothing was persisted.
async function commitPendingReset() {
  const pr = state.pendingReset;
  if (!pr) return;
  clearPendingResetTimer();
  state.pendingReset = null;
  document.getElementById('reset-undo').classList.add('hidden');

  try {
    if (pr.kind === 'clear') await commitClearPhase(pr);
    else await commitRewind(pr);
  } catch (err) {
    console.error('Reset commit failed:', err);
    state.currentPhase = pr.prevState.currentPhase;
    state.sessionCount = pr.prevState.sessionCount;
    state.lastSession = pr.prevState.lastSession;
    applyResetUi();
    setSettingsMsg('reset-msg', 'Konnte nicht zurücksetzen. Bitte online sein und erneut versuchen.', 'error');
  }
}

async function commitClearPhase(pr) {
  const P = pr.P;
  const { error } = await DB.deleteSessionsForPhase(state.userId, P);
  if (error) throw error;

  // Drop queued offline sessions for this phase and reset its banner-dismiss flag.
  const pending = (lsGet('mu_pending_sessions') || []).filter(row => Number(row.phase) !== P);
  lsSet('mu_pending_sessions', pending);
  localStorage.removeItem(`mu_phase${P}_transition_dismissed_${state.userId}`);
  applyResetUi();                      // reconcile leaderboard/counts with the DB
  setSettingsMsg('reset-msg', `Phase ${P} geleert.`, 'success');
}

async function commitRewind(pr) {
  const { P, W, keep } = pr;
  // 1. Trim the target phase: keep the oldest `keep` sessions, delete the rest.
  const { data: sessions, error: getErr } = await DB.getSessions(state.userId, P);
  if (getErr) throw getErr;
  const ordered = sessions || [];
  const toDelete = ordered.slice(keep).map(row => row.id);
  const keptCount = ordered.length - toDelete.length; // clamps if user has fewer sessions
  if (toDelete.length) {
    const { error } = await DB.deleteSessionsByIds(toDelete);
    if (error) throw error;
  }
  // 2. Delete every session in later phases.
  for (const phase of PLAN.phases) {
    if (phase.number > P) {
      const { error } = await DB.deleteSessionsForPhase(state.userId, phase.number);
      if (error) throw error;
    }
  }
  // 3. Move the current-phase pointer back to P.
  const { error: profErr } = await DB.upsertProfile(state.userId, P);
  if (profErr) throw profErr;

  pruneLocalAfterReset(P);
  state.currentPhase = P;
  state.sessionCount = keptCount;      // reconcile with the exact server-side count
  state.lastSession = null;
  lsSet(`mu_phase_${state.userId}`, P);
  applyResetUi();
  setSettingsMsg('reset-msg', `Zurückgespult auf Phase ${P}, Woche ${W}.`, 'success');
}

// After a rewind to phase `fromPhase`: drop queued sessions at/after that point
// and clear transition-dismissed flags so the banners re-evaluate cleanly.
function pruneLocalAfterReset(fromPhase) {
  const pending = (lsGet('mu_pending_sessions') || [])
    .filter(row => Number(row.phase) < fromPhase);
  lsSet('mu_pending_sessions', pending);
  PLAN.phases.forEach(p => {
    if (p.number >= fromPhase) {
      localStorage.removeItem(`mu_phase${p.number}_transition_dismissed_${state.userId}`);
    }
  });
}

// ── Network listeners (registered once) ───────────────────────────────────
function initNetworkListeners() {
  window.addEventListener('online', () => {
    state.isOnline = true;
    retryPendingSessions();
    retryPendingHandstand();
    retryPendingReads();
    retryPendingFeedback();
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
  initNav();
  initSettings();
  initFeedback();

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
