import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("Surfaces d’accès", () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  for (const theme of ["light", "dark"] as const) {
    for (const width of [1280, 375]) {
      test(`connexion et inscription accessibles en ${theme}, ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript(value => window.localStorage.setItem("axora.theme", value), theme);
        for (const path of ["/login", "/register"]) {
          await page.goto(path);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
          await expect(page.locator(".login-card")).toBeVisible();
          const colors = await page.locator(".login-panel").evaluate(element => ({ background: getComputedStyle(element).backgroundColor, root: getComputedStyle(document.documentElement).backgroundColor, scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
          if (theme === "dark") expect(colors.background).toBe("rgb(17, 24, 39)");
          expect(colors.scrollWidth).toBeLessThanOrEqual(colors.clientWidth + 1);
          const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
          expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
        }
      });
    }
  }
});
