import { expect, test } from "@playwright/test";

test.describe("Securite cote navigateur", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of ["/", "/finance", "/admin/users", "/copilot"]) {
    test(`${path} sans session renvoie vers la connexion`, async ({ page }) => {
      await page.goto(path);
      await page.waitForURL(/\/login/);
      await expect(page.locator("#email")).toBeVisible();
    });
  }

  test("l'API refuse une requete sans session, en francais", async ({ request }) => {
    const response = await request.get("/api/v1/auth/context");
    expect(response.status()).toBe(401);
    expect((await response.json()).message).toBe("Aucune session : veuillez vous connecter");
    expect(response.headers()["cache-control"]).toBe("no-store");
    expect(response.headers()["x-powered-by"]).toBeUndefined();
  });

  test("en-tetes de securite de l'interface", async ({ request }) => {
    const response = await request.get("/login");
    const headers = response.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toContain("microphone=()");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("identifiants errones : message en francais, aucune session", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#email").fill("inconnu@axora-erp24.local");
    await page.locator("#password").fill("mauvais-mot-de-passe");
    await page.getByRole("button", { name: /Se connecter/ }).click();
    // Au-dela de 5 echecs en 15 min pour ce couple (e-mail, IP), le message de limitation prend le relais.
    await expect(page.locator(".form-error[role='alert']")).toHaveText(/^(Identifiants invalides\.|Trop de tentatives\. Réessayez dans 15 minutes\.)$/);
    await expect(page).toHaveURL(/\/login/);
  });
});
