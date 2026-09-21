import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
 * Tests END-TO-END — exigent une base PostgreSQL reelle joignable via
 * DATABASE_URL (docker-compose.dev.yml en local, service `postgres` en CI)
 * avec les migrations Prisma deja appliquees.
 *
 * Execution sequentielle (singleFork) : les suites e2e partagent la meme base
 * et creent des organisations reelles ; un parallelisme non controle rendrait
 * les assertions d'isolation non deterministes.
 */
export default defineConfig({
  test: {
    hookTimeout: 60000,
    testTimeout: 30000,
    include: ["test/**/*.e2e.test.ts"],
    // Charge DATABASE_URL depuis le .env du monorepo sans ecraser un env reel (CI).
    setupFiles: ["test/setup-env.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  plugins: [swc.vite()],
});
