import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";
import { PrismaService } from "../src/core/prisma.service.js";

/**
 * Test d'isolation tenant end-to-end (docs/foundation/03-security.md).
 * Necessite une base PostgreSQL reelle joignable via DATABASE_URL
 * (docker-compose.dev.yml). Ce test a deja detecte un vrai defaut
 * d'isolation lors du developpement (OrganizationService.list() sans
 * scope) — corrige avant ce commit.
 */
describe("Tenant isolation (e2e)", () => {
  let app: INestApplication;
  const suffix = Date.now();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix("api/v1", { exclude: ["health"] });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function registerAndGetCookie(slug: string, email: string) {
    return request(app.getHttpServer())
      .post("/api/v1/auth/register-organization")
      .send({
        organizationName: `Org ${slug}`,
        organizationSlug: slug,
        companyName: `Company ${slug}`,
        ownerEmail: email,
        ownerPassword: "StrongPass123!",
        ownerFullName: `Owner ${slug}`,
      });
  }

  it("denies access to /organizations/me without a session (401)", async () => {
    const response = await request(app.getHttpServer()).get("/api/v1/organizations/me");
    expect(response.status).toBe(401);
  });

  it("returns only the caller's own organization, never another tenant's", async () => {
    const slugA = `tenant-a-${suffix}`;
    const slugB = `tenant-b-${suffix}`;

    const registerA = await registerAndGetCookie(slugA, `owner-a-${suffix}@test.com`);
    expect(registerA.status).toBe(201);
    const cookieA = registerA.headers["set-cookie"];

    const registerB = await registerAndGetCookie(slugB, `owner-b-${suffix}@test.com`);
    expect(registerB.status).toBe(201);
    const cookieB = registerB.headers["set-cookie"];

    const meA = await request(app.getHttpServer())
      .get("/api/v1/organizations/me")
      .set("Cookie", cookieA);
    expect(meA.status).toBe(200);
    expect(meA.body.slug).toBe(slugA);

    const meB = await request(app.getHttpServer())
      .get("/api/v1/organizations/me")
      .set("Cookie", cookieB);
    expect(meB.status).toBe(200);
    expect(meB.body.slug).toBe(slugB);

    // Assertion d'isolation stricte : A ne doit jamais recevoir les donnees de B et inversement.
    expect(meA.body.slug).not.toBe(slugB);
    expect(meB.body.slug).not.toBe(slugA);
  });

  it("rejects login with wrong password (401)", async () => {
    const slug = `tenant-wrongpw-${suffix}`;
    const email = `owner-wrongpw-${suffix}@test.com`;
    await registerAndGetCookie(slug, email);

    const response = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password: "WrongPassword!" });
    expect(response.status).toBe(401);
  });

  it("revokes the session on logout (subsequent request is 401)", async () => {
    const slug = `tenant-logout-${suffix}`;
    const email = `owner-logout-${suffix}@test.com`;
    const registered = await registerAndGetCookie(slug, email);
    const cookie = registered.headers["set-cookie"];

    const logout = await request(app.getHttpServer())
      .post("/api/v1/auth/logout")
      .set("Cookie", cookie);
    expect(logout.status).toBe(201);

    const afterLogout = await request(app.getHttpServer())
      .get("/api/v1/organizations/me")
      .set("Cookie", cookie);
    expect(afterLogout.status).toBe(401);
  });
});
