import { expect, test } from "@playwright/test";
import { openScreen, SCREENS } from "./support";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablette", width: 768, height: 1024 },
];

for (const viewport of VIEWPORTS) {
  test.describe(`Responsive ${viewport.name} (${viewport.width} px)`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });
    for (const path of SCREENS) {
      test(`${path} sans defilement horizontal`, async ({ page }) => {
        await openScreen(page, path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}
