import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openScreen, watchProblems } from "./support";

/**
 * Retour fournisseur sur une commande DEMO réellement réceptionnée :
 * la saisie passe par l'API réelle, le reçu net baisse et l'historique
 * du retour apparaît. Le parcours est rejouable : il ne retourne qu'une
 * petite fraction (0,1) du reçu net de la première ligne.
 */
test("Achats : retour fournisseur depuis une commande réceptionnée", async ({ page }) => {
  const problems = watchProblems(page);
  await openScreen(page, "/procurement");
  const orders = await page.request.get("/api/v1/procurement/orders");
  expect(orders.ok()).toBe(true);
  const list = (await orders.json()) as Array<{ id: string; code: string; status: string; lines: Array<{ description: string; receivedQuantity: string }> }>;
  const order = list.find((entry) => ["PARTIALLY_RECEIVED", "RECEIVED"].includes(entry.status) && entry.lines.some((line) => Number(line.receivedQuantity) >= 0.1));
  test.skip(!order, "Aucune commande DEMO réceptionnée");
  const line = order!.lines.find((candidate) => Number(candidate.receivedQuantity) >= 0.1)!;
  const before = Number(line.receivedQuantity);

  await openScreen(page, `/procurement/orders/${order!.id}`);
  await expect(page.getByRole("heading", { name: "Retours fournisseur" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Retourné" })).toBeVisible();
  await page.getByRole("button", { name: /Retour fournisseur/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: `Retour fournisseur — ${order!.code}` })).toBeVisible();

  const axe = await new AxeBuilder({ page }).include("[role=dialog]").withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations.map((violation) => violation.id)).toEqual([]);

  await dialog.getByLabel(`Quantité retournée ${line.description}`).fill("0,1");
  await dialog.getByLabel(/Motif du retour/).fill("Contrôle qualité navigateur : unité endommagée");
  await dialog.getByRole("button", { name: "Enregistrer le retour" }).click();
  await expect(page.getByText(/Retour fournisseur enregistré/)).toBeVisible();
  await expect(page.getByRole("cell", { name: "Contrôle qualité navigateur : unité endommagée" }).first()).toBeVisible();

  const after = (await (await page.request.get(`/api/v1/procurement/orders/${order!.id}`)).json()) as { lines: Array<{ description: string; receivedQuantity: string }> };
  const updated = after.lines.find((candidate) => candidate.description === line.description)!;
  expect(Number(updated.receivedQuantity)).toBeCloseTo(before - 0.1, 3);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Retours fournisseur" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(problems).toEqual([]);
});
