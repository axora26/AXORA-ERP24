import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Chargement explicite du fichier .env du monorepo.
 *
 * Contexte : ni NestJS ni @prisma/client (v6) ne chargent .env au runtime —
 * seule la CLI Prisma le fait. Sans ce chargeur, `pnpm dev:api` et les tests
 * e2e echouent avec "Environment variable not found: DATABASE_URL" sur une
 * machine propre, alors que le README documente ce demarrage.
 *
 * INVARIANT DE PRECEDENCE : une variable deja presente dans process.env n'est
 * JAMAIS ecrasee. L'environnement reel (CI, Docker, production, secrets
 * injectes) prime toujours sur le fichier .env de developpement.
 *
 * Ce chargeur ne journalise aucune valeur (docs/foundation/03-security.md :
 * aucun secret dans les logs) — uniquement les noms de variables appliquees.
 */
export function loadRootEnv(startDir: string = process.cwd()): string[] {
  const envPath = findEnvFile(startDir);
  if (!envPath) {
    return [];
  }

  const applied: string[] = [];
  const content = readFileSync(envPath, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    if (key.length === 0 || process.env[key] !== undefined) {
      continue;
    }

    process.env[key] = unquote(line.slice(separatorIndex + 1).trim());
    applied.push(key);
  }

  return applied;
}

/** Remonte l'arborescence jusqu'a la racine du monorepo (pnpm-workspace.yaml). */
function findEnvFile(startDir: string): string | undefined {
  let current = resolve(startDir);

  for (;;) {
    const candidate = resolve(current, ".env");
    if (existsSync(candidate)) {
      return candidate;
    }
    if (existsSync(resolve(current, "pnpm-workspace.yaml"))) {
      return undefined;
    }

    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}

function unquote(value: string): string {
  const isQuoted =
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")));
  return isQuoted ? value.slice(1, -1) : value;
}
