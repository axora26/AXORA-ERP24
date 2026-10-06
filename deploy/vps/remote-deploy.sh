#!/bin/sh
# Deploiement AXORA-ERP24 cote VPS (lance par scripts/deploy-vps.sh).
#
#   remote-deploy.sh <dossier-sources-extrait> <sha>
#
# 1. sources -> dossier de build (l'ancien conserve en .prev) ;
# 2. images candidates api/web ;
# 3. verification sur une pile jetable sans port public ;
# 4. sauvegarde de la production (base, fichiers, configuration) ;
# 5. bascule api/web ; retour automatique a l'image precedente si la
#    nouvelle ne devient pas saine. Une migration deja appliquee n'est pas
#    annulee par ce retour : la sauvegarde de l'etape 4 sert alors de reprise.
set -eu

SRC="$1"
SHA="$2"
BUILD=/srv/axora/docker/stacks/erp24-build
STACK=/srv/axora/docker/stacks/erp24
SMOKE_PROJECT=axora-erp24-smoke
SMOKE_URL=http://127.0.0.1:3199

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
fail() { log "ECHEC : $*"; exit 1; }

# --- 1. Sources ---------------------------------------------------------
log "Sources $SHA"
find "$SRC" -type f \( -name '*.sh' -o -name 'Dockerfile' -o -name 'Caddyfile' \) -exec sed -i 's/\r$//' {} +
rm -rf "$BUILD.prev"
[ -d "$BUILD" ] && mv "$BUILD" "$BUILD.prev"
mv "$SRC" "$BUILD"

# --- 2. Images candidates -----------------------------------------------
cd "$BUILD"
log "Construction de l'image API"
docker build --quiet --target api -t axora-erp24-api:candidate . >/dev/null
log "Construction de l'image web"
docker build --quiet --target web -t axora-erp24-web:candidate . >/dev/null

# --- 3. Verification ephemere -------------------------------------------
cd "$BUILD/deploy/vps"
smoke_down() { docker compose -p "$SMOKE_PROJECT" -f smoke-compose.yml down -v >/dev/null 2>&1 || true; }
trap smoke_down EXIT
SMOKE_KEY_1=$(openssl rand -base64 32)
SMOKE_KEY_2=$(openssl rand -base64 32)
SMOKE_KEY_3=$(openssl rand -base64 32)
SMOKE_KEY_4=$(openssl rand -base64 32)
export SMOKE_KEY_1 SMOKE_KEY_2 SMOKE_KEY_3 SMOKE_KEY_4
log "Verification sur une base jetable"
docker compose -p "$SMOKE_PROJECT" -f smoke-compose.yml up -d --wait >/dev/null 2>&1 || fail "la pile de verification ne demarre pas"

status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
register() {
  curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' -H 'Origin: http://smoke.local' \
    -H "X-Forwarded-For: 198.51.100.$1" -c /tmp/erp24-smoke-cookies \
    -d "{\"organizationName\":\"Verification $1\",\"organizationSlug\":\"verification-$1\",\"companyName\":\"Verification $1\",\"ownerFullName\":\"Verification\",\"ownerEmail\":\"verification$1@smoke.local\",\"ownerPassword\":\"Verification-Only-2026\"}" \
    "$SMOKE_URL/api/v1/auth/register-organization"
}
[ "$(status "$SMOKE_URL/login")" = 200 ] || fail "page de connexion"
[ "$(register 10)" = 201 ] || fail "creation de la premiere organisation"
[ "$(status -b /tmp/erp24-smoke-cookies "$SMOKE_URL/api/v1/auth/me")" = 200 ] || fail "session"
[ "$(status -b /tmp/erp24-smoke-cookies "$SMOKE_URL/api/v1/dashboard/overview")" = 200 ] || fail "tableau de bord"
[ "$(register 11)" = 403 ] || fail "seconde organisation non refusee"
rm -f /tmp/erp24-smoke-cookies
smoke_down
trap - EXIT
log "Verification reussie"

# --- 4. Sauvegarde ------------------------------------------------------
log "Sauvegarde de la production"
sudo -n /usr/local/sbin/axora-erp24-backup.sh

# --- 5. Configuration et bascule ---------------------------------------
cd "$STACK"
sed 's#context: \.\./\.\.#context: /srv/axora/docker/stacks/erp24-build#' "$BUILD/deploy/vps/docker-compose.yml" > docker-compose.yml.next
docker compose --env-file .env.production -f docker-compose.yml.next config --quiet || fail "docker-compose.yml invalide"
mv docker-compose.yml.next docker-compose.yml
caddy_changed=0
cmp -s "$BUILD/deploy/vps/Caddyfile" Caddyfile || caddy_changed=1
# Ecriture en place : le fichier est monte dans le conteneur Caddy.
cat "$BUILD/deploy/vps/Caddyfile" > Caddyfile

for service in api web; do
  if docker image inspect "axora-erp24-$service:latest" >/dev/null 2>&1; then
    docker tag "axora-erp24-$service:latest" "axora-erp24-$service:previous"
  fi
  docker tag "axora-erp24-$service:candidate" "axora-erp24-$service:latest"
done

log "Bascule api/web"
if ! docker compose --env-file .env.production up -d --no-build --wait api web >/dev/null 2>&1; then
  log "La nouvelle version n'est pas saine : retour a la precedente"
  for service in api web; do
    docker tag "axora-erp24-$service:previous" "axora-erp24-$service:latest"
  done
  docker compose --env-file .env.production up -d --no-build --wait api web >/dev/null 2>&1 || true
  fail "deploiement annule ; version precedente remise en service"
fi
# Caddy : `up -d` recree le conteneur si sa definition a change (variables
# d'environnement, ports) ; sinon, un rechargement suffit pour un nouveau Caddyfile.
caddy_before=$(docker compose --env-file .env.production ps -q caddy 2>/dev/null || true)
docker compose --env-file .env.production up -d --no-build caddy >/dev/null 2>&1
caddy_after=$(docker compose --env-file .env.production ps -q caddy 2>/dev/null || true)
if [ "$caddy_changed" = 1 ] && [ -n "$caddy_after" ] && [ "$caddy_before" = "$caddy_after" ]; then
  log "Rechargement de la configuration Caddy"
  docker compose --env-file .env.production exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null \
    || fail "configuration Caddy refusee au rechargement"
elif [ "$caddy_before" != "$caddy_after" ]; then
  log "Conteneur Caddy recree (definition modifiee)"
fi
# Laisser Caddy finir de demarrer avant le controle final.
i=0
while [ "$i" -lt 15 ] && [ "$(status http://127.0.0.1:3110/login)" != 200 ]; do
  i=$((i + 1))
  sleep 2
done

[ "$(status http://127.0.0.1:3110/login)" = 200 ] || fail "page de connexion de production"
echo "$SHA $(date -u +%Y-%m-%dT%H:%M:%SZ)" > DEPLOYED
docker image prune -f >/dev/null 2>&1 || true
log "Version $SHA en service"
