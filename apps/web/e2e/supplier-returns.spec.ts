import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { formatQuantity } from "../app/lib/format";
import { openScreen, watchProblems } from "./support";

async function procurementReady(page: Page): Promise<void> {
  const workspace = page.locator("main.workspace");
  // Ces onglets ne sont rendus qu'apres le Promise.all demandes/commandes/fournisseurs.
  await expect(workspace.getByRole("tab", { name: /^Commandes/ })).toBeVisible();
  await expect(workspace.locator(".crm-loading")).toHaveCount(0);
  await expect(workspace.getByRole("alert")).toHaveCount(0);
}

async function orderReady(page: Page, code: string): Promise<void> {
  const workspace = page.locator("main.workspace");
  await expect(workspace.getByRole("heading", { name: `Commande ${code}`, exact: true })).toBeVisible();
  await expect(workspace.getByRole("columnheader", { name: "Reçu net", exact: true })).toBeVisible();
  await expect(workspace.getByRole("heading", { name: "Retours fournisseur", exact: true })).toBeVisible();
  await expect(workspace.locator(".crm-loading")).toHaveCount(0);
  await expect(workspace.getByRole("alert")).toHaveCount(0);
}

/**
 * Retour fournisseur sur une commande DEMO réellement réceptionnée :
 * la saisie passe par l'API réelle, le reçu net baisse et l'historique
 * du retour apparaît. Le parcours est rejouable : il ne retourne qu'une
 * petite fraction (0,1) du reçu net de la première ligne.
 */
test("Achats : retour fournisseur depuis une commande réceptionnée", async ({ page }) => {
  const problems = watchProblems(page);
  await openScreen(page, "/procurement", procurementReady);
  const orders = await page.request.get("/api/v1/procurement/orders");
  expect(orders.ok()).toBe(true);
  const list = (await orders.json()) as Array<{ id: string; code: string; status: string; lines: Array<{ description: string; receivedQuantity: string }> }>;
  const order = list.find((entry) => ["PARTIALLY_RECEIVED", "RECEIVED"].includes(entry.status) && entry.lines.some((line) => Number(line.receivedQuantity) >= 0.1));
  test.skip(!order, "Aucune commande DEMO réceptionnée");
  const line = order!.lines.find((candidate) => Number(candidate.receivedQuantity) >= 0.1)!;
  const before = Number(line.receivedQuantity);

  await page.getByRole("tab", { name: /^Commandes/ }).click();
  await expect(page.getByRole("row").filter({ has: page.getByText(order!.code, { exact: true }) })).toBeVisible();
  await openScreen(page, `/procurement/orders/${order!.id}`, (screen) => orderReady(screen, order!.code));
  await expect(page.getByRole("heading", { name: "Retours fournisseur" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Retourné" })).toBeVisible();
  const lineRow = page.getByRole("row").filter({ has: page.getByRole("cell", { name: line.description, exact: true }) }).first();
  await expect(lineRow.getByRole("cell").nth(2)).toHaveText(formatQuantity(line.receivedQuantity, 3));
  await expect(page.getByRole("button", { name: "Retour fournisseur", exact: true })).toBeEnabled();
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

  const afterResponse = await page.request.get(`/api/v1/procurement/orders/${order!.id}`);
  expect(afterResponse.ok()).toBe(true);
  const after = (await afterResponse.json()) as { lines: Array<{ description: string; receivedQuantity: string }> };
  const updated = after.lines.find((candidate) => candidate.description === line.description)!;
  expect(Number(updated.receivedQuantity)).toBeCloseTo(before - 0.1, 3);
  await expect(lineRow.getByRole("cell").nth(2)).toHaveText(formatQuantity(updated.receivedQuantity, 3));

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
  await openScreen(page, "/procurement", procurementReady);
  const ordersResponse = await page.request.get("/api/v1/procurement/orders");
  expect(ordersResponse.ok()).toBe(true);
  const orders = (await ordersResponse.json()) as Array<{ id: string; code: string; returns: Array<{ id: string; creditNoteId: string | null }> }>;
  const payablesResponse = await page.request.get("/api/v1/finance/payables");
  expect(payablesResponse.ok()).toBe(true);
  const payables = (await payablesResponse.json()) as Array<{ orderId: string | null; status: string }>;
  const credited = new Set(payables.filter((invoice) => invoice.orderId && ["APPROVED", "PARTIALLY_PAID", "PAID"].includes(invoice.status)).map((invoice) => invoice.orderId));
  const order = orders.find((entry) => entry.returns.length > 0 && credited.has(entry.id));
  test.skip(!order, "Aucun retour sur une commande facturée et approuvée dans le jeu DEMO");

  await page.getByRole("tab", { name: /^Commandes/ }).click();
  await expect(page.getByRole("row").filter({ has: page.getByText(order!.code, { exact: true }) })).toBeVisible();
  await openScreen(page, `/procurement/orders/${order!.id}`, (screen) => orderReady(screen, order!.code));
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
