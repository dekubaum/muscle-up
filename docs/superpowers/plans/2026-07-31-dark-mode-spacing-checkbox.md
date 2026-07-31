# Dark Mode, Spacing Tokens & Checkbox Check-Pop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the three items deferred from an earlier UI polish pass — a checkbox check-pop
animation that can't misfire on re-renders, a named spacing-token scale, and a system-aware
dark mode with manual override.

**Architecture:** Pure CSS/HTML/JS additions to the existing static site — no build step, no
new dependencies. Spacing and dark-mode values are CSS custom properties on `:root` (matching
the existing `--radius-*`/`--shadow-*`/color token pattern). Dark mode is applied via a
`data-theme` attribute on `<html>`, set by a tiny anti-FOUC inline script and later by JS.

**Tech Stack:** Vanilla HTML/CSS/JS, `localStorage`, CSS custom properties, `@media
(prefers-color-scheme)`, CSS Grid (`grid-template-rows`) — all already used elsewhere in this
file.

## Global Constraints

- No build step, bundler, package manager, lint, or test framework exists (see `CLAUDE.md`) —
  every "verify" step below is a manual check (serving the site and clicking through, or a
  `grep`/`node --check` sanity check), not an automated test run.
- Never use `transition: all` — always list exact properties (existing house rule, already
  followed everywhere in `css/styles.css`).
- All new CSS custom properties go in the single `:root` block at the top of
  `css/styles.css:2-43`; don't introduce a second token block.
- UI-facing copy is German, matching the rest of the app.
- Do not rename existing `mu_*` localStorage keys, table/column names, or the
  `@muscleup.local` synthetic-email scheme — `CLAUDE.md` explicitly calls this out as
  intentional naming drift, not a bug.
- Reuse existing classes/patterns instead of inventing new ones where one already fits (e.g.
  the dark-mode toggle reuses `.mode-toggle`/`.mode-btn`, the checkbox pop reuses the
  `setTimeout`-based timer-guard pattern already used by `closeFeedbackModal`).

---

## Note on the committed spec

While translating [docs/superpowers/specs/2026-07-31-dark-mode-spacing-checkbox-design.md](../specs/2026-07-31-dark-mode-spacing-checkbox-design.md)
into exact file edits, a bug was found in the frequency count that produced the spec's
outlier table: it only captured the *first* value of multi-value shorthand declarations (e.g.
`padding: 13px 14px` was counted as `13px` only, silently dropping the `14px`). Re-running the
count correctly (every value in every declaration) surfaced two more real outliers the spec
missed — **`4px`** (4 occurrences, snaps to `6px`) and **`7px`** (2 occurrences, snaps to
`8px`) — plus a single-use **`11px`** second-value (`.phase-badge`'s `padding: 3px 11px`,
snapping to `12px`). The token *set* is unchanged (still `2/6/8/10/12/14/16/18/20/24/28`); only
the outlier-mapping table below is more complete than the spec's. Task 1's last step updates
the spec's table to match.

---

### Task 1: Add spacing tokens to `:root`

**Files:**
- Modify: `css/styles.css:2-43`

**Interfaces:**
- Produces: 11 custom properties — `--space-2`, `--space-6`, `--space-8`, `--space-10`,
  `--space-12`, `--space-14`, `--space-16`, `--space-18`, `--space-20`, `--space-24`,
  `--space-28` — consumed by every declaration touched in Task 2.

- [ ] **Step 1: Add the token block**

In `css/styles.css`, the `:root` block currently ends like this (lines 32-43):

```css
  /* Radius */
  --radius-card: 16px;
  --radius-btn: 12px;
  --radius-sm: 8px;
  --radius-chip: 6px;

  /* Layout */
  --topbar-h: 56px;

  /* Motion */
  --ease: cubic-bezier(0.2, 0, 0, 1);
}
```

Insert a new `/* Spacing */` block between `/* Radius */` and `/* Layout */`:

```css
  /* Radius */
  --radius-card: 16px;
  --radius-btn: 12px;
  --radius-sm: 8px;
  --radius-chip: 6px;

  /* Spacing (named by pixel value — no build step, so a direct name stays
     eyeball-verifiable against the rendered page; not an abstract 1-11 scale) */
  --space-2: 2px;
  --space-6: 6px;
  --space-8: 8px;
  --space-10: 10px;
  --space-12: 12px;
  --space-14: 14px;
  --space-16: 16px;
  --space-18: 18px;
  --space-20: 20px;
  --space-24: 24px;
  --space-28: 28px;

  /* Layout */
  --topbar-h: 56px;

  /* Motion */
  --ease: cubic-bezier(0.2, 0, 0, 1);
}
```

- [ ] **Step 2: Verify**

Run:
```bash
python3 -c "
s = open('css/styles.css').read()
print('open braces:', s.count('{'), 'close braces:', s.count('}'))
"
```
Expected: both counts equal (braces still balanced — this file has no build step, so a
mismatched brace is a silent breakage, not a build error).

- [ ] **Step 3: Update the spec's outlier table**

In `docs/superpowers/specs/2026-07-31-dark-mode-spacing-checkbox-design.md`, find the table
under "## 2. Spacing tokens" (four rows: `3px`, `9px`, `13px`, `1px`). Replace it with:

```markdown
| Value | Occurrences | Snaps to | Where |
|---|---|---|---|
| `3px` | 4 | `--space-2` (2px) | `.mode-toggle` padding, `.phase-badge`/`.lb-phase-badge` padding, `.exercise-detail` margin |
| `4px` | 4 | `--space-6` (6px) | `.auth-form h2`/`.welcome-card`/`.welcome-subtitle` margins, `.feedback-close` padding |
| `7px` | 2 | `--space-8` (8px) | `.message-new-tag`, `.fb-type`/`.fb-status` padding (second value) |
| `9px` | 4 | `--space-10` (10px) | `.plan-table th/td` padding, `.btn-announce-read`/`.fb-type-btn` padding |
| `11px` | 1 | `--space-12` (12px) | `.phase-badge` padding (second value) |
| `13px` | 3 | `--space-14` (14px) | `.auth-input` padding, `.nav-item` padding, `.post-session-bar` padding |
| `1px` | 1 | **left alone** | `.checklist-item` checkbox `margin-top: 1px` — a sub-pixel optical nudge, not layout rhythm; rounding it would visibly misalign it |
```

Also add one sentence right after the intro paragraph of that section:

```markdown
(Corrected during planning: the original frequency count only captured the first value of
multi-value shorthand declarations, missing the `4px`/`7px`/`11px` occurrences below — the
token *set* is unchanged, the outlier list is just more complete.)
```

- [ ] **Step 4: Commit**

```bash
git add css/styles.css docs/superpowers/specs/2026-07-31-dark-mode-spacing-checkbox-design.md
git commit -m "feat: add spacing token scale

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Apply spacing tokens file-wide

**Files:**
- Modify: `css/styles.css` (every padding/margin/gap declaration listed below)

**Interfaces:**
- Consumes: `--space-2` .. `--space-28` from Task 1.

Every row below is a **global find-and-replace** (`replace_all: true` if using the Edit tool) —
the exact source text always maps to the exact target text everywhere it appears in the file,
regardless of which rule it's in, so there is no ambiguity in applying these file-wide.

- [ ] **Step 1: Apply the high-frequency replacements** (each appears 2+ times)

| Find (exact) | Replace with |
|---|---|
| `gap: 10px;` | `gap: var(--space-10);` |
| `padding: 14px 16px;` | `padding: var(--space-14) var(--space-16);` |
| `margin-bottom: 10px;` | `margin-bottom: var(--space-10);` |
| `gap: 8px;` | `gap: var(--space-8);` |
| `gap: 12px;` | `gap: var(--space-12);` |
| `margin-top: 8px;` | `margin-top: var(--space-8);` |
| `margin-top: 2px;` | `margin-top: var(--space-2);` |
| `margin-bottom: 12px;` | `margin-bottom: var(--space-12);` |
| `padding: 9px 12px;` | `padding: var(--space-10) var(--space-12);` |
| `padding: 16px;` | `padding: var(--space-16);` |
| `padding: 14px;` | `padding: var(--space-14);` |
| `margin-top: 12px;` | `margin-top: var(--space-12);` |
| `margin-top: 10px;` | `margin-top: var(--space-10);` |
| `margin-bottom: 14px;` | `margin-bottom: var(--space-14);` |
| `padding: 8px 14px;` | `padding: var(--space-8) var(--space-14);` |
| `padding: 6px 14px;` | `padding: var(--space-6) var(--space-14);` |
| `padding: 2px 7px;` | `padding: var(--space-2) var(--space-8);` |
| `padding: 0 14px;` | `padding: 0 var(--space-14);` |
| `margin: 16px 0 0;` | `margin: var(--space-16) 0 0;` |
| `gap: 2px;` | `gap: var(--space-2);` |
| `gap: 14px;` | `gap: var(--space-14);` |

- [ ] **Step 2: Apply the single-occurrence replacements**

| Find (exact) | Replace with |
|---|---|
| `padding: 9px 16px;` | `padding: var(--space-10) var(--space-16);` |
| `padding: 8px;` | `padding: var(--space-8);` |
| `padding: 8px 8px 8px 14px;` | `padding: var(--space-8) var(--space-8) var(--space-8) var(--space-14);` |
| `padding: 8px 12px 6px;` | `padding: var(--space-8) var(--space-12) var(--space-6);` |
| `padding: 6px 12px;` | `padding: var(--space-6) var(--space-12);` |
| `padding: 4px 8px;` | `padding: var(--space-6) var(--space-8);` |
| `padding: 3px;` | `padding: var(--space-2);` |
| `padding: 3px 11px;` | `padding: var(--space-2) var(--space-12);` |
| `padding: 3px 10px;` | `padding: var(--space-2) var(--space-10);` |
| `padding: 24px;` | `padding: var(--space-24);` |
| `padding: 20px;` | `padding: var(--space-20);` |
| `padding: 18px;` | `padding: var(--space-18);` |
| `padding: 18px 18px 16px;` | `padding: var(--space-18) var(--space-18) var(--space-16);` |
| `padding: 13px 16px;` | `padding: var(--space-14) var(--space-16);` |
| `padding: 13px 14px;` | `padding: var(--space-14);` |
| `padding: 13px 12px;` | `padding: var(--space-14) var(--space-12);` |
| `padding: 12px 14px;` | `padding: var(--space-12) var(--space-14);` |
| `padding: 10px 0;` | `padding: var(--space-10) 0;` |
| `padding: 0 16px;` | `padding: 0 var(--space-16);` |
| `padding: 0 16px 48px;` | `padding: 0 var(--space-16) 48px;` |
| `padding: 0 16px 14px;` | `padding: 0 var(--space-16) var(--space-14);` |
| `padding-top: 14px;` | `padding-top: var(--space-14);` |
| `padding-left: 2px;` | `padding-left: var(--space-2);` |
| `margin: 8px 0 4px;` | `margin: var(--space-8) 0 var(--space-6);` |
| `margin: 0 -16px;` | `margin: 0 calc(-1 * var(--space-16));` |
| `margin-top: 6px;` | `margin-top: var(--space-6);` |
| `margin-top: 4px;` | `margin-top: var(--space-6);` |
| `margin-top: 3px;` | `margin-top: var(--space-2);` |
| `margin-top: 28px;` | `margin-top: var(--space-28);` |
| `margin-top: 20px;` | `margin-top: var(--space-20);` |
| `margin-top: 18px;` | `margin-top: var(--space-18);` |
| `margin-bottom: 8px;` | `margin-bottom: var(--space-8);` |
| `margin-bottom: 6px;` | `margin-bottom: var(--space-6);` |
| `margin-bottom: 4px;` | `margin-bottom: var(--space-6);` |
| `margin-bottom: 28px;` | `margin-bottom: var(--space-28);` |
| `margin-bottom: 16px;` | `margin-bottom: var(--space-16);` |
| `gap: 6px;` | `gap: var(--space-6);` |
| `gap: 28px;` | `gap: var(--space-28);` |

**Do NOT touch** (bespoke values, not layout rhythm — verify they're still present and
unchanged after Steps 1-2):
- `css/styles.css:276` — `margin-right: -8px;` on `.btn-menu` (optical icon nudge, already commented)
- `css/styles.css:584` — `margin-top: 1px;` on `.checklist-item input[type="checkbox"]` (optical alignment nudge)
- `css/styles.css:755` — `padding-right: 84px;` on `.password-field .auth-input` (clears the absolute-positioned show/hide button, not rhythm)
- `padding: 0;` / `margin-bottom: 0;` / `margin: 0;` (zero needs no token)
- The `48px` inside `padding: 0 var(--space-16) 48px;` from Step 2 (page-bottom scroll clearance, a deliberate one-off)

- [ ] **Step 3: Verify no raw pixel values remain among the replaced set**

Run:
```bash
grep -nE '(margin|padding|gap)(-top|-bottom|-left|-right)?\s*:\s*[0-9]' css/styles.css
```
Expected output: only the five "do NOT touch" lines above (`-8px`, `1px`, `84px`, the `48px`
one-off, and any `0`/`0;` zero values) — every other match means a spot in Steps 1-2 was
missed.

- [ ] **Step 4: Verify braces still balance**

Run:
```bash
python3 -c "
s = open('css/styles.css').read()
print('open braces:', s.count('{'), 'close braces:', s.count('}'))
"
```
Expected: equal counts (same as Task 1's check).

- [ ] **Step 5: Manual visual check**

Serve the site (`python3 -m http.server 8000`) and click through Today, Rangliste, Plan,
Settings, and Handstand mode. Nothing should look obviously broken — the 1px shifts from the
outlier snaps are intentionally subtle and not something to hunt for pixel-by-pixel.

- [ ] **Step 6: Commit**

```bash
git add css/styles.css
git commit -m "refactor: apply spacing tokens across styles.css

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Checkbox check-pop animation

**Files:**
- Modify: `css/styles.css` (new keyframe, near the existing keyframes block at the top of the file)
- Modify: `js/app.js:48-52` (new `popCheckbox` helper), and the three checkbox `change` listeners at `js/app.js:356`, `js/app.js:622`, `js/app.js:800`

**Interfaces:**
- Produces: `popCheckbox(cb)` — a JS function taking a checkbox `HTMLInputElement`, called
  only when that checkbox has just become checked. Adds/removes the CSS class `pop`.

- [ ] **Step 1: Add the CSS keyframe and reduced-motion override**

In `css/styles.css`, the reduced-motion block currently reads (lines 101-105):

```css
@media (prefers-reduced-motion: reduce) {
  .page:not(.hidden) > *,
  .page.leaving { animation: none; }
  * { transition: none !important; }
}
```

Just above it (after the `fade-out-down` keyframe, before this media query), add:

```css
/* Pop feedback when a checkbox is checked — triggered by JS (see popCheckbox in app.js),
   never by the :checked selector alone, so it can't replay on an unrelated re-render. */
@keyframes checkbox-pop {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.15); }
  100% { transform: scale(1); }
}
input[type="checkbox"].pop { animation: checkbox-pop 0.2s var(--ease); }
```

And change the reduced-motion block to also cover it:

```css
@media (prefers-reduced-motion: reduce) {
  .page:not(.hidden) > *,
  .page.leaving { animation: none; }
  input[type="checkbox"].pop { animation: none; }
  * { transition: none !important; }
}
```

- [ ] **Step 2: Add the `popCheckbox` helper**

In `js/app.js`, the "Misc helpers" section currently reads (lines 48-52):

```js
// ── Misc helpers ───────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
```

Add `popCheckbox` right after it:

```js
// ── Misc helpers ───────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Pop animation for a checkbox that was JUST checked (never on uncheck, never
// from a passive re-render — call sites only invoke this when cb.checked is
// newly true). Force a reflow before re-adding the class so a rapid re-check
// within the animation window still restarts it.
function popCheckbox(cb) {
  cb.classList.remove('pop');
  void cb.offsetWidth;
  cb.classList.add('pop');
  clearTimeout(cb._popTimer);
  cb._popTimer = setTimeout(() => cb.classList.remove('pop'), 200);
}
```

- [ ] **Step 3: Wire it into the exercise-set checkboxes**

In `js/app.js`, `renderWorkout` currently has (lines 351-363):

```js
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
```

Change the listener body to:

```js
      cb.addEventListener('change', () => {
        hidePostSessionBar();
        if (cb.checked) { state.checkedSets.add(setId); popCheckbox(cb); }
        else state.checkedSets.delete(setId);
        updateCompleteButton(phase);
      });
```

- [ ] **Step 4: Wire it into the phase-3 checklist**

In `js/app.js`, the checklist wiring currently has (lines 621-626):

```js
    content.querySelectorAll('.phase3-check').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = content.querySelectorAll('.phase3-check:checked').length;
        btn.disabled = checked < PLAN.phase3Checklist.length;
      });
    });
```

Change to:

```js
    content.querySelectorAll('.phase3-check').forEach(cb => {
      cb.addEventListener('change', () => {
        if (cb.checked) popCheckbox(cb);
        const checked = content.querySelectorAll('.phase3-check:checked').length;
        btn.disabled = checked < PLAN.phase3Checklist.length;
      });
    });
```

- [ ] **Step 5: Wire it into the handstand exercise checkboxes**

In `js/app.js`, the handstand checkbox wiring currently has (lines 799-807):

```js
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      hideHandstandBar();
      const id = cb.dataset.id;
      if (cb.checked) state.checkedHandstand.add(id);
      else state.checkedHandstand.delete(id);
      updateHandstandButton();
    });
  });
```

Change to:

```js
  list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      hideHandstandBar();
      const id = cb.dataset.id;
      if (cb.checked) { state.checkedHandstand.add(id); popCheckbox(cb); }
      else state.checkedHandstand.delete(id);
      updateHandstandButton();
    });
  });
```

- [ ] **Step 6: Verify syntax**

Run: `node --check js/app.js`
Expected: no output (exit code 0).

- [ ] **Step 7: Manual check**

Serve the site, log in, and on the Today page check an exercise set — it should pop once.
Switch tabs away and back (or trigger any re-render) while it's still checked — it must NOT
pop again. Repeat for the Phase 3 checklist (reach Phase 2's session count, or use Settings →
Fortschritt zurücksetzen to get there) and for a Handstand block's exercises.

- [ ] **Step 8: Commit**

```bash
git add css/styles.css js/app.js
git commit -m "feat: add checkbox check-pop animation

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Dark mode — palette CSS

**Files:**
- Modify: `css/styles.css`

**Interfaces:**
- Produces: dark values for every existing color/shadow token, applied under two selectors
  (`@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {...} }` and
  `:root[data-theme="dark"] {...}`) — consumed automatically by every rule in the file that
  already uses `var(--bg)`, `var(--surface)`, etc. No selector-level changes needed anywhere
  else in the file for the tokenized colors.

- [ ] **Step 1: Add the dark palette block**

In `css/styles.css`, immediately after the closing `}` of the `:root` block (after Task 1's
additions, so right after line ~55 — the exact line number shifted by Task 1's insert, find it
by searching for the `:root { ... }` block's closing brace), add:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d0f13;
    --surface: #171a20;
    --surface2: #20242c;
    --accent: #818cf8;
    --accent-hover: #6366f1;
    --accent-soft: #1e2240;
    --accent-light: #a5b4fc;
    --success: #34d399;
    --success-soft: #113224;
    --danger: #f87171;
    --danger-hover: #ef4444;
    --danger-soft: #3b1616;
    --text: #f4f4f5;
    --text-muted: #9aa0ab;
    --border: #2b2f38;
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.5);
    --shadow-md: 0 2px 6px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.55);
  }
}
:root[data-theme="dark"] {
  --bg: #0d0f13;
  --surface: #171a20;
  --surface2: #20242c;
  --accent: #818cf8;
  --accent-hover: #6366f1;
  --accent-soft: #1e2240;
  --accent-light: #a5b4fc;
  --success: #34d399;
  --success-soft: #113224;
  --danger: #f87171;
  --danger-hover: #ef4444;
  --danger-soft: #3b1616;
  --text: #f4f4f5;
  --text-muted: #9aa0ab;
  --border: #2b2f38;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.5);
  --shadow-md: 0 2px 6px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.55);
}
```

- [ ] **Step 2: Override the one non-tokenized badge color**

`.fb-type-idea` (the "Idee" feedback badge) was never pulled into a token — it's hardcoded
sky-blue. Find it in `css/styles.css`:

```css
.fb-type-idea { background: #e0f2fe; color: #0369a1; }
```

Add a dark override directly after it:

```css
.fb-type-idea { background: #e0f2fe; color: #0369a1; }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .fb-type-idea { background: #0c2a3d; color: #7dd3fc; }
}
:root[data-theme="dark"] .fb-type-idea { background: #0c2a3d; color: #7dd3fc; }
```

- [ ] **Step 3: Override the topbar's hardcoded hairline shadow**

`.topbar`'s bottom-edge shadow was never tokenized either (it's a one-off hairline, not part of
`--shadow-sm`/`--shadow-md`). Find:

```css
  background: var(--bg);
  box-shadow: 0 1px 0 rgba(16, 24, 40, 0.06);
}
```

(this is inside `.topbar`). Add a dark override right after the `.topbar` rule's closing `}`:

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) .topbar { box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08); }
}
:root[data-theme="dark"] .topbar { box-shadow: 0 1px 0 rgba(255, 255, 255, 0.08); }
```

(A dark-on-dark hairline would be invisible otherwise — this wasn't in the original design
spec's palette table since it's a hardcoded one-off outside the token system, same category as
`.fb-type-idea`.)

- [ ] **Step 4: Verify braces balance**

Run the same brace-count check as Task 1/2.

- [ ] **Step 5: Commit**

```bash
git add css/styles.css
git commit -m "feat: add dark-mode color palette

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

(No visual verification yet — nothing sets `data-theme` or responds to system dark mode until
Task 5. Verification happens at the end of Task 5.)

---

### Task 5: Dark mode — trigger, toggle UI, and JS

**Files:**
- Modify: `index.html` (anti-FOUC script in `<head>`, new Settings toggle markup)
- Modify: `js/app.js` (new `resolveTheme`/`applyTheme`/`setTheme`/`syncThemeToggle`/`initThemeToggle` functions, one new call in the init sequence)

**Interfaces:**
- Consumes: the `lsGet`/`lsSet` helpers (`js/app.js:39-46`), the `.mode-toggle`/`.mode-btn` CSS
  classes (already styled, reused verbatim — no new CSS classes needed for the toggle itself).
- Produces: a global `mu_theme` localStorage key (`'light'` | `'dark'`; absent = system
  default), and a `data-theme` attribute on `<html>` that Task 4's CSS reads.

- [ ] **Step 1: Add the anti-FOUC inline script**

In `index.html`, the `<head>` currently reads (lines 1-9):

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#f6f7f9">
  <title>Schla-Muscle-App</title>
  <link rel="stylesheet" href="css/styles.css">
</head>
```

Add the inline script right before the stylesheet `<link>`, so it runs before CSS paints:

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="theme-color" content="#f6f7f9">
  <title>Schla-Muscle-App</title>
  <script>
    (function () {
      try {
        var t = JSON.parse(localStorage.getItem('mu_theme'));
        if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
      } catch (e) {}
    })();
  </script>
  <link rel="stylesheet" href="css/styles.css">
</head>
```

(`mu_theme` is stored JSON-encoded because it's read/written via the existing `lsGet`/`lsSet`
helpers in `app.js`, which `JSON.stringify`/`JSON.parse` — this inline script mirrors that
encoding so a value written by `lsSet('mu_theme', 'dark')` reads back correctly here, before
`app.js` has even loaded.)

- [ ] **Step 2: Add the Settings toggle markup**

In `index.html`, `#page-settings` currently starts (lines 166-169):

```html
      <section id="page-settings" class="page hidden">

        <div class="section">
          <h3 class="section-title">Name ändern</h3>
```

Insert a new section before "Name ändern":

```html
      <section id="page-settings" class="page hidden">

        <div class="section">
          <h3 class="section-title">Erscheinungsbild</h3>
          <div class="mode-toggle" role="tablist" aria-label="Farbschema">
            <button type="button" class="mode-btn" data-theme-choice="system" role="tab" aria-selected="false">System</button>
            <button type="button" class="mode-btn" data-theme-choice="light" role="tab" aria-selected="false">Hell</button>
            <button type="button" class="mode-btn" data-theme-choice="dark" role="tab" aria-selected="false">Dunkel</button>
          </div>
        </div>

        <div class="section">
          <h3 class="section-title">Name ändern</h3>
```

No `active`/`aria-selected="true"` is hardcoded on any button — which one starts active depends
on the stored preference at runtime, set by JS in Step 3, not by static markup.

- [ ] **Step 3: Add the theme functions to `js/app.js`**

Add these functions right after `syncModeToggle` (`js/app.js:270-276`, which currently ends
with):

```js
function syncModeToggle() {
  document.querySelectorAll('.mode-btn[data-mode]').forEach(btn => {
    const on = btn.dataset.mode === state.mode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}
```

Insert after it:

```js
// ── Theme (light/dark/system) ───────────────────────────────────────────────
function resolveTheme() {
  const stored = lsGet('mu_theme');
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

function applyTheme() {
  const choice = resolveTheme();
  if (choice === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', choice);

  const isDark = choice === 'dark' ||
    (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark ? '#0d0f13' : '#f6f7f9');

  syncThemeToggle(choice);
}

function setTheme(choice) {
  if (choice === 'system') localStorage.removeItem('mu_theme');
  else lsSet('mu_theme', choice);
  applyTheme();
}

function syncThemeToggle(choice) {
  document.querySelectorAll('.mode-btn[data-theme-choice]').forEach(btn => {
    const on = btn.dataset.themeChoice === choice;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function initThemeToggle() {
  document.querySelectorAll('.mode-btn[data-theme-choice]').forEach(btn =>
    btn.addEventListener('click', () => setTheme(btn.dataset.themeChoice)));
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (resolveTheme() === 'system') applyTheme();
  });
}
```

(`.mode-btn[data-theme-choice]` and `.mode-btn[data-mode]` are disjoint attribute selectors, so
this shares the existing `.mode-toggle`/`.mode-btn` CSS with zero collision against `setMode`/
`syncModeToggle`, which only ever query `[data-mode]`.)

- [ ] **Step 4: Call `initThemeToggle` on load**

In `js/app.js`, the init sequence currently reads (lines 1788-1794):

```js
document.addEventListener('DOMContentLoaded', async () => {
  initAuthScreen();
  initNetworkListeners();
  initLogout();
  initNav();
  initSettings();
  initFeedback();
```

Add the new call:

```js
document.addEventListener('DOMContentLoaded', async () => {
  initAuthScreen();
  initNetworkListeners();
  initLogout();
  initNav();
  initSettings();
  initFeedback();
  initThemeToggle();
```

- [ ] **Step 5: Verify syntax**

Run: `node --check js/app.js`
Expected: no output (exit code 0).

- [ ] **Step 6: Verify HTML tag balance**

Run:
```bash
python3 -c "
import re
html = open('index.html').read()
print('div open:', len(re.findall(r'<div\b', html)), 'div close:', len(re.findall(r'</div>', html)))
"
```
Expected: equal counts.

- [ ] **Step 7: Manual verification — system default**

Set the OS/browser to dark mode (no manual override yet — `mu_theme` unset). Load the app
fresh, including the auth screen before logging in. It should render dark immediately, with no
flash of the light theme. Confirm in Settings the toggle shows "System" active.

- [ ] **Step 8: Manual verification — manual override**

In Settings, click "Hell" while the system is set to dark — the app should switch to light
immediately and stay light on reload. Click "Dunkel" while the system is set to light — same,
reversed. Click "System" to go back to following the OS setting.

- [ ] **Step 9: Manual verification — specific surfaces**

With dark mode active, check: the auth screen, the feedback modal (open it), the feedback
inbox's "Idee" badge (Settings → Feedback, as an admin, if there's a submission with that
type), and the topbar's bottom hairline while scrolled (should be faintly visible, not
invisible).

- [ ] **Step 10: Commit**

```bash
git add index.html js/app.js
git commit -m "feat: add dark mode toggle (system + manual override)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Static checks**

```bash
node --check js/app.js
python3 -c "
s = open('css/styles.css').read()
print('css braces:', s.count('{'), s.count('}'))
import re
html = open('index.html').read()
print('html div tags:', len(re.findall(r'<div\b', html)), len(re.findall(r'</div>', html)))
"
```
Expected: `node --check` silent; both count pairs equal.

- [ ] **Step 2: Full manual click-through**

Serve the site and, in both light and dark mode (toggle in Settings), walk through: login,
Today (check exercises, complete a session, undo/repeat), Rangliste, Plan, Handstand mode (all
three tabs), Settings (name change, password change, the new Erscheinungsbild toggle, messages,
feedback modal, admin inbox if applicable, progress reset). Confirm nothing from the earlier
polish pass regressed (exit animations, focus rings, hit areas, the progress-bar glow).

- [ ] **Step 3: Check the browser console**

No errors after any of the above interactions.

- [ ] **Step 4: Final commit (only if Step 2 turned up fixes)**

If verification surfaces anything to fix, fix it, then:
```bash
git add -A
git commit -m "fix: address issues found in final verification pass

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
If nothing needed fixing, skip this commit — the plan is done.
