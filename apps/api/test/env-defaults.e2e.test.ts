import { describe, expect, it } from "vitest";

/** Garde-fou : le .env de developpement ne doit jamais activer le planificateur pendant les tests. */
describe("Environnement de test", () => {
  it("planificateur d'automatisation desactive, cibles webhook locales admises", () => {
    expect(process.env.AUTOMATION_AUTORUN).toBe("false");
    expect(process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS).toBe("true");
    expect(process.env.DATABASE_URL).toBeTruthy();
  });
});
