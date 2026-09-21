import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * Tests UNITAIRES uniquement — aucune dependance externe (pas de PostgreSQL).
 * Ce gate doit pouvoir tourner sur un runner CI nu (`pnpm test`).
 * Les tests end-to-end (*.e2e.test.ts) exigent une base reelle et sont
 * executes separement par `pnpm test:e2e` (vitest.e2e.config.ts).
 *
 * NestJS s'appuie sur les metadonnees de decorateurs (emitDecoratorMetadata)
 * pour l'injection de dependances. Le transform esbuild par defaut de vitest
 * ne les preserve pas -> DI silencieusement cassee (services undefined dans
 * les controllers). unplugin-swc restaure un vrai pipeline TypeScript.
 */
export default defineConfig({
  test: {
    hookTimeout: 30000,
    testTimeout: 15000,
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "test/**/*.e2e.test.ts"],
  },
  plugins: [swc.vite()],
});
