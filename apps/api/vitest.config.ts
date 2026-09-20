import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

/**
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
  },
  plugins: [swc.vite()],
});
