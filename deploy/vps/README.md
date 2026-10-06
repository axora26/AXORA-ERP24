# Déploiement AXORA-ERP24 sur le VPS

Ce guide décrit l'installation de production en place sur le VPS AXORA (`axora-vps`, Ubuntu 24.04, IP publique `57.128.181.32`).

## Architecture

```
Internet ──► Caddy :80/:443 (57.128.181.32) ──► web (Next.js) ──► api (NestJS) ──► postgres
Tailnet  ──► tailscale serve :10443 ──► Caddy :3110 (127.0.0.1) ──┘
```

- **Caddy** est le seul service exposé. Il obtient le certificat HTTPS (Let's Encrypt) pour `PUBLIC_HOST` et active HTTP/2 et HTTP/3.
- **La création d'organisations est toujours refusée sur le domaine public** (Caddy renvoie 403). L'API applique en plus `REGISTRATION_MODE=first-organization` : seule la toute première organisation peut être créée, puis l'administrateur ajoute les utilisateurs.
- **Accès d'administration privé** : `https://axora-vps.taild4cfa4.ts.net:10443`, réservé aux appareils du tailnet Tailscale (pas de Funnel). C'est par là que le premier administrateur crée son compte.
- L'API, l'interface et PostgreSQL restent sur le réseau Docker interne `axora-erp24_internal`.
- Volumes nommés : `axora-erp24_postgres-data`, `axora-erp24_files-data` (GED, preuves), `axora-erp24_caddy-data` (certificats).

## Fichiers sur le VPS

| Chemin | Rôle |
|---|---|
| `/srv/axora/docker/stacks/erp24/` | Pile de production : `docker-compose.yml`, `Caddyfile`, `.env.production` (droits 600) |
| `/srv/axora/docker/stacks/erp24-build/` | Sources utilisées pour construire les images |
| `/srv/axora/backups/erp24/` | Sauvegardes quotidiennes (base, fichiers, configuration), conservées 14 jours |
| `/usr/local/sbin/axora-erp24-backup.sh` | Sauvegarde, lancée chaque jour à 02:30 UTC (`/etc/cron.d/axora-erp24`) |
| `/usr/local/sbin/axora-erp24-dns-watch.sh` | Toutes les 5 minutes : dès que le DNS public pointe vers le VPS, fait obtenir le certificat par Caddy |
| `/usr/local/sbin/axora-docker-user-firewall.sh` | Bloque l'accès Internet aux ports internes publiés par Docker (5432, 6379, 5440) |

## Configuration (`.env.production`)

Le fichier est généré une seule fois par `deploy/vps/init-env.sh`. Il contient les clés de chiffrement (MFA, intégrations, cartes de service), la clé de signature des factures et le mot de passe PostgreSQL. **Une copie doit être gardée hors du VPS** : sans ces clés, les secrets MFA, intégrations et cartes deviennent illisibles. Le script de sauvegarde en garde aussi une copie datée.

| Variable | Valeur |
|---|---|
| `PUBLIC_HOST` | `erp24.axora.cd` |
| `PUBLIC_IPV4` | `57.128.181.32` |
| `ADMIN_ORIGIN` | `https://axora-vps.taild4cfa4.ts.net:10443` |
| `REGISTRATION_MODE` | `first-organization` |

## Mettre à jour l'application

Depuis le poste de développement, sur un arbre sans modification non committée :

```sh
bash scripts/deploy-vps.sh
```

Le script envoie le commit courant au VPS, puis `deploy/vps/remote-deploy.sh` enchaîne :

1. la construction des images candidates API et web ;
2. la vérification sur une pile jetable sans port public : page de connexion, création de la première organisation, session, tableau de bord, refus de la seconde organisation ;
3. une sauvegarde complète de la production ;
4. la bascule de l'API et de l'interface, avec retour automatique à la version précédente si la nouvelle ne devient pas saine.

Les migrations s'appliquent au démarrage de l'API. Un retour arrière ne défait pas une migration déjà appliquée : la sauvegarde de l'étape 3 sert alors de point de reprise. Le commit en service est noté dans `/srv/axora/docker/stacks/erp24/DEPLOYED`.

Procédure manuelle équivalente, depuis `/srv/axora/docker/stacks/erp24-build/` :

```sh
cd /srv/axora/docker/stacks/erp24
docker compose --env-file .env.production build api web
docker compose --env-file .env.production up -d
```

Avant une mise en ligne, `deploy/vps/smoke-compose.yml` démarre les mêmes images sur une base jetable sans port public (vérification des migrations, de la connexion et de la politique d'inscription).

## Restaurer une sauvegarde

```sh
cd /srv/axora/docker/stacks/erp24
docker compose --env-file .env.production stop api web
docker compose --env-file .env.production exec -T postgres \
  pg_restore -U axora -d axora_erp24 --clean --if-exists --no-owner < /srv/axora/backups/erp24/db-AAAAMMJJ-HHMMSS.dump
docker compose --env-file .env.production up -d
```

La restauration d'une sauvegarde a été vérifiée sur une base jetable (58 migrations restaurées).

## Sécurité de l'hôte

- Docker contourne UFW pour les ports publiés. Le service `axora-docker-user-firewall` ajoute des règles `DOCKER-USER` (IPv4 et IPv6) qui rejettent sur `ens3` les connexions vers 5432, 6379 et 5440. Elles sont rejouées après chaque démarrage de Docker. L'état antérieur est sauvegardé dans `/tmp/iptables-before-axora.rules` et `/tmp/ip6tables-before-axora.rules`.
- SSH reste fermé sur l'interface publique (UFW) et accessible par Tailscale (port 2222).
