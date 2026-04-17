# Muscle Up Trainingsplan App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a mobile-friendly vanilla JS web app for Dennis & Clemens to track their Muscle Up training plan and see each other's progress in real-time via Supabase.

**Architecture:** Static HTML/CSS/JS app (no build step, no framework). Supabase provides the Postgres database and real-time subscriptions. `localStorage` is written first on every session save and serves as the offline fallback; Supabase is the shared sync layer. The app is split into focused global objects: `PLAN` (data), `DB` (database), `Sync` (real-time), and `App` (UI + logic).

**Tech Stack:** HTML5, CSS3, Vanilla JS (ES2020), Supabase JS SDK v2 (CDN), Supabase (hosted Postgres + Realtime)

---

## File Map

| File | Purpose |
| --- | --- |
| `index.html` | App shell, screen markup, script includes |
| `css/styles.css` | All styles — mobile-first dark theme |
| `js/data.js` | Hardcoded training plan data (`window.PLAN`) |
| `js/db.js` | Supabase client + all DB read/write functions (`window.DB`) |
| `js/sync.js` | Real-time subscription helper (`window.Sync`) |
| `js/app.js` | All UI logic — state, rendering, session flow, phase progression |
| `supabase/schema.sql` | SQL to run once in Supabase SQL editor |

---

## Task 1: Project Scaffold + Supabase Schema

**Files:**
- Create: `index.html`
- Create: `css/styles.css` (empty)
- Create: `js/data.js` (empty)
- Create: `js/db.js` (empty)
- Create: `js/sync.js` (empty)
- Create: `js/app.js` (empty)
- Create: `supabase/schema.sql`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p css js supabase
touch index.html css/styles.css js/data.js js/db.js js/sync.js js/app.js
```

- [ ] **Step 2: Write supabase/schema.sql**

```sql
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
```

- [ ] **Step 3: Commit**

```bash
git init
git add .
git commit -m "chore: project scaffold and supabase schema"
```

---

## Task 2: Training Plan Data

**Files:**
- Write: `js/data.js`

- [ ] **Step 1: Write js/data.js**

```javascript
// js/data.js
window.PLAN = {
  phases: [
    {
      number: 1,
      name: 'Phase 1 – Explosive Kraft & Körperbewusstsein',
      weeks: '1–3',
      totalSessions: 6,
      exercises: [
        { id: 'explosive-pullups',  name: 'Explosive Pull-Ups',              sets: 4, reps: '5',       focus: 'So hoch wie möglich, Brust zur Stange' },
        { id: 'chest-to-bar',       name: 'Chest-to-Bar Pull-Ups (mit Band)', sets: 3, reps: '6–8',    focus: 'Stange bis zur Brust' },
        { id: 'dips',               name: 'Dips (langsam, kontrolliert)',     sets: 4, reps: '8',       focus: 'Basis für die Push-Phase' },
        { id: 'hollow-body',        name: 'Hollow Body Hold',                sets: 3, reps: '20 Sek.', focus: 'Ganzkörperspannung' },
        { id: 'scapular-pullups',   name: 'Scapular Pull-Ups',               sets: 3, reps: '10',      focus: 'Schulterblatt-Kontrolle' },
      ],
    },
    {
      number: 2,
      name: 'Phase 2 – Transition trainieren',
      weeks: '4–6',
      totalSessions: 6,
      exercises: [
        { id: 'band-muscle-up',    name: 'Band-Assisted Muscle Up',         sets: 4, reps: '4–5',    focus: 'Bewegungsablauf kennenlernen' },
        { id: 'negative-muscle-up', name: 'Negative Muscle Ups',            sets: 3, reps: '3–4',    focus: 'Langsam absenken (3–5 Sek.)' },
        { id: 'jump-muscle-up',    name: 'Jump Muscle Up (Sprungstart)',     sets: 3, reps: '3',      focus: 'Transition spüren' },
        { id: 'weighted-dips',     name: 'Dips (gewichtet oder langsam)',    sets: 3, reps: '8',      focus: 'Push-Phase stärken' },
        { id: 'l-sit',             name: 'L-Sit Hold',                      sets: 3, reps: '15 Sek.', focus: 'Körperspannung, Hüftbeuger' },
      ],
    },
    {
      number: 3,
      name: 'Phase 3 – Erster Muscle Up',
      weeks: '7–10',
      totalSessions: 8,
      exercises: [
        { id: 'muscle-up-attempts',       name: 'Muscle Up Versuche (unassisted)',    sets: 1, reps: '5–6 Versuche', focus: 'Volle Erholung (2–3 Min.) zwischen Versuchen' },
        { id: 'band-muscle-up-finisher',  name: 'Band-Assisted Muscle Up (Finisher)', sets: 2, reps: '3',           focus: 'Wenn Versuche scheitern' },
        { id: 'explosive-pullups-p3',     name: 'Explosive Pull-Ups',                sets: 3, reps: '4',            focus: 'Kraft erhalten' },
        { id: 'dips-p3',                  name: 'Dips',                              sets: 3, reps: '10',           focus: 'Push-Phase stabil halten' },
        { id: 'ring-rows',                name: 'Ring Rows oder Rudern',             sets: 3, reps: '10',           focus: 'Rücken ausbalancieren' },
      ],
    },
  ],
  phase3Checklist: [
    '3 saubere Chest-to-Bar Pull-Ups ohne Band',
    '1–2 Negative Muscle Ups mit Kontrolle (mind. 3 Sek. Absenkzeit)',
    'Explosive Pull-Ups erreichen konstant Kinnhöhe über der Stange',
  ],
};
```

- [ ] **Step 2: Verify in browser console**

Serve the project locally:
```bash
python3 -m http.server 8080
```
Open `http://localhost:8080`. Open DevTools → Console. Run:
```javascript
console.log(PLAN.phases.length); // expected: 3
console.log(PLAN.phases[0].exercises.length); // expected: 5
console.log(PLAN.phase3Checklist.length); // expected: 3
```

- [ ] **Step 3: Commit**

```bash
git add js/data.js
git commit -m "feat: add training plan data"
```

---

## Task 3: Supabase DB Client

**Files:**
- Write: `js/db.js`

- [ ] **Step 1: Create a Supabase project**

Go to https://supabase.com, create a free project. Note the **Project URL** and **anon public key** from Settings → API.

Run `supabase/schema.sql` in the Supabase SQL Editor (Database → SQL Editor → New Query, paste and run).

- [ ] **Step 2: Write js/db.js**

Replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY` with your actual values.

```javascript
// js/db.js
window.DB = (() => {
  const SUPABASE_URL = 'YOUR_SUPABASE_URL';
  const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

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
      .select('*', { count: 'exact', head: true })
      .eq('user_name', userName)
      .eq('phase', phase);
  }

  async function saveSession(userName, phase, exercises) {
    return client
      .from('sessions')
      .insert({
        user_name: userName,
        phase,
        session_date: new Date().toISOString().split('T')[0],
        exercises,
      });
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

  return { client, getProfile, upsertProfile, getSessionCount, saveSession, getLatestPartnerSession };
})();
```

- [ ] **Step 3: Verify DB connection in browser console**

With the local server running, open DevTools → Console:
```javascript
// Should resolve with { data: null, error: null } (no profile yet)
DB.getProfile('dennis').then(r => console.log(r));
```
Expected: `{ data: null, error: null }`

If you see a network error, double-check your Supabase URL and anon key.

- [ ] **Step 4: Commit**

```bash
git add js/db.js
git commit -m "feat: add supabase db client"
```

---

## Task 4: Real-Time Sync Module

**Files:**
- Write: `js/sync.js`

- [ ] **Step 1: Write js/sync.js**

```javascript
// js/sync.js
window.Sync = (() => {
  let channel = null;

  function subscribeToPartner(partnerName, onNewSession) {
    channel = DB.client
      .channel('partner-sessions')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'sessions',
          filter: `user_name=eq.${partnerName}`,
        },
        (payload) => onNewSession(payload.new)
      )
      .subscribe();
    return channel;
  }

  function unsubscribe() {
    if (channel) {
      DB.client.removeChannel(channel);
      channel = null;
    }
  }

  return { subscribeToPartner, unsubscribe };
})();
```

- [ ] **Step 2: Commit**

```bash
git add js/sync.js
git commit -m "feat: add real-time sync module"
```

---

## Task 5: Styles

**Files:**
- Write: `css/styles.css`

- [ ] **Step 1: Write css/styles.css**

```css
/* css/styles.css */
:root {
  --bg: #0f0f1a;
  --surface: #1a1a2e;
  --surface2: #16213e;
  --accent: #4f46e5;
  --accent-light: #818cf8;
  --success: #22c55e;
  --text: #e2e8f0;
  --text-muted: #94a3b8;
  --border: #2a2a4a;
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 16px;
  line-height: 1.5;
  max-width: 480px;
  margin: 0 auto;
  padding: 0 16px 48px;
}

.hidden { display: none !important; }

/* ── Profile Selection ── */
#screen-profile {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
}

.profile-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 32px;
  text-align: center;
}

.profile-container h1 {
  font-size: 2rem;
  font-weight: 800;
  letter-spacing: -1px;
}

.profile-container p {
  color: var(--text-muted);
}

.profile-buttons {
  display: flex;
  gap: 16px;
}

.btn-profile {
  background: var(--surface);
  border: 2px solid var(--border);
  color: var(--text);
  font-size: 1.2rem;
  font-weight: 700;
  padding: 20px 40px;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, transform 0.1s;
}

.btn-profile:hover { background: var(--surface2); border-color: var(--accent); }
.btn-profile:active { transform: scale(0.97); }

/* ── Phase Banner ── */
.phase-banner {
  background: var(--surface);
  border-radius: 14px;
  padding: 16px;
  margin: 16px 0 0;
}

.phase-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.phase-info .phase-label { font-weight: 700; font-size: 1rem; }

.phase-badge {
  background: var(--accent);
  color: #fff;
  padding: 2px 10px;
  border-radius: 99px;
  font-size: 0.78rem;
  font-weight: 600;
}

.progress-bar { background: var(--border); border-radius: 99px; height: 6px; }

.progress-fill {
  background: var(--accent);
  border-radius: 99px;
  height: 6px;
  width: 0;
  transition: width 0.4s ease;
}

/* ── Section ── */
.section { margin-top: 28px; }

.section-title {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: var(--text-muted);
  margin-bottom: 12px;
}

/* ── Exercise List ── */
.exercise-row {
  background: var(--surface);
  border-radius: 12px;
  padding: 12px 14px;
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.exercise-info { flex: 1; }
.exercise-name { font-size: 0.95rem; font-weight: 500; }
.exercise-detail { font-size: 0.8rem; color: var(--text-muted); margin-top: 2px; }

.exercise-checkboxes { display: flex; gap: 10px; flex-shrink: 0; }

.exercise-checkboxes input[type="checkbox"] {
  width: 24px;
  height: 24px;
  accent-color: var(--accent);
  cursor: pointer;
}

.btn-complete {
  width: 100%;
  margin-top: 16px;
  padding: 15px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 1rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
}

.btn-complete:disabled { opacity: 0.35; cursor: not-allowed; }
.btn-complete:not(:disabled):hover { opacity: 0.9; }
.btn-complete:not(:disabled):active { transform: scale(0.98); }

/* ── Phase Transition Banner ── */
.phase-transition {
  margin-top: 20px;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 14px;
  padding: 18px;
}

.phase-transition h3 { font-size: 1.05rem; margin-bottom: 6px; }
.phase-transition p { font-size: 0.9rem; color: var(--text-muted); margin-bottom: 12px; }

.checklist { display: flex; flex-direction: column; gap: 10px; margin-bottom: 14px; }

.checklist-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 0.9rem;
  cursor: pointer;
  line-height: 1.4;
}

.checklist-item input[type="checkbox"] {
  width: 20px;
  height: 20px;
  accent-color: var(--success);
  flex-shrink: 0;
  margin-top: 1px;
  cursor: pointer;
}

.btn-advance {
  width: 100%;
  padding: 13px;
  background: var(--success);
  color: #fff;
  border: none;
  border-radius: 12px;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.15s;
}

.btn-advance:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── Partner Card ── */
.partner-card {
  background: var(--surface);
  border-radius: 12px;
  padding: 14px 16px;
}

.partner-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.partner-name { font-weight: 700; font-size: 0.95rem; }

.partner-phase-badge {
  font-size: 0.78rem;
  background: var(--surface2);
  color: var(--accent-light);
  padding: 2px 8px;
  border-radius: 99px;
}

.partner-detail { font-size: 0.85rem; color: var(--text-muted); }
.offline-text { color: var(--text-muted); font-style: italic; font-size: 0.9rem; }
.no-data-text { color: var(--text-muted); font-size: 0.9rem; }

/* ── Plan Reference ── */
.plan-phase { margin-bottom: 28px; opacity: 0.5; transition: opacity 0.2s; }
.plan-phase.active { opacity: 1; }

.plan-phase-title {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--accent-light);
  margin-bottom: 10px;
}

.plan-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; }

.plan-table th {
  text-align: left;
  color: var(--text-muted);
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  font-weight: 500;
}

.plan-table td {
  padding: 7px 8px;
  border-bottom: 1px solid var(--border);
  vertical-align: top;
}

.plan-table tr:last-child td { border-bottom: none; }
```

- [ ] **Step 2: Commit**

```bash
git add css/styles.css
git commit -m "feat: add app styles"
```

---

## Task 6: HTML Structure

**Files:**
- Write: `index.html`

- [ ] **Step 1: Write index.html**

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Muscle Up</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
<body>

  <!-- ── Profile Selection Screen ── -->
  <div id="screen-profile" class="hidden">
    <div class="profile-container">
      <h1>Muscle Up</h1>
      <p>Wer bist du?</p>
      <div class="profile-buttons">
        <button class="btn-profile" data-user="dennis">Dennis</button>
        <button class="btn-profile" data-user="clemens">Clemens</button>
      </div>
    </div>
  </div>

  <!-- ── Main Screen ── -->
  <div id="screen-main" class="hidden">

    <!-- Phase Banner -->
    <div id="phase-banner" class="phase-banner">
      <div class="phase-info">
        <span id="phase-label" class="phase-label"></span>
        <span id="phase-badge" class="phase-badge"></span>
      </div>
      <div class="progress-bar">
        <div id="progress-fill" class="progress-fill"></div>
      </div>
    </div>

    <!-- Today's Workout -->
    <div class="section">
      <div class="section-title">Heutige Einheit</div>
      <div id="exercise-list"></div>
      <button id="btn-complete" class="btn-complete" disabled>Session abschließen</button>
    </div>

    <!-- Phase Transition Banner (hidden until triggered) -->
    <div id="phase-transition" class="phase-transition hidden">
      <div id="phase-transition-content"></div>
      <button id="btn-advance-phase" class="btn-advance" disabled>Jetzt wechseln</button>
    </div>

    <!-- Partner Card -->
    <div class="section">
      <div class="section-title">Partner</div>
      <div id="partner-card" class="partner-card">
        <p class="no-data-text">Lade...</p>
      </div>
    </div>

    <!-- Plan Reference -->
    <div class="section">
      <div class="section-title">Trainingsplan</div>
      <div id="plan-reference"></div>
    </div>

  </div>

  <!-- Scripts — order matters: supabase → data → db → sync → app -->
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script src="js/data.js"></script>
  <script src="js/db.js"></script>
  <script src="js/sync.js"></script>
  <script src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verify the HTML structure loads**

Refresh `http://localhost:8080`. Both screens should be hidden (blank page — that's correct, `app.js` is still empty).

Open DevTools → Elements. Confirm `#screen-profile` and `#screen-main` both exist with class `hidden`.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add html structure"
```

---

## Task 7: App Logic

**Files:**
- Write: `js/app.js`

This task implements the complete app in one file. Follow the sub-steps to build and verify incrementally. Each step appends to `js/app.js` — do NOT start a new file.

### Step 7a: Helpers + profile selection

- [ ] **Write the initial js/app.js**

```javascript
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
```

- [ ] **Verify: profile selection screen**

Refresh `http://localhost:8080`. You should see the profile selection screen with "Dennis" and "Clemens" buttons. Click "Dennis". The main screen should appear (currently blank). Refresh — main screen appears immediately (localStorage has the saved user).

Open DevTools → Application → Local Storage → `http://localhost:8080`. Confirm `mu_user` = `"dennis"`.

To reset back to profile screen: run `localStorage.clear()` in the console and refresh.

- [ ] **Commit**

```bash
git add js/app.js
git commit -m "feat: profile selection and screen routing"
```

### Step 7b: Phase banner

- [ ] **Replace loadMainScreen and add renderPhaseBanner**

Replace the `loadMainScreen` placeholder and add `renderPhaseBanner`. Paste these functions, replacing the existing `loadMainScreen` block:

```javascript
// ── Main screen loader ─────────────────────────────────────────────────────
async function loadMainScreen(userName) {
  state.userName = userName;
  state.partnerName = userName === 'dennis' ? 'clemens' : 'dennis';
  showScreen('screen-main');

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
  const week = Math.min(Math.floor(state.sessionCount / 2) + 1, parseInt(phase.weeks.split('–')[1]));

  document.getElementById('phase-label').textContent =
    `Phase ${phase.number} · Woche ${week}`;
  document.getElementById('phase-badge').textContent =
    `${state.sessionCount}/${phase.totalSessions} Sessions`;

  const pct = Math.min((state.sessionCount / phase.totalSessions) * 100, 100);
  document.getElementById('progress-fill').style.width = `${pct}%`;
}
```

Add stubs for functions called but not yet implemented (put these at the bottom of the file, before the `DOMContentLoaded` listener):

```javascript
// ── Stubs (replaced in subsequent steps) ──────────────────────────────────
function renderWorkout() {}
function renderPlanReference() {}
function checkPhaseTransition() {}
async function renderPartnerCard() {}
function renderPartnerCardFromSession() {}
function retryPendingSessions() {}
```

- [ ] **Verify: phase banner loads**

Refresh `http://localhost:8080`. After profile is selected (or auto-loaded from localStorage), the phase banner should appear showing "Phase 1 · Woche 1" and "0/6 Sessions" with an empty progress bar.

Open DevTools → Network. Confirm two Supabase requests completed (profiles + sessions count).

- [ ] **Commit**

```bash
git add js/app.js
git commit -m "feat: phase banner with supabase session count"
```

### Step 7c: Workout list + session completion

- [ ] **Replace the renderWorkout stub**

Remove the `function renderWorkout() {}` stub and replace with:

```javascript
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
      const id = `${exercise.id}-${i}`;
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.id = id;
      cb.addEventListener('change', () => {
        if (cb.checked) state.checkedSets.add(id);
        else state.checkedSets.delete(id);
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
```

- [ ] **Verify: workout + completion**

Refresh the app. You should see all 5 Phase 1 exercises listed with checkboxes. The "Session abschließen" button is disabled.

Check at least one checkbox per exercise — the button should become enabled. Click the button. Confirm in DevTools → Network that a POST to Supabase `/sessions` returned a 201.

Confirm the session count in the phase banner increments to "1/6 Sessions".

- [ ] **Commit**

```bash
git add js/app.js
git commit -m "feat: workout list and session completion"
```

### Step 7d: Partner card + real-time updates

- [ ] **Replace the renderPartnerCard and renderPartnerCardFromSession stubs**

Remove both stubs and replace with:

```javascript
// ── Partner card ───────────────────────────────────────────────────────────
async function renderPartnerCard() {
  const card = document.getElementById('partner-card');

  if (!state.isOnline) {
    card.innerHTML = '<p class="offline-text">Offline</p>';
    return;
  }

  const { data: session } = await DB.getLatestPartnerSession(state.partnerName);

  if (!session) {
    const name = state.partnerName === 'dennis' ? 'Dennis' : 'Clemens';
    card.innerHTML = `<p class="no-data-text">${name} hat noch keine Session.</p>`;
    return;
  }

  renderPartnerCardFromSession(session);
}

function renderPartnerCardFromSession(session) {
  const name = session.user_name === 'dennis' ? 'Dennis' : 'Clemens';
  const setsCount = Array.isArray(session.exercises) ? session.exercises.length : 0;
  const elapsed = timeAgo(session.created_at);

  document.getElementById('partner-card').innerHTML = `
    <div class="partner-info">
      <span class="partner-name">${name}</span>
      <span class="partner-phase-badge">Phase ${session.phase}</span>
    </div>
    <div class="partner-detail">${setsCount} Sätze · ${elapsed}</div>
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
```

- [ ] **Verify: partner card + real-time**

Open two browser tabs at `http://localhost:8080`.
- Tab 1: select "Dennis"
- Tab 2: select "Clemens" (clear localStorage first in that tab via console: `localStorage.removeItem('mu_user')` then refresh)

In Tab 2 (Clemens): check off all exercises and complete a session. In Tab 1 (Dennis): the partner card should update within a few seconds showing Clemens' session — no page refresh needed.

- [ ] **Commit**

```bash
git add js/app.js
git commit -m "feat: partner card with real-time updates"
```

### Step 7e: Plan reference

- [ ] **Replace the renderPlanReference stub**

```javascript
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
```

- [ ] **Verify: plan reference**

Scroll to the bottom of the main screen. All three phases should be listed as tables. Phase 1 should be fully opaque (active); Phases 2 and 3 should be dimmed.

- [ ] **Commit**

```bash
git add js/app.js
git commit -m "feat: plan reference section"
```

### Step 7f: Phase transition

- [ ] **Replace the checkPhaseTransition stub**

```javascript
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
}

async function advancePhase() {
  state.currentPhase++;
  state.sessionCount = 0;

  lsSet(`mu_phase_${state.userName}`, state.currentPhase);
  await DB.upsertProfile(state.userName, state.currentPhase);

  document.getElementById('phase-transition').classList.add('hidden');
  renderPhaseBanner();
  renderWorkout();
  renderPlanReference();
}
```

- [ ] **Verify: phase 1 → 2 transition**

Open DevTools → Console. Temporarily override session count to trigger the banner:
```javascript
state.sessionCount = 6;
checkPhaseTransition();
```
Expected: the "Bereit für Phase 2?" banner appears with the "Jetzt wechseln" button enabled. Click it — the banner disappears, the phase banner updates to "Phase 2", and workout shows Phase 2 exercises.

- [ ] **Verify: phase 2 → 3 checklist gate**

```javascript
state.currentPhase = 2;
state.sessionCount = 6;
checkPhaseTransition();
```
Expected: "Bereit für Phase 3?" banner with 3 checkboxes. "Jetzt wechseln" is disabled. Tick all 3 checkboxes — button becomes enabled. Click — advances to Phase 3.

- [ ] **Commit**

```bash
git add js/app.js
git commit -m "feat: phase transition with phase 2→3 checklist gate"
```

### Step 7g: Offline handling + pending session retry

- [ ] **Replace the retryPendingSessions stub**

```javascript
// ── Offline / pending session retry ────────────────────────────────────────
async function retryPendingSessions() {
  const pending = lsGet('mu_pending_sessions') || [];
  if (!pending.length) return;

  const remaining = [];
  for (const session of pending) {
    const { error } = await DB.saveSession(
      session.user_name,
      session.phase,
      session.exercises
    );
    if (error) remaining.push(session);
  }
  lsSet('mu_pending_sessions', remaining);
}
```

- [ ] **Verify: offline session save**

In DevTools → Network, click the "No throttling" dropdown → select "Offline". Complete a session in the app. In DevTools → Application → Local Storage, confirm `mu_pending_sessions` contains the session.

Switch network back to "Online". The online event listener fires `retryPendingSessions()`. Confirm in Network tab that a POST to Supabase succeeds and `mu_pending_sessions` in localStorage is cleared.

- [ ] **Final end-to-end verification**

1. Clear localStorage, refresh, select a profile — profile screen appears, then main screen loads
2. Check off exercises — button activates only when all exercises have at least one set checked
3. Complete session — count increments, checkboxes reset
4. Open second tab as the other user — partner card updates in real-time
5. Scroll down — full plan visible with current phase highlighted

- [ ] **Commit**

```bash
git add js/app.js
git commit -m "feat: offline session save with retry on reconnect"
```

---

## Task 8: Deployment (Optional)

**Files:** None (hosting config only)

- [ ] **Option A: GitHub Pages**

```bash
git remote add origin https://github.com/YOUR_USERNAME/muscle-up-app.git
git push -u origin main
```

In GitHub repo → Settings → Pages → Source: `main` branch, `/ (root)`. The app is live at `https://YOUR_USERNAME.github.io/muscle-up-app/`.

- [ ] **Option B: Netlify**

Drag the project folder into https://app.netlify.com/drop. The app is live immediately at a generated URL.

Both options: share the URL with the other user. No server to maintain.

---

## Spec Coverage Checklist

| Requirement | Implemented in |
| --- | --- |
| Vanilla HTML/CSS/JS, no build step | Task 1, 5, 6 |
| Supabase Postgres + real-time | Task 3, 4 |
| Profile selection (Dennis / Clemens) | Task 7a |
| Profile stored in localStorage | Task 7a |
| Phase banner with progress | Task 7b |
| Exercise checkboxes per set | Task 7c |
| "Session abschließen" — all exercises must have ≥1 set checked | Task 7c |
| Session saved to Supabase + localStorage | Task 7c |
| Partner card with real-time updates | Task 7d |
| Partner card shows "Offline" when disconnected | Task 7d + 7g |
| Full plan reference below partner card | Task 7e |
| Phase 1→2 transition after 6 sessions | Task 7f |
| Phase 2→3 checklist gate | Task 7f |
| Phase stored in Supabase `profiles` table | Task 7b, 7f |
| Offline: localStorage-first write, retry on reconnect | Task 7g |
