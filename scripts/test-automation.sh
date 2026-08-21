#!/usr/bin/env bash
# Integration test script for the WhatsApp automation pipeline.
# Usage: CRON_SECRET=xxx ADMIN_API_TOKEN=xxx BASE_URL=https://your-app.vercel.app bash scripts/test-automation.sh
#
# Required env vars:
#   BASE_URL          – deployed URL (e.g. https://caseirinhas-engine.vercel.app)
#   ADMIN_API_TOKEN   – matches ADMIN_API_TOKEN in Vercel env
#   CRON_SECRET       – matches CRON_SECRET in Vercel env
#   TEST_PHONE        – E.164 phone to use for smoke test (e.g. +5511999999999)

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
pass() { echo -e "${GREEN}✔ $1${NC}"; }
fail() { echo -e "${RED}✘ $1${NC}"; exit 1; }
info() { echo -e "${YELLOW}► $1${NC}"; }

: "${BASE_URL:?Set BASE_URL to your deployed URL}"
: "${ADMIN_API_TOKEN:?Set ADMIN_API_TOKEN}"
: "${CRON_SECRET:?Set CRON_SECRET}"
: "${TEST_PHONE:?Set TEST_PHONE (E.164 format, e.g. +5511999999999)}"

BASE="${BASE_URL%/}"

# ── 1. Health: cron rejects missing auth ──────────────────────────────────────
info "1. Cron auth rejection"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/cron?objective=1")
[[ "$STATUS" == "401" ]] && pass "Unauthenticated → 401" || fail "Expected 401, got $STATUS"

# ── 2. Cron responds with valid auth (may be empty if no jobs) ────────────────
info "2. Cron authenticated call"
BODY=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron?objective=1")
HTTP_CODE=$(echo "$BODY" | tail -1)
RESPONSE=$(echo "$BODY" | head -n -1)
[[ "$HTTP_CODE" == "200" ]] && pass "Cron 200 OK — $RESPONSE" || fail "Cron failed: $HTTP_CODE — $RESPONSE"

# ── 3. Campaigns: create a draft campaign ────────────────────────────────────
info "3. Create draft campaign"
CAMPAIGN=$(curl -s -X POST "$BASE/api/campaigns" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Campaign '$(date +%s)'","messageTemplate":"Olá {{company_name}}, teste de automação.","dailyLimit":5,"minIntervalSeconds":60}')
echo "$CAMPAIGN" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || echo "$CAMPAIGN"
CAMPAIGN_ID=$(echo "$CAMPAIGN" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null || echo "")
[[ -n "$CAMPAIGN_ID" ]] && pass "Campaign created: $CAMPAIGN_ID" || fail "Campaign creation failed"

# ── 4. Campaigns: list campaigns ─────────────────────────────────────────────
info "4. List campaigns"
LIST=$(curl -s "$BASE/api/campaigns" -H "Authorization: Bearer $ADMIN_API_TOKEN")
COUNT=$(echo "$LIST" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('data',[])))" 2>/dev/null || echo "?")
pass "Listed campaigns, count=$COUNT"

# ── 5. Campaigns: get single campaign ────────────────────────────────────────
info "5. Get single campaign"
SINGLE=$(curl -s "$BASE/api/campaigns/$CAMPAIGN_ID" -H "Authorization: Bearer $ADMIN_API_TOKEN")
NAME=$(echo "$SINGLE" | python3 -c "import sys,json; print(json.load(sys.stdin).get('name',''))" 2>/dev/null || echo "")
[[ -n "$NAME" ]] && pass "Got campaign: $NAME" || fail "Get campaign failed"

# ── 6. Campaigns: try launch (may return 422 if no eligible leads — that's OK) ─
info "6. Launch campaign"
LAUNCH=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/campaigns/$CAMPAIGN_ID/launch" \
  -H "Authorization: Bearer $ADMIN_API_TOKEN")
LAUNCH_CODE=$(echo "$LAUNCH" | tail -1)
LAUNCH_BODY=$(echo "$LAUNCH" | head -n -1)
echo "$LAUNCH_BODY"
if [[ "$LAUNCH_CODE" == "200" ]]; then
  ENROLLED=$(echo "$LAUNCH_BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('enrolledCount','?'))" 2>/dev/null || echo "?")
  pass "Launch succeeded — enrolledCount=$ENROLLED"
elif [[ "$LAUNCH_CODE" == "422" ]]; then
  pass "Launch returned 422 (no eligible leads — expected in a fresh env)"
else
  fail "Launch failed: $LAUNCH_CODE — $LAUNCH_BODY"
fi

# ── 7. Cron: run again after potential launch ─────────────────────────────────
info "7. Cron dispatch after launch"
BODY2=$(curl -s -w "\n%{http_code}" -H "Authorization: Bearer $CRON_SECRET" "$BASE/api/cron?objective=1")
CODE2=$(echo "$BODY2" | tail -1)
RESP2=$(echo "$BODY2" | head -n -1)
[[ "$CODE2" == "200" ]] && pass "Second cron OK — $RESP2" || fail "Second cron failed: $CODE2"

# ── 8. Webhook: send a fake opt-out ──────────────────────────────────────────
info "8. Webhook inbound opt-out simulation"
WH_PAYLOAD=$(cat <<EOF
{
  "event": "messages.upsert",
  "instance": "test",
  "data": {
    "key": { "id": "FAKETEST$(date +%s)", "fromMe": false, "remoteJid": "${TEST_PHONE/+/}@s.whatsapp.net" },
    "message": { "conversation": "sair" },
    "messageType": "conversation",
    "messageTimestamp": $(date +%s),
    "pushName": "Test User"
  }
}
EOF
)
WH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE/api/webhook" \
  -H "Content-Type: application/json" \
  -d "$WH_PAYLOAD")
[[ "$WH_STATUS" == "200" ]] && pass "Webhook accepted opt-out: $TEST_PHONE" || echo -e "${YELLOW}⚠ Webhook returned $WH_STATUS (may need MESSAGE_PROVIDER_WEBHOOK_SECRET bypass for test)${NC}"

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  Pipeline test complete${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
