#!/bin/sh
# Attend que le DNS public de PUBLIC_HOST pointe vers ce VPS, puis fait
# obtenir le certificat Let's Encrypt par Caddy (redemarrage = nouvel essai
# ACME immediat). Evite d'epuiser les limites ACME tant que l'enregistrement
# DNS n'existe pas. Lance par cron toutes les 5 minutes ; une fois le
# certificat valide, un marqueur arrete toute action ulterieure.
set -eu

STACK_DIR=/srv/axora/docker/stacks/erp24
MARKER=/var/lib/axora/erp24-dns-ready
HOST=$(grep -E '^PUBLIC_HOST=' "$STACK_DIR/.env.production" | cut -d= -f2)
EXPECTED=$(grep -E '^PUBLIC_IPV4=' "$STACK_DIR/.env.production" | cut -d= -f2)

[ -e "$MARKER" ] && exit 0

resolved=$(dig +short A "$HOST" @1.1.1.1 2>/dev/null | tail -n 1)
resolved_google=$(dig +short A "$HOST" @8.8.8.8 2>/dev/null | tail -n 1)
if [ "$resolved" != "$EXPECTED" ] || [ "$resolved_google" != "$EXPECTED" ]; then
  exit 0
fi

cd "$STACK_DIR"
docker compose --env-file .env.production up -d --no-build caddy
docker compose --env-file .env.production restart caddy

# Certificat obtenu ? (jusqu'a 2 minutes)
i=0
while [ "$i" -lt 24 ]; do
  if curl -fsS -o /dev/null --max-time 10 "https://$HOST/login"; then
    mkdir -p "$(dirname "$MARKER")"
    date -u +%Y-%m-%dT%H:%M:%SZ > "$MARKER"
    logger -t axora-erp24 "DNS $HOST -> $EXPECTED : HTTPS actif (certificat Let's Encrypt)."
    echo "$(date -u +%FT%TZ) HTTPS actif pour $HOST"
    exit 0
  fi
  i=$((i + 1))
  sleep 5
done
echo "$(date -u +%FT%TZ) DNS OK mais certificat pas encore valide ; nouvel essai au prochain passage."
