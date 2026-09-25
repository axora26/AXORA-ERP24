import { test as setup } from "@playwright/test";
import { login } from "./support";

/** Une seule connexion pour la suite : la session est reutilisee par les ecrans. */
setup("connexion du compte DEMO", async ({ page }) => {
  await login(page);
  await page.context().storageState({ path: "e2e/.auth/demo.json" });
});
