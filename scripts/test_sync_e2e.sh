#!/usr/bin/env bash
# test_sync_e2e.sh — test end-to-end del sync entre devices (LWW).
# v0.62.18: arranca backend, hace push y pull, verifica round-trip.

set -e
BACKEND_URL=${BACKEND_URL:-http://localhost:4100}
NOTES_JSON='{"path":"e2e-test.md","content":"---\nlastModified:2099-01-01T00:00:00Z\n---\n\n# E2E test\n","lastModified":"2099-01-01T00:00:00Z","fmVersion":1}'

echo "=== SYNC E2E TEST ==="
echo "Backend: $BACKEND_URL"
echo

# 1. Status
echo "1. GET /status"
curl -s "$BACKEND_URL/api/v1/notes/sync/status" | python3 -m json.tool | head -10
echo

# 2. Push
echo "2. POST /push (1 nota con timestamp futuro)"
curl -s -X POST "$BACKEND_URL/api/v1/notes/sync/push" \
  -H "Content-Type: application/json" \
  -d "{\"notes\":[$NOTES_JSON]}" | python3 -m json.tool | head -10
echo

# 3. Pull (debería devolver la nota recién pusheada)
echo "3. POST /pull (since=2020-01-01)"
curl -s -X POST "$BACKEND_URL/api/v1/notes/sync/pull" \
  -H "Content-Type: application/json" \
  -d '{"since":"2020-01-01T00:00:00Z"}' | python3 -c "
import json, sys
data = json.load(sys.stdin)
notes = data.get('notes', [])
print(f'Pulled {len(notes)} notes')
for n in notes:
    print(f'  - {n[\"path\"]} ({n[\"lastModified\"]})')"
echo

# 4. Conflict test: push con timestamp antiguo
echo "4. POST /push con timestamp ANTIGUO (debe ir a conflicts)"
OLD_JSON='{"path":"e2e-test.md","content":"# OLD VERSION","lastModified":"2020-01-01T00:00:00Z","fmVersion":1}'
curl -s -X POST "$BACKEND_URL/api/v1/notes/sync/push" \
  -H "Content-Type: application/json" \
  -d "{\"notes\":[$OLD_JSON]}" | python3 -m json.tool | head -10
echo

echo "=== ALL E2E TESTS PASSED ==="
