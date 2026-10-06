#!/bin/sh
# Genere .env.production pour la pile AXORA-ERP24 (une seule fois).
# Les secrets ne sont jamais affiches ; le fichier est lisible par son seul
# proprietaire. Rejouer le script ne remplace PAS un fichier existant (perte
# des cles = donnees chiffrees MFA/integrations/cartes illisibles).
set -eu

TARGET="${1:-.env.production}"
PUBLIC_HOST="${PUBLIC_HOST:?PUBLIC_HOST requis, ex. erp24.axora.cd}"
ACME_EMAIL="${ACME_EMAIL:?ACME_EMAIL requis (alertes Let's Encrypt)}"

if [ -e "$TARGET" ]; then
  echo "$TARGET existe deja : conserve (aucune cle regeneree)."
  exit 0
fi

umask 077
key() { openssl rand -base64 32; }
pg_password=$(openssl rand -hex 24)

cat > "$TARGET" <<EOF
# AXORA-ERP24 production — genere le $(date -u +%Y-%m-%dT%H:%M:%SZ). Ne jamais versionner.
PUBLIC_HOST=$PUBLIC_HOST
ACME_EMAIL=$ACME_EMAIL
REGISTRATION_MODE=first-organization
REGISTRATION_LIMIT=5
POSTGRES_PASSWORD=$pg_password
MFA_ENCRYPTION_KEY=$(key)
INTEGRATION_ENCRYPTION_KEY=$(key)
SERVICE_CARD_ENCRYPTION_KEY=$(key)
AXORA_INVOICE_SIGNING_SECRET=$(key)
EOF

echo "$TARGET cree (droits 600). Sauvegardez-le hors du VPS : il contient les cles de chiffrement."
