#!/usr/bin/env sh
set -eu
# Informe ADMIN_EMAIL e ADMIN_PASSWORD no ambiente antes de executar.
# Requer Node.js 22+ para serializar os dados de login com segurança.
: "${ADMIN_EMAIL:=admin@atrio.local}"
: "${ADMIN_PASSWORD:?Defina ADMIN_PASSWORD no ambiente}"
export ADMIN_EMAIL ADMIN_PASSWORD
cookies=$(mktemp)
trap 'rm -f "$cookies"' EXIT
node -e 'console.log(JSON.stringify({email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD}))' | \
  curl -fsS -c "$cookies" -H 'Content-Type: application/json' --data-binary @- http://localhost:8080/api/auth/login
printf '\n'
curl -fsS -b "$cookies" http://localhost:8080/api/cluster
printf '\n'
curl -fsS -b "$cookies" http://localhost:8080/api/auctions
printf '\n'
curl -fsS -b "$cookies" -H 'Content-Type: application/json' --data '{}' http://localhost:8080/api/auth/logout
printf '\n'
