#!/usr/bin/env bash
# Smoke test end-to-end do módulo CRM contra um servidor a correr localmente,
# passando agora pelo fluxo real de autenticação (login -> JWT -> Bearer).
#
# Pré-requisitos:
#   1. npm run prisma:migrate   (cria as tabelas)
#   2. npm run seed             (cria tenant_demo / lead_demo / utilizador demo)
#   3. npm run dev              (arranca o servidor noutro terminal)
#
# Uso: bash scripts/smoke-test.sh

set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3333}"
LEAD_ID="${LEAD_ID:-lead_demo}"
LOGIN_EMAIL="${LOGIN_EMAIL:-demo@helderlabs.pt}"
LOGIN_PASSWORD="${LOGIN_PASSWORD:-Demo@2026}"

echo "== 1. Health check =="
curl -sf "$BASE_URL/health"
echo -e "\n"

echo "== 2. Login =="
LOGIN_JSON=$(curl -sf -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"$LOGIN_EMAIL\", \"password\": \"$LOGIN_PASSWORD\"}")
TOKEN=$(node -e "console.log(JSON.parse(process.argv[1]).token)" "$LOGIN_JSON")
echo "Token obtido (${#TOKEN} caracteres)."
echo

echo "== 3. Converter Lead em Opportunity =="
OPP_JSON=$(curl -sf -X POST "$BASE_URL/api/crm/leads/$LEAD_ID/convert" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"estimatedValue": 15000}')
echo "$OPP_JSON"
OPP_ID=$(node -e "console.log(JSON.parse(process.argv[1]).id)" "$OPP_JSON")
echo "Opportunity criada: $OPP_ID"
echo

echo "== 4. Ganhar Opportunity e criar Customer =="
curl -sf -X POST "$BASE_URL/api/crm/opportunities/$OPP_ID/win" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN"
echo -e "\n"

echo "== 5. Dashboard comercial =="
curl -sf "$BASE_URL/api/crm/dashboard" \
  -H "Authorization: Bearer $TOKEN"
echo -e "\n"

echo "== 6. Isolamento multi-tenant: sem token deve dar 401 =="
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/crm/dashboard")
if [ "$STATUS" != "401" ]; then
  echo "FALHA: esperado 401 sem token, obtido $STATUS"
  exit 1
fi
echo "OK: pedido sem token foi corretamente rejeitado (401)."

echo
echo "Smoke test concluído com sucesso."
