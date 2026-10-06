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

/**
 * Avoir fournisseur prepare depuis le retour : le compte DEMO (droits Finance)
 * prepare un brouillon sur la facture approuvee de la commande, puis le lien
 * mene a l'onglet Avoirs de Finance. Rejouable : un retour deja crédité affiche
 * directement son lien.
 */
test("Achats : préparer l'avoir fournisseur d'un retour", async ({ page }) => {
  const problems = watchProblems(page);
  await openScreen(page, "/procurement");
  const orders = (await (await page.request.get("/api/v1/procurement/orders")).json()) as Array<{ id: string; returns: Array<{ id: string; creditNoteId: string | null }> }>;
  const payables = (await (await page.request.get("/api/v1/finance/payables")).json()) as Array<{ orderId: string | null; status: string }>;
  const credited = new Set(payables.filter((invoice) => invoice.orderId && ["APPROVED", "PARTIALLY_PAID", "PAID"].includes(invoice.status)).map((invoice) => invoice.orderId));
  const order = orders.find((entry) => entry.returns.length > 0 && credited.has(entry.id));
  test.skip(!order, "Aucun retour sur une commande facturée et approuvée dans le jeu DEMO");

  await openScreen(page, `/procurement/orders/${order!.id}`);
  await expect(page.getByRole("columnheader", { name: "Avoir fournisseur" })).toBeVisible();
  const prepare = page.getByRole("button", { name: "Préparer l’avoir" }).first();
  if (await prepare.isVisible()) {
    await prepare.click();
    await expect(page.getByText(/Brouillon d’avoir préparé/)).toBeVisible();
  }
  const link = page.getByRole("link", { name: /Brouillon d’avoir à émettre|Avoir .* émis/ }).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/finance\?tab=credits$/);
  await expect(page.getByRole("tab", { name: "Avoirs & remboursements", selected: true })).toBeVisible();
  expect(problems).toEqual([]);
});
