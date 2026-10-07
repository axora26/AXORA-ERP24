import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { openScreen } from "./support";

test.describe("Navigation et formulaires au clavier", () => {
  test("le raccourci de contenu devient visible et rejoint le contenu", async ({ page }) => {
    await openScreen(page, "/");
    await page.evaluate(() => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute("tabindex"); });
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Aller au contenu principal" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("la palette conserve le focus, se ferme par Échap et rend le focus au déclencheur", async ({ page }) => {
    await openScreen(page, "/");
    const trigger = page.getByRole("button", { name: /Rechercher un module/ });
    await trigger.focus();
    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", { name: "Rechercher un module" });
    await expect(search).toBeFocused();
    await expect(page.locator("main.workspace")).toHaveJSProperty("inert", true);
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Fermer la recherche" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(search).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Palette de commandes" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator("main.workspace")).toHaveJSProperty("inert", false);
  });

  test("les flèches de la palette exposent une option active et permettent d’ouvrir un module", async ({ page }) => {
    await openScreen(page, "/");
    await page.keyboard.press("Control+k");
    const search = page.getByRole("combobox", { name: "Rechercher un module" });
    await search.fill("projet");
    // Plusieurs modules correspondent (« Projets », « Ressources projet »…) : les flèches
    // déplacent réellement l'option active, signalée par aria-activedescendant.
    const selected = page.getByRole("listbox", { name: "Modules accessibles" }).getByRole("option", { selected: true });
    await expect(selected).toContainText("Projets");
    const first = await search.getAttribute("aria-activedescendant");
    expect(first).toBeTruthy();
    await page.keyboard.press("ArrowDown");
    await expect(search).not.toHaveAttribute("aria-activedescendant", first!);
    await expect(selected).not.toContainText("Projets");
    await page.keyboard.press("ArrowUp");
    await expect(search).toHaveAttribute("aria-activedescendant", first!);
    await expect(selected).toContainText("Projets");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(page.getByRole("dialog", { name: "Palette de commandes" })).toHaveCount(0);
  });

  test("un formulaire modal conserve le curseur après chaque saisie et reste accessible", async ({ page }) => {
    await openScreen(page, "/admin/users");
    const trigger = page.getByRole("button", { name: "Nouvel utilisateur" });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    const name = dialog.getByRole("textbox", { name: /Nom complet/ });
    await name.focus();
    await page.keyboard.type("Qualification clavier");
    await expect(name).toHaveValue("Qualification clavier");
    await expect(name).toBeFocused();
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map(violation => violation.id)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });
});

test.describe("Navigation mobile 375 px", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("le tiroir mobile isole son contenu et restitue le focus à la fermeture", async ({ page }) => {
    await openScreen(page, "/");
    const trigger = page.getByRole("button", { name: "Ouvrir le menu" });
    await trigger.click();
    const drawer = page.getByRole("dialog", { name: "Navigation principale" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Fermer le menu" })).toBeFocused();
    await expect(page.locator("main.workspace")).toHaveJSProperty("inert", true);
    await page.keyboard.press("Shift+Tab");
    await expect(drawer.getByRole("button", { name: "Déconnexion" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Navigation principale" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator("main.workspace")).toHaveJSProperty("inert", false);
  });
});
