import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { createHarness, registerTenant, type Harness } from "./support/harness.js";

/**
 * Politique d'inscription en ligne : un deploiement public peut fermer la
 * creation d'organisations (closed) ou ne permettre que la premiere
 * (first-organization), sans changer le comportement local par defaut (open).
 */
describe("Politique d'inscription (e2e)", () => {
  let harness: Harness;
  const previous = process.env.REGISTRATION_MODE;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.REGISTRATION_MODE;
    else process.env.REGISTRATION_MODE = previous;
  });

  afterAll(async () => {
    await harness.close();
  });

  const attempt = (label: string) => {
    const slug = `${label}-${Date.now()}-${randomBytes(3).toString("hex")}`;
    return harness
      .http()
      .post("/api/v1/auth/register-organization")
      .set("X-Forwarded-For", `2001:db8:${randomBytes(12).toString("hex").match(/.{4}/g)!.join(":")}`)
      .send({
        organizationName: `Org ${slug}`,
        organizationSlug: slug,
        companyName: `Company ${slug}`,
        ownerEmail: `owner-${slug}@test.com`,
        ownerPassword: "StrongPass123!",
        ownerFullName: "Owner policy",
      });
  };

  it("expose la politique publiquement, sans session", async () => {
    process.env.REGISTRATION_MODE = "closed";
    const closed = await harness.http().get("/api/v1/auth/registration");
    expect(closed.status).toBe(200);
    expect(closed.body).toEqual({ mode: "closed", open: false });

    delete process.env.REGISTRATION_MODE;
    const open = await harness.http().get("/api/v1/auth/registration");
    expect(open.body).toEqual({ mode: "open", open: true });
  });

  it("closed : refuse toute creation d'organisation (403) sans rien ecrire", async () => {
    const before = await harness.prisma.organization.count();
    process.env.REGISTRATION_MODE = "closed";
    const response = await attempt("closed");
    expect(response.status).toBe(403);
    expect(await harness.prisma.organization.count()).toBe(before);
  });

  it("first-organization : refuse des qu'une organisation existe deja", async () => {
    await registerTenant(harness, "policy-seed");
    process.env.REGISTRATION_MODE = "first-organization";
    const registration = await harness.http().get("/api/v1/auth/registration");
    expect(registration.body).toEqual({ mode: "first-organization", open: false });
    expect((await attempt("second")).status).toBe(403);
  });

  it("open : comportement historique conserve", async () => {
    process.env.REGISTRATION_MODE = "open";
    expect((await attempt("open")).status).toBe(201);
  });
});
