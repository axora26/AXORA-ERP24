import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(character).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
}

test.describe("Récupération de la double authentification", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test("activer, enregistrer les codes, se connecter avec un code puis désactiver avec un autre", async ({ page }) => {
    const unique = Date.now().toString(36);
    const email = `mfa-${unique}@axora-erp24.local`;
    const password = "Qualification2026!Axora";
    const created = await page.request.post("/api/v1/auth/register-organization", { data: { organizationName: `MFA ${unique}`, organizationSlug: `mfa-${unique}`, companyName: "Entreprise MFA", ownerFullName: "Administrateur MFA", ownerEmail: email, ownerPassword: password } });
    expect(created.status()).toBe(201);
    await page.goto("/account");
    const panel = page.locator("article.panel").filter({ has: page.getByRole("heading", { name: "Double authentification", exact: true }) });
    await panel.getByLabel("Mot de passe actuel").fill(password);
    const setupResponse = page.waitForResponse(r => r.url().includes("/auth/mfa/setup") && r.request().method() === "POST");
    await panel.getByRole("button", { name: "Configurer la protection" }).click();
    const setup = await (await setupResponse).json() as { secret: string };
    await panel.getByLabel("Code à 6 chiffres").fill(totp(setup.secret));
    await panel.getByRole("button", { name: "Activer la protection" }).click();
    const dialog = page.getByRole("dialog", { name: "Enregistrer vos codes de récupération" });
    await expect(dialog).toBeVisible();
    const codes = await dialog.locator(".recovery-code-list code").allTextContents();
    expect(codes).toHaveLength(10);
    await dialog.getByRole("button", { name: "J’ai enregistré mes codes" }).click();
    await expect(panel).toContainText("10 codes de récupération disponibles");
    await page.request.post("/api/v1/auth/logout");
    await page.goto("/login");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: /Se connecter/ }).click();
    await page.getByRole("button", { name: "Utiliser un code de récupération" }).click();
    await page.getByLabel("Code de récupération", { exact: true }).fill(codes[0]!);
    await page.getByRole("button", { name: "Vérifier", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/account");
    await expect(panel).toContainText("9 codes de récupération disponibles");
    await panel.getByRole("button", { name: "Désactiver la protection" }).click();
    await panel.getByLabel("Mot de passe actuel").fill(password);
    await panel.getByRole("button", { name: "Utiliser un code de récupération" }).click();
    await panel.getByLabel("Code de récupération").fill(codes[1]!);
    await panel.getByRole("button", { name: "Désactiver la double authentification" }).click();
    await expect(panel.getByText("Désactivée", { exact: true })).toBeVisible();
    const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
    for (const code of codes) expect(stored).not.toContain(code);
  });
});
