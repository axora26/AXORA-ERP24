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
import { createServer } from "node:net";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";
const withDemo = !process.argv.includes("--no-demo");
let shuttingDown = false;
const children = [];

function run(label, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync("pnpm", args, { cwd: root, stdio: "inherit", shell: isWindows });
  if (result.status !== 0) {
    console.error(`\nEchec : ${label}`);
    shutdown(result.status ?? 1);
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
  child.on("error", (error) => {
    console.error(`${label} : ${error.message}`);
    shutdown(1);
  });
  child.on("exit", () => {
    if (!shuttingDown) {
      console.error(`${label} s'est arrete ; fermeture de l'instance locale.`);
      shutdown(1);
    }
  });
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (response.ok) return true;
    } catch {
      // service pas encore pret
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1000));
  }
  return false;
}

const envPath = resolve(root, ".env");
let localEnvironment = readFileSync(existsSync(envPath) ? envPath : resolve(root, ".env.example"), "utf8");
for (const key of ["MFA_ENCRYPTION_KEY", "INTEGRATION_ENCRYPTION_KEY", "SERVICE_CARD_ENCRYPTION_KEY"]) {
  const pattern = new RegExp(`^${key}=(.*)$`, "m");
  const existing = pattern.exec(localEnvironment)?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (!existing && !process.env[key]) {
    const line = `${key}="${randomBytes(32).toString("base64")}"`;
    localEnvironment = pattern.test(localEnvironment) ? localEnvironment.replace(pattern, line) : `${localEnvironment}\n${line}\n`;
  }
}
writeFileSync(envPath, localEnvironment);
// Same precedence as the API and Prisma: explicit environment wins.
for (const raw of localEnvironment.split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  const separator = line.indexOf("=");
  if (separator < 1) continue;
  const key = line.slice(0, separator).trim();
  const value = line.slice(separator + 1).trim();
  if (process.env[key] === undefined || process.env[key] === "") {
    process.env[key] = value.replace(/^(["'])(.*)\1$/, "$2");
  }
}
const webPort = process.env.WEB_PORT ?? "3100";
const apiPort = process.env.API_PORT ?? "4000";
for (const port of [apiPort, webPort]) {
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    console.error("API_PORT et WEB_PORT doivent etre des ports valides.");
    process.exit(1);
  }
  await new Promise((accept, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(Number(port), "127.0.0.1", () => server.close(accept));
  }).catch(() => {
    console.error(`Le port ${port} est deja utilise : arretez cette instance avant de relancer AXORA.`);
    process.exit(1);
  });
}
process.env.CORS_ORIGIN ||= `http://localhost:${webPort}`;
process.env.API_INTERNAL_URL ||= `http://localhost:${apiPort}`;

run("Generation du client Prisma", ["db:generate"]);
run("Application des migrations", ["db:migrate:deploy"]);
run("Compilation des paquets partages", ["build:packages"]);

start("api", ["dev:api"]);
start("web", ["--filter", "@axora24/web", "exec", "next", "dev", "-p", webPort, "-H", process.env.WEB_HOST ?? "127.0.0.1"], { NEXT_PUBLIC_SHOW_DEMO_LOGIN: withDemo ? "true" : "false" });

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    // Windows launches pnpm through cmd; kill that owned process tree too.
    if (isWindows && child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    else child.kill();
  }
  process.exit(exitCode);
}
process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

const apiReady = await waitFor(`http://localhost:${apiPort}/health`, 120_000);
if (!apiReady) {
  console.error("L'API n'a pas demarre en 2 minutes — verifiez DATABASE_URL et les journaux [api].");
  shutdown(1);
}

if (withDemo) {
  run("Chargement du jeu de donnees DEMO", ["demo:seed"]);
}

if (!await waitFor(`http://localhost:${webPort}/login`, 180_000)) {
  console.error("L'interface n'a pas demarre en 3 minutes — consultez les journaux [web].");
  shutdown(1);
}
console.log(`\n==============================================================`);
console.log(`  AXORA-ERP24 est pret : http://localhost:${webPort}`);
if (withDemo) console.log(`  Compte DEMO : demo@axora-erp24.local / Demo2026!Axora`);
console.log(`  Arret : Ctrl+C`);
console.log(`==============================================================\n`);
