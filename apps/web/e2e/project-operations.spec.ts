import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { formatDate } from "../app/lib/format";

test("opérations réelles du chantier : période, documents, mobile et accessibilité", async ({ page }) => {
  const response = await page.request.get("/api/v1/projects");
  expect(response.ok()).toBeTruthy();
  const projects = await response.json() as Array<{ id: string }>;
  expect(projects.length).toBeGreaterThan(0);
  await page.goto(`/projects/${projects[0]!.id}`);
  await page.getByRole("tab", { name: "Opérations chantier", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Présence du personnel", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Matériaux consommés et retours", exact: true })).toBeVisible();
  await page.getByLabel(/^Du/).fill("2026-01-01");
  await page.getByLabel(/^Au/).fill("2026-02-15");
  await page.getByRole("button", { name: "Afficher la période" }).click();
  await expect(page.locator(".project-operations").getByRole("alert")).toContainText("1 à 31 jours");
  await page.getByLabel(/^Au/).fill("2026-01-31");
  const updated = page.waitForResponse(result => result.url().includes("/operations?") && result.request().method() === "GET");
  await page.getByRole("button", { name: "Afficher la période" }).click();
  expect((await updated).ok()).toBeTruthy();
  await expect(page.getByRole("heading", { name: `Coûts du ${formatDate("2026-01-01")} au ${formatDate("2026-01-31")}`, exact: true })).toBeVisible();
  const report = page.waitForEvent("download");
  await page.getByRole("button", { name: "Rapport chantier / PDF" }).click();
  expect((await report).suggestedFilename()).toMatch(/\.pdf$/);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 900 });
    const axe = await new AxeBuilder({ page }).include("main.workspace").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map(violation => violation.id)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});
