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
      loadMainScreen(btn.dataset.user).catch(err => console.error('loadMainScreen failed:', err));
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
}

// ── Phase banner ───────────────────────────────────────────────────────────
function renderPhaseBanner() {
  const phase = PLAN.phases[state.currentPhase - 1];
  const [weeksStart, weeksEnd] = phase.weeks.split('–').map(Number);
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
  document.getElementById('btn-complete').disabled = true;
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

// ── Partner card ───────────────────────────────────────────────────────────
async function renderPartnerCard() {
  const card = document.getElementById('partner-card');

  if (!state.isOnline) {
    card.innerHTML = '<p class="offline-text">Offline</p>';
    return;
  }

  let session = null;
  try {
    const result = await DB.getLatestPartnerSession(state.partnerName);
    session = result.data;
  } catch (e) {
    card.innerHTML = '<p class="offline-text">Offline</p>';
    return;
  }

  if (!session) {
    const name = state.partnerName === 'dennis' ? 'Dennis' : 'Clemens';
    card.innerHTML = `<p class="no-data-text">${name} hat noch keine Session.</p>`;
    return;
  }

  renderPartnerCardFromSession(session);
}

function renderPartnerCardFromSession(session) {
  const name = session.user_name === 'dennis' ? 'Dennis' : 'Clemens';
  const elapsed = timeAgo(session.created_at);
  const phaseData = PLAN.phases[session.phase - 1];
  let exerciseText = '';
  if (phaseData && Array.isArray(session.exercises)) {
    const covered = phaseData.exercises.filter(ex =>
      session.exercises.some(id => id.startsWith(ex.id + '-'))
    ).length;
    exerciseText = `${covered}/${phaseData.exercises.length} Übungen · `;
  }
  document.getElementById('partner-card').innerHTML = `
    <div class="partner-info">
      <span class="partner-name">${name}</span>
      <span class="partner-phase-badge">Phase ${session.phase}</span>
    </div>
    <div class="partner-detail">${exerciseText}${elapsed}</div>
  `;
}

// ── Time helper ────────────────────────────────────────────────────────────
function timeAgo(isoString) {
  const secs = Math.floor((Date.now() - new Date(isoString)) / 1000);
  if (secs < 60) return 'gerade eben';
  if (secs < 3600) return `vor ${Math.floor(secs / 60)} Min.`;
  if (secs < 86400) return `vor ${Math.floor(secs / 3600)} Std.`;
  return `vor ${Math.floor(secs / 86400)} Tagen`;
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

  // Check if user already dismissed this transition
  const dismissKey = `mu_phase${state.currentPhase}_transition_dismissed`;
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

  lsSet(`mu_phase_${state.userName}`, state.currentPhase);
  try {
    await DB.upsertProfile(state.userName, state.currentPhase);
  } catch (e) {
    console.warn('Phase sync to Supabase failed, will retry on next load:', e);
  }

  document.getElementById('phase-transition').classList.add('hidden');
  renderPhaseBanner();
  renderWorkout();
  renderPlanReference();
}

// ── Offline / pending session retry ────────────────────────────────────────
async function retryPendingSessions() {
  const pending = lsGet('mu_pending_sessions') || [];
  if (!pending.length) return;

  const remaining = [];
  for (const session of pending) {
    const { error } = await DB.saveSession(
      session.user_name,
      session.phase,
      session.exercises,
      session.session_date
    );
    if (error) remaining.push(session);
  }
  lsSet('mu_pending_sessions', remaining);
}

// ── Network listeners (registered once) ───────────────────────────────────
function initNetworkListeners() {
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

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initProfileSelection();
  initNetworkListeners();
  const savedUser = lsGet('mu_user');
  if (savedUser) {
    loadMainScreen(savedUser).catch(err => console.error('loadMainScreen failed:', err));
  } else {
    showScreen('screen-profile');
  }
});
