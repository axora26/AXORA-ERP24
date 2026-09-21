#!/usr/bin/env node
/**
 * Lance une commande avec le .env du monorepo charge dans process.env.
 *
 * Raison d'etre : la CLI Prisma ne cherche .env que dans son repertoire de
 * travail (ici packages/database) et n'offre aucune option --env-file. Sans ce
 * wrapper, `pnpm db:generate` / `db:migrate` / `db:validate` echouent sur une
 * machine propre avec "Environment variable not found: DATABASE_URL", alors
 * que ces commandes sont documentees dans le README.
 *
 * INVARIANT DE PRECEDENCE (identique a apps/api/src/config/env.ts, teste par
 * apps/api/test/env-loader.test.ts) : une variable deja presente dans
 * l'environnement reel n'est JAMAIS ecrasee. En CI, DATABASE_URL vient du
 * workflow et doit primer sur tout fichier local.
 *
 * Usage : node scripts/with-env.mjs <commande> [args...]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(rootDir, ".env");

if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    if (key.length === 0 || process.env[key] !== undefined) continue;

    const value = line.slice(separatorIndex + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    process.env[key] = quoted ? value.slice(1, -1) : value;
  }
}

const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error("usage: node scripts/with-env.mjs <commande> [args...]");
  process.exit(2);
}

const result = spawnSync(command, args, { stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
