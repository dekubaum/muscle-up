# Feedback triage — AI agent runbook

This is the on-demand workflow that turns raw anonymous feedback into a ranked,
reviewable plan. Run it whenever you want to process the inbox. It is meant to be
followed by an AI agent (e.g. Claude Code) but every step is a plain command you
can run yourself.

## The loop

```
submit (any user)  →  feedback table (status='new')  →  fetch  →  triage doc  →  you pick
        ↑                                                                            │
        └──────────────  next fetch skips it  ←  mark done/dismissed in-app  ←───────┘
```

## 1. Fetch the open feedback

```
./scripts/fetch-feedback.sh
```

Writes `docs/feedback/inbox.json` (gitignored) — an array of rows with only
`status = 'new'`. Each row:

```json
{
  "id": "…uuid…",
  "type": "bug | idea | praise | other",
  "message": "free text from the user",
  "context": {
    "screen": "today | leaderboard | plan | settings",
    "mode": "muscleup | handstand",
    "phase": 2,
    "block": "a-warmup",
    "app_version": "1.0.0",
    "user_agent": "…"
  },
  "status": "new",
  "created_at": "…"
}
```

There is **no author field** — feedback is anonymous by design. Don't try to
attribute or contact submitters.

## 2. Analyze (the agent's job)

For each item, and across items:

1. **Group & dedup.** Fold multiple rows describing the same bug/idea into one
   entry. Note how many reports back it (a "× N" signal of demand).
2. **Classify honestly.** Respect the user's `type`, but correct it if the text
   clearly says otherwise (a "Lob" that's actually a bug report).
3. **Assess feasibility against the codebase.** This is a vanilla-JS + Supabase
   static app (see `CLAUDE.md`). Check whether the change is a content edit
   (`js/data.js` / `js/handstand-data.js`), a UI/app change (`js/app.js`,
   `index.html`, `css/styles.css`), or a schema/RLS migration (`supabase/`).
   Flag anything that needs a migration or breaks the offline-first / anonymity
   model.
4. **Use the context.** `screen`/`mode`/`phase`/`block` localize a bug;
   `app_version` tells you which build; `user_agent` helps reproduce rendering
   issues.
5. **Drop the noise.** Spam, empty, or unactionable praise → recommend
   `dismissed` (you'll set it in-app), don't pad the list.

## 3. Write the triage doc

Produce `docs/feedback/triage-YYYY-MM-DD.md` (kept in git, like specs) using the
template below. Rank entries by value-to-effort — the cheap, high-demand wins
first. Keep it scannable: the owner reads this to **choose**, so lead with the
recommendation.

### Template

```markdown
# Feedback triage — YYYY-MM-DD

_N open items fetched; M distinct entries after grouping._

## Recommended

### 1. <short title>
- **Type:** bug / idea  · **Reports:** ×3  · **Feasibility:** easy / medium / hard
- **Effort:** ~S/M/L  · **Context:** handstand · today · v1.0.0
- **What:** one-line synthesis of what users asked for.
- **Why:** why it's worth doing (demand, severity, alignment).
- **How:** the approach + likely files (e.g. "add a chip in `index.html`,
  handle in `renderHandstand` in `js/app.js`").
- **Source ids:** `uuid1`, `uuid2`, `uuid3`
- [ ] **Implement this**

### 2. …

## Consider later
…

## Recommend dismissing
- `uuid` — reason (spam / empty / out of scope).
```

## 4. Close the loop

The owner ticks the `- [ ]` boxes for what to build. Chosen items go into the
normal flow (`/superpowers:brainstorming` → spec → plan → implement). After an
item ships — or is rejected — set its status **in the app** (Settings → Feedback →
Geplant / Erledigt / Verworfen). The next `fetch-feedback.sh` only returns
`status='new'`, so handled items drop out automatically and the inbox never
re-litigates old decisions.
