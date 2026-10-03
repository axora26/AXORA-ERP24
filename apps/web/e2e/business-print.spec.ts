import { expect, test } from "@playwright/test";
import { AXORA_BRAND } from "@axora24/contracts";
import type { BusinessPrintKind } from "../app/components/business-print-link";

const documents: Array<{ kind: BusinessPrintKind; path: string }> = [
  { kind: "quotes", path: "/sales/quotes" }, { kind: "contracts", path: "/sales/contracts" },
  { kind: "purchase-requests", path: "/procurement/requests" }, { kind: "purchase-orders", path: "/procurement/orders" },
  { kind: "daily-logs", path: "/field/logs" }, { kind: "commissioning", path: "/commissioning/activities" },
  { kind: "timesheets", path: "/hr/timesheets" }, { kind: "stock-movements", path: "/inventory/movements?limit=500" },
];
for (const { kind, path } of documents) {
  test(`impression AXORA : ${kind}`, async ({ page }, testInfo) => {
    const context = await (await page.request.get("/api/v1/auth/context")).json() as { companies: Array<{ id: string; name: string }> };
    const company = context.companies[0]!;
    let sourcePath = path;
    if (kind === "daily-logs") {
      const projects = await (await page.request.get(`/api/v1/projects?companyId=${company.id}`)).json() as Array<{ id: string }>;
      let projectId: string | null = null;
      for (const project of projects) {
        const logs = await page.request.get(`/api/v1/field/logs?projectId=${project.id}&companyId=${company.id}`);
        if (logs.ok() && (await logs.json() as unknown[]).length > 0) { projectId = project.id; break; }
      }
      expect(projectId, "Le jeu de démonstration doit contenir un journal de chantier").toBeTruthy();
      sourcePath = `${path}?projectId=${projectId}`;
    }
    const response = await page.request.get(`/api/v1${sourcePath}${sourcePath.includes("?") ? "&" : "?"}companyId=${company.id}`);
    expect(response.ok()).toBeTruthy();
    const records = await response.json() as Array<{ id: string; type?: string }>;
    const record = kind === "stock-movements" ? records.find(item => item.type === "ISSUE" || item.type === "RETURN") : records[0];
    expect(record, `Le jeu de démonstration doit contenir un document ${kind}`).toBeTruthy();
    await page.goto(`/print/${kind}/${record!.id}?companyId=${company.id}`);
    await expect(page.locator(".axora-print-document")).toBeVisible();
    const logo = page.getByRole("img", { name: AXORA_BRAND.name, exact: true });
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    await expect(page.locator(".axora-print-header")).toContainText(company.name);
    await expect(page.locator(".axora-print-footer")).toContainText(AXORA_BRAND.address);
    await expect(page.locator(".axora-print-footer")).toContainText("infos@axora.cd");
    await expect(page.locator(".axora-print-footer")).toContainText("+243 810 364 612");
    await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".axora-print-document")).toHaveAttribute("data-print-margin-boxes", "supported");
    await page.evaluate(async () => { await document.fonts.ready; });
    const pdf = await page.pdf({ path: testInfo.outputPath(`${kind}.pdf`), format: "A4", printBackground: true, preferCSSPageSize: true });
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    // Short demo documents must not acquire a page containing only the footer.
    // The commissioning report exercises a real two-page table with a repeated header.
    const pages = pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [];
    expect(pages).toHaveLength(kind === "commissioning" ? 2 : 1);
    await testInfo.attach(`${kind}-pdf`, { path: testInfo.outputPath(`${kind}.pdf`), contentType: "application/pdf" });
    await page.setViewportSize({ width: 375, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

test("bon de réception : sélection exacte dans sa commande", async ({ page }) => {
  const context = await (await page.request.get("/api/v1/auth/context")).json() as { companies: Array<{ id: string }> };
  const company = context.companies[0]!;
  const orders = await (await page.request.get(`/api/v1/procurement/orders?companyId=${company.id}`)).json() as Array<{ id: string; receipts: Array<{ id: string; code: string }> }>;
  const order = orders.find(item => item.receipts.length > 0);
  expect(order, "Une réception de démonstration est nécessaire").toBeTruthy();
  const receipt = order!.receipts[0]!;
  await page.goto(`/print/goods-receipts/${order!.id}?companyId=${company.id}&receiptId=${receipt.id}`);
  await expect(page.getByRole("heading", { name: "Bon de réception", exact: true })).toBeVisible();
  await expect(page.locator(".axora-print-reference")).toHaveText(receipt.code);
  await page.goto(`/print/goods-receipts/${order!.id}?companyId=${company.id}&receiptId=missing`);
  await expect(page.locator("main").getByRole("alert")).toContainText("n’a pas été trouvé");
  await expect(page.locator(".axora-print-document")).toHaveCount(0);
});

test("l’impression refuse une entreprise étrangère", async ({ page }) => {
  await page.goto("/print/timesheets/missing?companyId=company-not-member");
  await expect(page.locator("main").getByRole("alert")).toContainText("entreprise sélectionnée");
  await expect(page.locator(".axora-print-document")).toHaveCount(0);
});
