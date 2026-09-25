import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";

/** INC-24 — Durcissement transverse : en-tetes de securite et messages d'erreur en francais. */
describe("INC-24 Durcissement (e2e)", () => {
  let harness: Harness;
  let tenant: Tenant;

  beforeAll(async () => {
    harness = await createHarness();
    tenant = await registerTenant(harness, "hardening");
  });

  afterAll(async () => {
    await harness?.close();
  });

  it("en-tetes de securite sur toutes les reponses de l'API, sans cache ni signature du framework", async () => {
    for (const response of [await harness.http().get("/api/v1/auth/context"), await as(harness, tenant).get("/projects")]) {
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
      expect(response.headers["x-frame-options"]).toBe("DENY");
      expect(response.headers["referrer-policy"]).toBe("no-referrer");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-powered-by"]).toBeUndefined();
    }
  });

  it("messages d'erreur en francais, statut et forme de reponse conserves", async () => {
    const unauthenticated = await harness.http().get("/api/v1/auth/context");
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.body).toMatchObject({ statusCode: 401, message: "Aucune session : veuillez vous connecter", error: "Non authentifié" });

    const missing = await as(harness, tenant).get("/projects/inexistant");
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ statusCode: 404, message: "Projet introuvable", error: "Introuvable" });

    const invalid = await as(harness, tenant).post("/crm/leads", { companyName: "Sans contact" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.message).toBe("contactName est obligatoire");

    const refused = await harness.http().post("/api/v1/auth/login").send({ email: tenant.email, password: "Mauvais-mot-de-passe-1" });
    expect(refused.status).toBe(401);
    expect(refused.body.message).toBe("Identifiants invalides");
  });
});
