import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("le contexte société possède un groupe nommé accessible", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("group", { name: "Contexte de travail", exact: true }),
  ).toBeVisible();
  const audit = await new AxeBuilder({ page })
    .include(".company-context")
    .withRules(["aria-prohibited-attr"])
    .analyze();
  expect(audit.violations).toEqual([]);
});

test("l'action principale du cockpit reste contrastée en thème sombre", async ({
  page,
}) => {
  await page.goto("/");
  const selector = page.getByRole("combobox", { name: "Thème d’affichage" });
  await expect(selector).toBeVisible();
  const original = await selector.inputValue();
  try {
    await selector.selectOption("dark");
    await expect(selector).toBeEnabled();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".command-primary-action")).toBeVisible();
    const audit = await new AxeBuilder({ page })
      .include(".command-primary-action")
      .withRules(["color-contrast"])
      .analyze();
    expect(audit.violations).toEqual([]);
  } finally {
    await expect(selector).toBeEnabled();
    await selector.selectOption(original);
    await expect(selector).toBeEnabled();
  }
});
