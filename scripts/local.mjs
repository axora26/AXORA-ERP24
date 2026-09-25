#!/usr/bin/env node
/**
 * Demarrage local complet d'AXORA-ERP24 en une commande : `pnpm local`.
 *
 * 1. cree `.env` depuis `.env.example` s'il n'existe pas ;
 * 2. genere le client Prisma et applique les migrations ;
 * 3. compile les paquets partages ;
 * 4. demarre l'API (port 4000) et l'interface web (port 3100) ;
 * 5. attend que l'API reponde, puis charge le jeu de donnees DEMO
 *    (organisation marquee isDemo, creee via l'API reelle) ;
 * 6. affiche l'URL a ouvrir.
 *
 * Prerequis : Node >= 20, pnpm 9, et une base PostgreSQL joignable via
 * DATABASE_URL (par ex. `docker compose -f docker-compose.dev.yml up -d`).
 * Options : --no-demo (sans donnees de demonstration).
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const withDemo = !process.argv.includes("--no-demo");
const webPort = process.env.WEB_PORT ?? "3100";
const apiPort = process.env.API_PORT ?? "4000";

function run(label, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit", shell: isWindows });
  if (result.status !== 0) {
    console.error(`\nEchec : ${label}`);
    process.exit(result.status ?? 1);
  }
}

function start(label, args, env = {}) {
  const child = spawn("pnpm", args, {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    env: { ...process.env, ...env },
  });
  const prefix = `[${label}] `;
  child.stdout.on("data", (chunk) => process.stdout.write(prefix + chunk.toString().replace(/\n(?=.)/g, `\n${prefix}`)));
  child.stderr.on("data", (chunk) => process.stderr.write(prefix + chunk.toString().replace(/\n(?=.)/g, `\n${prefix}`)));
  return child;
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // service pas encore pret
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  return false;
}

if (!existsSync(resolve(root, ".env"))) {
  // Cle MFA propre a cette machine (jamais committee) : la MFA TOTP est
  // ainsi utilisable immediatement en local.
  const example = readFileSync(resolve(root, ".env.example"), "utf8");
  const key = randomBytes(32).toString("base64");
  writeFileSync(resolve(root, ".env"), example.replace(/^MFA_ENCRYPTION_KEY=.*$/m, `MFA_ENCRYPTION_KEY="${key}"`));
  console.log("Fichier .env cree depuis .env.example (cle MFA locale generee)");
}

run("Generation du client Prisma", ["db:generate"]);
run("Application des migrations", ["db:migrate:deploy"]);
run("Compilation des paquets partages", ["build:packages"]);

const children = [
  start("api", ["dev:api"]),
  start("web", ["dev"], { NEXT_PUBLIC_SHOW_DEMO_LOGIN: withDemo ? "true" : "false" }),
];

function shutdown() {
  for (const child of children) child.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const apiReady = await waitFor(`http://localhost:${apiPort}/health`, 120_000);
if (!apiReady) {
  console.error("L'API n'a pas demarre en 2 minutes — verifiez DATABASE_URL et les journaux [api].");
  shutdown();
}

if (withDemo) {
  run("Chargement du jeu de donnees DEMO", ["demo:seed"]);
}

await waitFor(`http://localhost:${webPort}/login`, 180_000);
console.log(`\n==============================================================`);
console.log(`  AXORA-ERP24 est pret : http://localhost:${webPort}`);
if (withDemo) console.log(`  Compte DEMO : demo@axora-erp24.local / Demo2026!`);
console.log(`  Arret : Ctrl+C`);
console.log(`==============================================================\n`);
