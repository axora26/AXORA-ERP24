import { expect, test } from "@playwright/test";
import { openScreen, SCREENS, watchProblems } from "./support";

test.describe("Ecrans (donnees DEMO reelles)", () => {
  for (const path of SCREENS) {
    test(`${path} s'affiche sans erreur`, async ({ page }) => {
      const problems = watchProblems(page);
      await openScreen(page, path);
      await expect(page).not.toHaveURL(/\/login/);
      expect(problems).toEqual([]);
    });
  }
});
