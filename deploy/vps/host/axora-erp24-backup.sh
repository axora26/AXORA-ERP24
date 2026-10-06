#!/bin/sh
# Sauvegarde quotidienne AXORA-ERP24 : base PostgreSQL (pg_dump compresse) et
# fichiers GED/preuves. Rotation : 14 jours. Lancee par cron (root).
set -eu

STACK_DIR=/srv/axora/docker/stacks/erp24
BACKUP_DIR=/srv/axora/backups/erp24
KEEP_DAYS=14
STAMP=$(date -u +%Y%m%d-%H%M%S)

mkdir -p "$BACKUP_DIR"
chmod 0700 "$BACKUP_DIR"
cd "$STACK_DIR"

docker compose --env-file .env.production exec -T postgres \
  pg_dump -U axora -d axora_erp24 --format=custom --compress=9 \
  > "$BACKUP_DIR/db-$STAMP.dump"

docker run --rm \
  -v axora-erp24_files-data:/data/files:ro \
  -v "$BACKUP_DIR":/backup \
  alpine:3.20 tar -czf "/backup/files-$STAMP.tar.gz" -C /data files

# La configuration (cles de chiffrement) est indispensable a la restauration.
cp "$STACK_DIR/.env.production" "$BACKUP_DIR/env-$STAMP.production"
chmod 0600 "$BACKUP_DIR"/*

find "$BACKUP_DIR" -type f -mtime +"$KEEP_DAYS" -delete
echo "Sauvegarde AXORA-ERP24 $STAMP : $(du -sh "$BACKUP_DIR/db-$STAMP.dump" | cut -f1) base, $(du -sh "$BACKUP_DIR/files-$STAMP.tar.gz" | cut -f1) fichiers."
