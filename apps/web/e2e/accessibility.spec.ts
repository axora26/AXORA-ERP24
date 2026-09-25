import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { openScreen, SCREENS } from "./support";

const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function violations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();
  // Forme lisible en cas d'echec : regle, impact et premiers elements fautifs.
  return result.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.slice(0, 3).map((node) => node.target.join(" ")),
  }));
}

test.describe("Accessibilite WCAG 2.1 AA (axe-core)", () => {
  test.describe("sans session", () => {
    test.use({ storageState: { cookies: [], origins: [] } });
    for (const path of ["/login", "/offline", "/portal/login"]) {
      test(`${path}`, async ({ page }) => {
        await page.goto(path);
        await page.waitForLoadState("networkidle");
        expect(await violations(page)).toEqual([]);
      });
    }

    test.describe("mobile (390 px)", () => {
      test.use({ viewport: { width: 390, height: 844 } });
      test("/login", async ({ page }) => {
        await page.goto("/login");
        await page.waitForLoadState("networkidle");
        expect(await violations(page)).toEqual([]);
      });
    });
  });

  for (const path of SCREENS) {
    test(`${path}`, async ({ page }) => {
      await openScreen(page, path);
      expect(await violations(page)).toEqual([]);
    });
  }
});
