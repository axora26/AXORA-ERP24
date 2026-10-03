import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { SCREENS, openScreen } from "./support";

test("le thème sombre est enregistré sur le compte, conservé au rechargement et lisible dans les modules", async ({ page }, testInfo) => {
  await openScreen(page, "/");
  const selector = page.getByRole("combobox", { name: "Thème d’affichage" });
  const current = await page.request.get("/api/v1/auth/preferences");
  expect(current.ok()).toBeTruthy();
  const original = await current.json() as { theme: string };
  try {
    const save = page.waitForResponse(response => response.url().includes("/auth/preferences") && response.request().method() === "PATCH");
    await selector.selectOption("dark");
    expect((await save).ok()).toBeTruthy();
    await expect(selector).toBeEnabled();
    await page.reload();
    await expect(selector).toHaveValue("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    const findings: Array<{ path: string; violations: unknown[] }> = [];
    for (const path of SCREENS) {
      await openScreen(page, path);
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      if (results.violations.length) findings.push({ path, violations: results.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) })) });
    }
    if (findings.length) {
      const path = testInfo.outputPath("dark-axe-findings.json");
      await writeFile(path, JSON.stringify(findings, null, 2), "utf8");
      await testInfo.attach("dark-axe-findings", { path, contentType: "application/json" });
    }
    expect(findings.map(item => ({ path: item.path, ids: item.violations.map(value => (value as { id: string }).id) })), "Accessibilité des modules en thème sombre").toEqual([]);
  } finally {
    if (await selector.isVisible()) {
      const saved = page.waitForResponse(response => response.url().includes("/auth/preferences") && response.request().method() === "PATCH");
      await selector.selectOption(original.theme);
      await saved;
    }
  }
});
