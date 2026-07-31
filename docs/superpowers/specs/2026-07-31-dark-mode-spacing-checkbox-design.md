# Dark mode, spacing tokens & checkbox check-pop — Design Spec

**Date:** 2026-07-31

---

## Overview

Follow-up to a UI polish pass (design tokens, focus states, exit animations — already shipped)
that deliberately deferred three items as out of scope. This spec covers those three:

1. A checkbox check-pop animation that can't misfire on unrelated re-renders.
2. A named spacing-token scale, replacing the file's hand-tuned pixel values.
3. Dark mode: system-driven by default, with a manual override.

All three are CSS/HTML/JS-only changes to the existing static site (`css/styles.css`,
`index.html`, `js/app.js`) — no build step, no new dependencies, consistent with the rest of
the app.

---

## 1. Checkbox check-pop animation

**Problem:** a pure `:checked` CSS selector can't distinguish "just checked by the user" from
"already checked, element re-rendered" — a CSS-only `animation` on `:checked` would replay on
every unrelated re-render of a checkbox that happens to already be checked.

**Design:** move the trigger to JS. Wherever exercise/checklist checkboxes are wired up (the
existing `change` listeners in `app.js`), add a short-lived `.pop` class the moment a checkbox
transitions to checked, and remove it after the animation completes (~200ms, via `setTimeout`,
mirroring the timer-guard pattern already used for the feedback modal's close animation). The
CSS keyframe (`scale(1) → scale(1.15) → scale(1)`) only ever plays when JS adds `.pop` — never
from the `:checked` selector alone, so it can't replay on a passive re-render. No animation on
uncheck.

---

## 2. Spacing tokens

**Problem:** ~130 padding/margin/gap declarations use hand-picked pixel values. Auditing them
by frequency shows the file already follows a fine, mostly-even 2px-step rhythm (2, 6, 8, 10,
12, 14, 16, 18, 20, 24, 28 — each used multiple times, clearly intentional), not scattered
noise. Seven values don't fit that rhythm: six get snapped to their nearest established rung,
and one (a sub-pixel optical nudge) is deliberately left alone.

(Corrected during planning: the original frequency count only captured the first value of
multi-value shorthand declarations, missing the `4px`/`7px`/`11px` occurrences below — the
token *set* is unchanged, the outlier list is just more complete.)

**Design:** name the 11 real, multiply-used values as tokens (`--space-2` through
`--space-28`, named directly by pixel value — no abstract 1–11 ordinal, since this file has
no build step and direct names are easier to eyeball-verify):

```
--space-2:  2px;
--space-6:  6px;
--space-8:  8px;
--space-10: 10px;
--space-12: 12px;
--space-14: 14px;
--space-16: 16px;
--space-18: 18px;
--space-20: 20px;
--space-24: 24px;
--space-28: 28px;
```

Snap the six outliers to their nearest established rung. Most shifts are exactly 1px, except
`4px` → `--space-6` (6px) which shifts by 2px (18 total occurrences across all six values):

| Value | Occurrences | Snaps to | Where |
|---|---|---|---|
| `3px` | 4 | `--space-2` (2px) | `.mode-toggle` padding, `.phase-badge`/`.lb-phase-badge` padding, `.exercise-detail` margin |
| `4px` | 4 | `--space-6` (6px) | `.auth-form h2`/`.welcome-card`/`.welcome-subtitle` margins, `.feedback-close` padding |
| `7px` | 2 | `--space-8` (8px) | `.message-new-tag`, `.fb-type`/`.fb-status` padding (second value) |
| `9px` | 4 | `--space-10` (10px) | `.plan-table th/td` padding, `.btn-announce-read`/`.fb-type-btn` padding |
| `11px` | 1 | `--space-12` (12px) | `.phase-badge` padding (second value) |
| `13px` | 3 | `--space-14` (14px) | `.auth-input` padding, `.nav-item` padding, `.post-session-bar` padding |
| `1px` | 1 | **left alone** | `.checklist-item` checkbox `margin-top: 1px` — a sub-pixel optical nudge, not layout rhythm; rounding it would visibly misalign it |

**Explicitly excluded from tokenization** (bespoke values, not layout rhythm — keep their
existing comments): the `-8px` optical icon nudge on `.btn-menu`, and the `::before` hit-area
`inset` values (`-8px -3px`, `-5px -3px`, `-10px`) added in the prior polish pass.

---

## 3. Dark mode

**Trigger:** system preference by default (`prefers-color-scheme: dark`), with a manual
override. Persisted in a **global** `mu_theme` localStorage key (`'light'` | `'dark'`;
absent = follow system) — global rather than per-user (unlike `mu_mode_<userId>`) because it
must apply on the auth screen too, before any user is identified.

**No-flash mechanism:** a small inline `<script>` at the top of `<head>`, before the
stylesheet `<link>`, synchronously reads `mu_theme` and sets `data-theme="light"` or
`data-theme="dark"` on `<html>` before first paint. No FOUC.

**CSS structure:** dark values are defined twice (no preprocessor to dedupe, only ~11
variables):

```css
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* dark values */ }
}
:root[data-theme="dark"] { /* dark values */ }
```

This means: system-dark + no override → dark; system-dark + explicit `data-theme="light"` →
light (media query excluded via `:not`); explicit `data-theme="dark"` → dark regardless of
system.

**Toggle UI:** a 3-way segmented control in Settings — "System" / "Hell" / "Dunkel" — visually
reusing the existing `.mode-toggle`/`.mode-btn` classes so it looks native rather than
bolted-on. Selecting a segment writes `mu_theme` to `'light'`, `'dark'`, or removes the key
(`'system'`) and re-applies `data-theme` immediately (no reload required).

**Palette:**

| Token | Light (current) | Dark (new) |
|---|---|---|
| `--bg` | `#f6f7f9` | `#0d0f13` |
| `--surface` | `#ffffff` | `#171a20` |
| `--surface2` | `#f1f3f5` | `#20242c` |
| `--accent` | `#4f46e5` | `#818cf8` |
| `--accent-hover` | `#4338ca` | `#6366f1` |
| `--accent-soft` | `#eef2ff` | `#1e2240` |
| `--accent-light` | `#6366f1` | `#a5b4fc` |
| `--success` | `#16a34a` | `#34d399` |
| `--success-soft` | `#ecfdf5` | `#113224` |
| `--danger` | `#dc2626` | `#f87171` |
| `--danger-hover` | `#b91c1c` | `#ef4444` |
| `--danger-soft` | `#fee2e2` | `#3b1616` |
| `--text` | `#18181b` | `#f4f4f5` |
| `--text-muted` | `#6b7280` | `#9aa0ab` |
| `--border` | `#e5e7eb` | `#2b2f38` |
| `--shadow-sm` | (as-is) | `0 1px 2px rgba(0,0,0,.4), 0 1px 3px rgba(0,0,0,.5)` |
| `--shadow-md` | (as-is) | `0 2px 6px rgba(0,0,0,.45), 0 8px 24px rgba(0,0,0,.55)` |

**One non-tokenized spot needs its own override:** `.fb-type-idea` (the "Idee" feedback badge)
is hardcoded sky-blue (`#e0f2fe`/`#0369a1`) and was never pulled into a token in the prior
pass. Add a dark-mode-specific override (`#0c2a3d`/`#7dd3fc`) alongside the token-driven
changes above, so it doesn't glare on a dark card.

**Out of scope for this spec:** syncing the theme preference to the user's Supabase profile
(it's a device/display preference, not app data — `localStorage`-only is consistent with how
`mu_mode_<userId>` and other UI-state keys are handled).

---

## Testing / Verification

No test suite exists (static site). Verify manually by serving the site
(`python3 -m http.server 8000`) and clicking through:

1. **Checkbox pop:** check an exercise/checklist box — should pop once; re-render the page
   (e.g. switch tabs and back) while it's still checked — should NOT replay.
2. **Spacing:** spot-check the 11 shifted elements (mode-toggle, phase badges, exercise
   detail text, plan table, announce/feedback buttons, auth input, nav items, post-session
   bar) — 1px shifts should be imperceptible in isolation, not a regression.
3. **Dark mode — system:** set the OS/browser to dark, load the app fresh (including the
   auth screen before login) — should render dark with no flash of light.
4. **Dark mode — override:** in Settings, force "Hell" while system is dark, and "Dunkel"
   while system is light — both should override immediately and persist across a reload.
5. **Dark mode — badges:** check the feedback inbox's "Idee" badge specifically in dark mode.
6. Check the browser console for errors after each interaction.
