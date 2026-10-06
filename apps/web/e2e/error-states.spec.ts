import { expect, test } from "@playwright/test";
import { openScreen } from "./support";

test("un échec initial n’est pas présenté comme une absence de projets et permet un réessai", async ({ page }) => {
  await page.route("**/api/v1/projects**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Service projets indisponible" }) }));
  await openScreen(page, "/projects");
  await expect(page.getByText("Données indisponibles", { exact: true })).toBeVisible();
  await expect(page.locator(".metrics-grid")).toHaveCount(0);
  await expect(page.getByText("Aucun projet", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/v1/projects**");
  await page.getByRole("button", { name: "Réessayer le chargement" }).click();
  await expect(page.locator(".metrics-grid")).toBeVisible();
  await expect(page.getByText("Données indisponibles", { exact: true })).toHaveCount(0);
});

test("une actualisation échouée conserve les données déjà chargées et signale l’erreur", async ({ page }) => {
  await openScreen(page, "/projects");
  const before = await page.locator(".metrics-grid").innerText();
  await page.route("**/api/v1/projects**", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Service projets indisponible" }) }));
  await page.getByRole("button", { name: "Actualiser" }).click();
  await expect(page.locator("main.workspace").getByRole("alert")).toContainText("Service projets indisponible");
  expect(await page.locator(".metrics-grid").innerText()).toBe(before);
});
