#!/usr/bin/env bash
#
# Fetch open (status='new') anonymous feedback from Supabase for AI triage.
#
# Signs in as YOUR admin user (synthetic email + password) and reads the
# feedback table through the admin-only RLS policy — no service-role key.
# Writes docs/feedback/inbox.json (gitignored). See docs/feedback/ANALYSIS.md
# for what to do with it.
#
# Zero dependencies beyond curl + python3 (both already used by this project).
#
# Setup once:
#   cp supabase/.env.local.example supabase/.env.local   # then fill it in
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$REPO_ROOT/supabase/.env.local"
OUT_FILE="$REPO_ROOT/docs/feedback/inbox.json"

# Public values (same as js/db.js — the anon key is public by design; RLS is the
# gate). Override in .env.local if the project ever moves.
SUPABASE_URL="https://bfwianyhjntvfklqczkd.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmd2lhbnloam50dmZrbHFjemtkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NTQxNzQsImV4cCI6MjA5MjAzMDE3NH0.pWh1165Oz62cHma_e0Fly17j5BPAYcJTSnC7Q_Lj_xk"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy supabase/.env.local.example and fill it in." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$ENV_FILE"

: "${SUPABASE_ADMIN_EMAIL:?Set SUPABASE_ADMIN_EMAIL in supabase/.env.local}"
: "${SUPABASE_ADMIN_PASSWORD:?Set SUPABASE_ADMIN_PASSWORD in supabase/.env.local}"

echo "Signing in as $SUPABASE_ADMIN_EMAIL …" >&2
AUTH_RESP="$(curl -fsS -X POST \
  "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$SUPABASE_ADMIN_EMAIL\",\"password\":\"$SUPABASE_ADMIN_PASSWORD\"}")"

ACCESS_TOKEN="$(printf '%s' "$AUTH_RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))')"
if [[ -z "$ACCESS_TOKEN" ]]; then
  echo "Login failed — check your admin email/password. Response:" >&2
  printf '%s\n' "$AUTH_RESP" >&2
  exit 1
fi

mkdir -p "$(dirname "$OUT_FILE")"
echo "Fetching open feedback …" >&2
curl -fsS \
  "$SUPABASE_URL/rest/v1/feedback?select=*&status=eq.new&order=created_at.desc" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -o "$OUT_FILE"

COUNT="$(python3 -c 'import sys,json; print(len(json.load(open(sys.argv[1]))))' "$OUT_FILE")"
echo "Wrote $COUNT open feedback item(s) → ${OUT_FILE#"$REPO_ROOT"/}" >&2
if [[ "$COUNT" == "0" ]]; then
  echo "(If you expected items: confirm you are an admin and the migration ran.)" >&2
fi
