#!/bin/sh
# Demarrage de l'API en production : applique les migrations Prisma en attente
# (idempotent, verrou consultatif cote Prisma) puis lance le serveur.
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "DATABASE_URL manquant : arret." >&2
  exit 1
fi

echo "Migrations Prisma : application des migrations en attente..."
prisma migrate deploy --schema /app/prisma

exec "$@"
