#!/usr/bin/env bash
# Deploie le commit courant (HEAD) d'AXORA-ERP24 sur le VPS.
#
#   bash scripts/deploy-vps.sh
#
# Exige un arbre de travail sans modification suivie. Les etapes cote VPS
# (construction, verification ephemere, sauvegarde, bascule avec retour
# automatique) sont decrites dans deploy/vps/remote-deploy.sh.
set -euo pipefail

HOST="${DEPLOY_HOST:-axora-vps}"
SSH_BIN="ssh"
SCP_BIN="scp"
# Poste Windows : la cle est servie par l'agent OpenSSH de Windows.
if [ -x /c/Windows/System32/OpenSSH/ssh.exe ]; then
  SSH_BIN=/c/Windows/System32/OpenSSH/ssh.exe
  SCP_BIN=/c/Windows/System32/OpenSSH/scp.exe
fi

cd "$(git rev-parse --show-toplevel)"
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Modifications non committees : committez avant de deployer." >&2
  exit 1
fi

SHA="$(git rev-parse --short HEAD)"
ARCHIVE="erp24-$SHA.tgz"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

git archive --format=tar.gz -o "$TMP_DIR/$ARCHIVE" HEAD
LOCAL_ARCHIVE="$TMP_DIR/$ARCHIVE"
if command -v cygpath >/dev/null 2>&1; then
  LOCAL_ARCHIVE="$(cygpath -w "$LOCAL_ARCHIVE")"
fi

echo "Envoi de $SHA vers $HOST"
"$SCP_BIN" -o BatchMode=yes "$LOCAL_ARCHIVE" "$HOST:/tmp/$ARCHIVE"
"$SSH_BIN" -o BatchMode=yes "$HOST" "set -e
  rm -rf /tmp/erp24-deploy-$SHA
  mkdir -p /tmp/erp24-deploy-$SHA
  tar -xzf /tmp/$ARCHIVE -C /tmp/erp24-deploy-$SHA
  rm -f /tmp/$ARCHIVE
  sed -i 's/\r\$//' /tmp/erp24-deploy-$SHA/deploy/vps/remote-deploy.sh
  sh /tmp/erp24-deploy-$SHA/deploy/vps/remote-deploy.sh /tmp/erp24-deploy-$SHA $SHA"
