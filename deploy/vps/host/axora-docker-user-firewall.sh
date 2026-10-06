#!/bin/sh
# AXORA VPS — bloque l'acces INTERNET (interface ens3) aux ports internes
# publies par Docker (Docker contourne UFW). L'acces local, Docker interne et
# Tailscale reste inchange. Idempotent ; rejoue au demarrage par
# axora-docker-user-firewall.service (apres docker.service).
#
# Ports : 5432 kanban_postgres, 6379 kanban_redis, 5440 ax-erp00-postgres.
# Les regles DOCKER-USER voient le port du CONTENEUR apres DNAT : 5440 -> 5432.
set -eu

PUBLIC_IF="ens3"
COMMENT="axora-block-public-internal"

for tool in iptables ip6tables; do
  $tool -N DOCKER-USER 2>/dev/null || true
  # Purge des regles AXORA existantes (rejeu idempotent).
  while $tool -S DOCKER-USER | grep -q "$COMMENT"; do
    rule=$($tool -S DOCKER-USER | grep "$COMMENT" | head -n 1 | sed 's/^-A /-D /')
    # shellcheck disable=SC2086
    $tool $rule
  done
  # Correspondance sur le port d'origine (avant DNAT) via conntrack : 5432, 6379, 5440.
  $tool -I DOCKER-USER 1 -i "$PUBLIC_IF" -p tcp -m conntrack --ctorigdstport 5432 --ctstate NEW,ESTABLISHED,RELATED -m comment --comment "$COMMENT" -j DROP
  $tool -I DOCKER-USER 1 -i "$PUBLIC_IF" -p tcp -m conntrack --ctorigdstport 6379 --ctstate NEW,ESTABLISHED,RELATED -m comment --comment "$COMMENT" -j DROP
  $tool -I DOCKER-USER 1 -i "$PUBLIC_IF" -p tcp -m conntrack --ctorigdstport 5440 --ctstate NEW,ESTABLISHED,RELATED -m comment --comment "$COMMENT" -j DROP
done

echo "AXORA : ports 5432/6379/5440 bloques sur $PUBLIC_IF (IPv4 + IPv6)."
