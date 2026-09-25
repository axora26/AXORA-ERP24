import { expect, type Page } from "@playwright/test";

/** Compte de demonstration cree par `pnpm demo:seed` (organisation marquee DEMO). */
export const DEMO_USER = {
  email: process.env.E2E_EMAIL ?? "demo@axora-erp24.local",
  password: process.env.E2E_PASSWORD ?? "Demo2026!",
};

/** Tous les ecrans de premier niveau de l'application interne. */
export const SCREENS = [
  "/",
  "/crm",
  "/estimation",
  "/sales",
  "/projects",
  "/procurement",
  "/inventory",
  "/finance",
  "/hr",
  "/documents",
  "/field",
  "/qhse",
  "/commissioning",
  "/mep",
  "/bim",
  "/assets",
  "/smart",
  "/energy",
  "/fleet",
  "/subcontracting",
  "/portal-admin",
  "/workflow",
  "/copilot",
  "/analytics",
  "/integrations",
  "/admin/users",
  "/admin/roles",
  "/admin/companies",
  "/admin/audit",
  "/account",
] as const;

export async function login(page: Page, user = DEMO_USER): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(user.password);
  await page.getByRole("button", { name: /Se connecter/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * Collecte les erreurs visibles d'un ecran : exceptions JavaScript, erreurs
 * console et reponses serveur 5xx de l'API. Un ecran sain n'en produit aucune.
 */
export function watchProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(`exception : ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console : ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500 && new URL(response.url()).pathname.startsWith("/api/")) problems.push(`HTTP ${response.status()} ${response.url()}`);
  });
  return problems;
}

/** Ouvre un ecran et attend que son titre et ses chargements soient termines. */
export async function openScreen(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  // Le titre est rendu dans l'espace de travail (et non l'ecran de chargement de session).
  await expect(page.locator("main.workspace h1").first()).toBeVisible();
}
