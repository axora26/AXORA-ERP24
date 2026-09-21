import { loadRootEnv } from "./env.js";

/**
 * Effet de bord d'import : charge le .env du monorepo AVANT toute evaluation
 * de module qui lit process.env. Doit rester le tout premier import de
 * main.ts (les imports ESM sont evalues avant le corps du module).
 */
loadRootEnv();
