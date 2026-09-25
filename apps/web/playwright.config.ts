import { defineConfig, devices } from "@playwright/test";

/**
 * Tests navigateur (gate 4 de 05-qa-devops) : ils s'executent contre une
 * instance reelle (API + base PostgreSQL + jeu DEMO), jamais contre des
 * reponses simulees. Par defaut : `pnpm local` (http://localhost:3100).
 * Le parcours hors ligne exige un build de production (service worker) :
 * E2E_BASE_URL=http://localhost:3200 apres `next build && next start -p 3200`.
 */
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
// Navigateur deja installe hors du cache Playwright (poste sans telechargement).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  // Une seule instance partagee et des donnees DEMO communes : execution sequentielle.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["json", { outputFile: "playwright-report/results.json" }]],
  use: {
    baseURL,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    trace: "retain-on-failure",
    launchOptions: { executablePath },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/demo.json" },
    },
  ],
});
