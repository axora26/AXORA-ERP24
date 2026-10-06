import { expect, test } from "@playwright/test";
import { openScreen, watchProblems } from "./support";

test("Stock : le suivi des réservations expose le parcours matériel", async ({ page }) => {
  const problems = watchProblems(page);
  await openScreen(page, "/inventory");
  await page.getByRole("tab", { name: /Réservations/ }).click();
  await expect(page.getByRole("heading", { name: "Réservations de stock" })).toBeVisible();
  await expect(page.getByText("Les quantités réservées restent indisponibles")).toBeVisible();
  await expect(page.getByRole("button", { name: /Réserver du matériel/ })).toBeVisible();
  await page.getByRole("button", { name: /Réserver du matériel/ }).click();
  await expect(page.getByRole("heading", { name: "Réserver du matériel" })).toBeVisible();
  expect(problems).toEqual([]);
});
