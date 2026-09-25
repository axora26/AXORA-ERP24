import { expect, test } from "@playwright/test";
import { login } from "./support";

test.describe("PWA", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("manifeste installable et service worker toujours revalide", async ({ request }) => {
    const manifest = await (await request.get("/manifest.json")).json();
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBeTruthy();
    const icons: Array<{ sizes: string; purpose?: string }> = manifest.icons;
    expect(icons.some((icon) => icon.sizes === "192x192")).toBe(true);
    expect(icons.some((icon) => icon.sizes === "512x512")).toBe(true);
    expect(icons.some((icon) => (icon.purpose ?? "").includes("maskable"))).toBe(true);
    const worker = await request.get("/sw.js");
    expect(worker.status()).toBe(200);
    expect(worker.headers()["cache-control"]).toContain("no-store");
  });

  test("chantier hors ligne puis purge a la deconnexion (build de production)", async ({ page, context, request }) => {
    // Le service worker n'est enregistre qu'en production (le serveur de dev garde le rechargement a chaud).
    const production = Boolean((await request.get("/login")).headers()["content-security-policy"]);
    test.skip(!production, "Service worker actif uniquement sur un build de production (E2E_BASE_URL vers next start)");

    const cspViolations: string[] = [];
    page.on("console", (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) cspViolations.push(message.text());
    });
    await login(page);
    await page.evaluate(async () => navigator.serviceWorker.ready);
    await page.goto("/field");
    await page.waitForLoadState("networkidle");
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    const onlineRows = await page.locator("tbody tr").count();
    expect(onlineRows).toBeGreaterThan(0);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator(".offline-strip")).toBeVisible();
    await expect(page.locator("tbody tr")).toHaveCount(onlineRows);
    // Aucune reponse d'API n'est jamais conservee par le service worker.
    const apiCached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const entry of await (await caches.open(name)).keys()) urls.push(new URL(entry.url).pathname);
      return urls.filter((path) => path.startsWith("/api/"));
    });
    expect(apiCached).toEqual([]);
    await context.setOffline(false);

    await page.getByRole("button", { name: /Déconnexion/ }).click();
    await page.waitForURL(/\/login/);
    await expect
      .poll(() =>
        page.evaluate(async () => ({
          offlineData: Object.keys(localStorage).filter((key) => key.startsWith("axora.offline.") || key === "axora.context.cache"),
          fieldPageCached: (await (await caches.open("axora-pages-v1")).keys()).some((entry) => new URL(entry.url).pathname === "/field"),
        })),
      )
      .toEqual({ offlineData: [], fieldPageCached: false });
    expect(cspViolations).toEqual([]);
  });
});
