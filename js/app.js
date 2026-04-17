// js/app.js

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  userName: null,       // 'dennis' | 'clemens'
  partnerName: null,    // the other user
  currentPhase: 1,
  sessionCount: 0,      // sessions completed in current phase
  checkedSets: new Set(), // 'exerciseId-setIndex' strings
  isOnline: navigator.onLine,
};

// ── LocalStorage helpers ───────────────────────────────────────────────────
function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); }
  catch { return null; }
}

function lsSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ── Screen management ──────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('#screen-profile, #screen-main')
    .forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ── Profile selection ──────────────────────────────────────────────────────
function initProfileSelection() {
  document.querySelectorAll('.btn-profile').forEach(btn => {
    btn.addEventListener('click', () => {
      lsSet('mu_user', btn.dataset.user);
      loadMainScreen(btn.dataset.user);
    });
  });
}

// ── Main screen loader ─────────────────────────────────────────────────────
async function loadMainScreen(userName) {
  state.userName = userName;
  state.partnerName = userName === 'dennis' ? 'clemens' : 'dennis';
  showScreen('screen-main');

  // Unsubscribe any previous real-time subscription before re-subscribing
  Sync.unsubscribe();

  // Load phase from localStorage immediately (instant render), then sync
  state.currentPhase = lsGet(`mu_phase_${userName}`) || 1;

  const { data: profile } = await DB.getProfile(userName);
  if (profile) {
    state.currentPhase = profile.current_phase;
    lsSet(`mu_phase_${userName}`, profile.current_phase);
  } else {
    await DB.upsertProfile(userName, state.currentPhase);
  }

  const { count } = await DB.getSessionCount(userName, state.currentPhase);
  state.sessionCount = count || 0;

  renderPhaseBanner();
  renderWorkout();
  renderPlanReference();
  checkPhaseTransition();

  await renderPartnerCard();
  retryPendingSessions();

  Sync.subscribeToPartner(state.partnerName, renderPartnerCardFromSession);

  window.addEventListener('online', () => {
    state.isOnline = true;
    retryPendingSessions();
    renderPartnerCard();
  });
  window.addEventListener('offline', () => {
    state.isOnline = false;
    document.getElementById('partner-card').innerHTML =
      '<p class="offline-text">Offline</p>';
  });
}

// ── Phase banner ───────────────────────────────────────────────────────────
function renderPhaseBanner() {
  const phase = PLAN.phases[state.currentPhase - 1];
  const weeksEnd = parseInt(phase.weeks.split('–')[1]);
  const week = Math.min(Math.floor(state.sessionCount / 2) + 1, weeksEnd);

  document.getElementById('phase-label').textContent =
    `Phase ${phase.number} · Woche ${week}`;
  document.getElementById('phase-badge').textContent =
    `${state.sessionCount}/${phase.totalSessions} Sessions`;

  const pct = Math.min((state.sessionCount / phase.totalSessions) * 100, 100);
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

// ── Workout rendering ──────────────────────────────────────────────────────
function renderWorkout() {
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
      `<div class="exercise-detail">${exercise.sets} × ${exercise.reps} — ${exercise.focus}</div>`;

    const boxes = document.createElement('div');
    boxes.className = 'exercise-checkboxes';

    for (let i = 0; i < exercise.sets; i++) {
      const setId = `${exercise.id}-${i}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = setId;
      cb.addEventListener('change', () => {
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
  const exercises = Array.from(state.checkedSets);
  const sessionRecord = {
    id: Date.now(),
    user_name: state.userName,
    phase: state.currentPhase,
    session_date: new Date().toISOString().split('T')[0],
    exercises,
  };

  // Write to localStorage first (offline safety)
  const pending = lsGet('mu_pending_sessions') || [];
  pending.push(sessionRecord);
  lsSet('mu_pending_sessions', pending);

  // Attempt Supabase write
  const { error } = await DB.saveSession(
    sessionRecord.user_name,
    sessionRecord.phase,
    sessionRecord.exercises
  );

  if (!error) {
    const updated = (lsGet('mu_pending_sessions') || [])
      .filter(s => s.id !== sessionRecord.id);
    lsSet('mu_pending_sessions', updated);
  }

  state.sessionCount++;
  renderPhaseBanner();
  renderWorkout();
  checkPhaseTransition();
}

// ── Stubs (replaced in subsequent steps) ──────────────────────────────────
function renderPlanReference() {}
function checkPhaseTransition() {}
async function renderPartnerCard() {
  document.getElementById('partner-card').innerHTML = '<p class="no-data-text">Lade...</p>';
}
function renderPartnerCardFromSession() {}
function retryPendingSessions() {}

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initProfileSelection();
  const savedUser = lsGet('mu_user');
  if (savedUser) {
    loadMainScreen(savedUser);
  } else {
    showScreen('screen-profile');
  }
});
