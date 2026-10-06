import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("les règles de paie restent accessibles sans lecture des salaires", async ({ page, browser }) => {
  const context = await (await page.request.get("/api/v1/auth/context")).json() as { organization: { slug: string }; companies: Array<{ id: string }> };
  const unique = Date.now().toString(36);
  const password = "Qualification2026!Axora";
  for (const mode of ["manage", "read"] as const) {
    const permission = mode === "manage" ? "hr.payrollpolicy.manage" : "hr.payroll.read";
    const roleResponse = await page.request.post("/api/v1/admin/roles", { data: { name: `PAYROLL_${mode}_${unique}`, permissions: [permission] } });
    expect(roleResponse.ok()).toBeTruthy();
    const role = await roleResponse.json() as { id: string };
    const email = `payroll-${mode}-${unique}@axora-erp24.local`;
    const userResponse = await page.request.post("/api/v1/admin/users", { data: { email, fullName: `Contrôle paie ${mode}`, password, companyIds: context.companies.map(company => company.id), roleIds: [role.id] } });
    expect(userResponse.ok()).toBeTruthy();
    const limited = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const limitedPage = await limited.newPage();
    try {
      const login = await limited.request.post("http://localhost:3100/api/v1/auth/login", { data: { email, password, organizationSlug: context.organization.slug } });
      expect(login.ok()).toBeTruthy();
      const hrRequests: string[] = [];
      limitedPage.on("request", request => { if (/\/hr\/(employees|payroll(?:\?|$)|timesheets)/.test(request.url())) hrRequests.push(request.url()); });
      await limitedPage.goto("http://localhost:3100/hr/payroll-policy");
      await expect(limitedPage.getByRole("heading", { name: "Règles de préparation automatique", exact: true })).toBeVisible();
      await expect(limitedPage.getByRole("navigation").getByRole("link", { name: "Règles de paie", exact: true })).toBeVisible();
      await expect(limitedPage.getByRole("navigation").getByRole("link", { name: "RH & temps", exact: true })).toHaveCount(0);
      if (mode === "manage") {
        await limitedPage.getByRole("button", { name: "Configurer le calcul" }).click();
        await expect(limitedPage.getByRole("dialog")).toBeVisible();
        await limitedPage.getByRole("button", { name: "Fermer", exact: true }).click();
        expect((await limited.request.get("http://localhost:3100/api/v1/hr/payroll")).status()).toBe(403);
      } else await expect(limitedPage.getByRole("button", { name: "Configurer le calcul" })).toHaveCount(0);
      expect(hrRequests).toEqual([]);
      const axe = await new AxeBuilder({ page: limitedPage }).include("main.workspace").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.map(violation => violation.id)).toEqual([]);
    } finally { await limited.close(); }
  }
});
