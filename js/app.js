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

// ── Placeholder for loadMainScreen (implemented in 7b) ────────────────────
async function loadMainScreen(userName) {
  state.userName = userName;
  state.partnerName = userName === 'dennis' ? 'clemens' : 'dennis';
  showScreen('screen-main');
  // Phase banner, workout, partner card etc. added in next steps
}

// ── Stubs (replaced in subsequent steps) ──────────────────────────────────
function renderWorkout() {}
function renderPlanReference() {}
function checkPhaseTransition() {}
async function renderPartnerCard() {}
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
