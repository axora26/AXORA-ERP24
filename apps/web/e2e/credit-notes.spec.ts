import AxeBuilder from "@axe-core/playwright";
import type { AdminRoleView, BankAccountView, CustomerInvoiceView, TaxRateView } from "@axora24/contracts";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function post<T = unknown>(request: APIRequestContext, path: string, data: object = {}): Promise<T> {
  const response = await request.post(`/api/v1${path}`, { data });
  expect(response.ok(), `${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

test.describe("Avoirs clients réels", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("préparer, corriger, émettre, rembourser et imprimer avec les droits adaptés", async ({ page }) => {
    const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const password = "Qualification2026!Axora";
    const today = new Date().toISOString().slice(0, 10);
    await post(page.request, "/auth/register-organization", { organizationName: `Avoirs ${unique}`, organizationSlug: `avoirs-${unique}`, companyName: "Entreprise Avoirs", ownerFullName: "Administrateur Avoirs", ownerEmail: `avoirs-${unique}@axora-erp24.local`, ownerPassword: password });
    const context = await (await page.request.get("/api/v1/auth/context")).json();
    const companyId = context.companies[0].id as string;
    const banks = await post<BankAccountView[]>(page.request, "/finance/bank-accounts", { code: "CREDIT-BANK", name: "Compte des avoirs", currency: "USD", openingBalance: "1000.00" });
    const bankId = banks.find((bank) => bank.code === "CREDIT-BANK")!.id;
    const taxes = await post<TaxRateView[]>(page.request, "/finance/tax-rates", { name: "Taxe source 20", rate: "20" });
    const taxId = taxes.find((tax) => tax.name === "Taxe source 20")!.id;
    const draft = await post<CustomerInvoiceView>(page.request, "/finance/invoices", { customerName: "Client Correction", currency: "USD", lines: [{ description: "Prestation facturée", quantity: "2", unitPrice: "50", taxRateId: taxId }] });
    const invoice = await post<CustomerInvoiceView>(page.request, `/finance/invoices/${draft.id}/issue`, { issueDate: today });
    await post(page.request, "/finance/payments", { invoiceType: "CUSTOMER", invoiceId: invoice.id, bankAccountId: bankId, amount: "120.00", paidAt: today, method: "TRANSFER", reference: "PAY-CREDIT-BROWSER", idempotencyKey: `PAY-CREDIT-${unique}` });
    await page.goto("/finance");
    await page.getByRole("tab", { name: "Avoirs & remboursements", exact: true }).click();
    await page.getByRole("button", { name: "Préparer un avoir", exact: true }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: /Facture d’origine/ }).selectOption(invoice.id);
    await dialog.getByRole("textbox", { name: /Motif de l’avoir/ }).fill("Correction de la quantité facturée");
    await dialog.getByRole("textbox", { name: "Quantité à corriger : Prestation facturée" }).fill("0.5");
    const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map(violation => violation.id)).toEqual([]);
    const prepared = page.waitForResponse(response => response.url().includes("/finance/customer-credit-notes") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Préparer le brouillon", exact: true }).click();
    const note = await (await prepared).json();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Avoir en préparation · version 1", exact: true })).toBeVisible();
    expect(note.total).toBe("30.00");
    await page.getByRole("button", { name: "Modifier le brouillon", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Quantité à corriger : Prestation facturée" }).fill("1");
    await dialog.getByRole("textbox", { name: /Motif de l’avoir/ }).fill("Correction finale de la moitié de la facture");
    await dialog.getByRole("button", { name: "Enregistrer la nouvelle version", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Avoir en préparation · version 2", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Émettre l’avoir", exact: true }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel(/Date d’émission/).fill(today);
    await dialog.getByRole("button", { name: "Confirmer l’émission", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const issued = await (await page.request.get(`/api/v1/finance/customer-credit-notes/${note.id}`)).json();
    expect(issued).toMatchObject({ status: "ISSUED", total: "60.00", reason: "Correction finale de la moitié de la facture" });
    expect(issued.lines[0]).toMatchObject({ quantity: "1.000000", unitPrice: "50.000000", taxRate: "20.00" });
    expect(issued.invoice).toMatchObject({ netTotal: "60.00", netPaidAmount: "120.00", refundDue: "60.00" });
    await expect(page.getByRole("button", { name: "Modifier le brouillon", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Rembourser le client", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: /Montant \(USD\)/ })).toHaveValue("60.00");
    await dialog.getByRole("textbox", { name: /Montant \(USD\)/ }).fill("61.00");
    await dialog.getByRole("button", { name: "Enregistrer le remboursement", exact: true }).click();
    await expect(dialog.getByText(/Saisissez un montant positif inférieur ou égal à/)).toBeVisible();
    await dialog.getByRole("textbox", { name: /Montant \(USD\)/ }).fill("60.00");
    await dialog.getByRole("textbox", { name: /Référence/ }).fill("REMBOURSEMENT-UI");
    await dialog.getByRole("button", { name: "Enregistrer le remboursement", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("cell", { name: "REMBOURSEMENT-UI", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rembourser le client", exact: true })).toHaveCount(0);
    const refunded = await (await page.request.get(`/api/v1/finance/customer-credit-notes/${note.id}`)).json();
    expect(refunded.invoice).toMatchObject({ creditedAmount: "60.00", refundedAmount: "60.00", netTotal: "60.00", netPaidAmount: "60.00", balanceDue: "0.00", refundDue: "0.00" });
    expect(refunded.refunds).toHaveLength(1);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "PDF de l’avoir", exact: true }).click();
    expect((await downloadPromise).suggestedFilename()).toMatch(/^AVC-.+\.pdf$/);

    await page.goto(`/print/invoices/${invoice.id}?companyId=${companyId}`);
    await expect(page.getByRole("heading", { name: "Facture", exact: true })).toBeVisible();
    const logo = page.getByRole("img", { name: "AXORA GROUP", exact: true });
    await expect(logo).toHaveAttribute("src", "/brand/axora-logo.png");
    await expect.poll(() => logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    await expect(page.getByText("945, Boulevard du 30 Juin, Gombe, Kinshasa, République démocratique du Congo", { exact: true })).toBeVisible();
    await expect(page.locator(".axora-print-footer")).toContainText("+243 810 364 612");
    await expect(page.locator(".axora-print-footer")).toContainText("infos@axora.cd");
    await expect(page.locator(".axora-print-footer")).toContainText("axora.cd");
    for (const [label, amount] of [["Total TTC", "120,00 USD"], ["Avoirs émis", "60,00 USD"], ["Total après avoirs", "60,00 USD"], ["Remboursements", "60,00 USD"], ["Reste à payer", "0,00 USD"]] as const) {
      await expect(page.locator(".print-totals > div").filter({ has: page.getByText(label, { exact: true }) })).toContainText(amount);
    }

    const role = await post<AdminRoleView>(page.request, "/admin/roles", { name: "Lecture des avoirs", permissions: ["finance.credit.read"] });
    const readerEmail = `credit-reader-${unique}@axora-erp24.local`;
    await post(page.request, "/admin/users", { email: readerEmail, fullName: "Lecteur des avoirs", password, companyIds: [companyId], roleIds: [role.id] });
    await post(page.request, "/auth/logout");
    await post(page.request, "/auth/login", { email: readerEmail, password });
    await page.goto("/finance");
    await expect(page.getByRole("heading", { name: "Avoirs clients", exact: true })).toBeVisible();
    await page.getByRole("button", { name: `Ouvrir ${issued.code}`, exact: true }).click();
    await expect(page.getByRole("link", { name: "PDF de l’avoir", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Préparer un avoir", exact: true })).toHaveCount(0);
    expect((await page.request.get(`/api/v1/finance/invoices/${invoice.id}`)).status()).toBe(403);
    expect((await page.request.get(`/api/v1/finance/customer-credit-notes/${note.id}/export.pdf`)).status()).toBe(200);
  });
});
