import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { AppModule } from "../src/app.module.js";

/**
 * Contrat d'authentification (regression reelle observee dans le navigateur) :
 * GET /auth/me renvoyait un utilisateur sans fullName alors que POST /auth/login
 * en renvoyait un complet. Au rechargement d'une page authentifiee, le client
 * plantait sur `user.fullName.split(...)`.
 *
 * Ce test verrouille l'invariant : les deux routes exposent la MEME forme.
 */
describe("Auth contract (e2e)", () => {
  let app: INestApplication;
  const suffix = Date.now();
  const slug = `auth-contract-${suffix}`;
  const email = `owner-contract-${suffix}@test.com`;
  const password = "StrongPass123!";
  const fullName = "Marie Kabongo";

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

  it("exposes the same user shape on /auth/login and /auth/me", async () => {
    const registered = await request(app.getHttpServer())
      .post("/api/v1/auth/register-organization")
      .send({
        organizationName: `Org ${slug}`,
        organizationSlug: slug,
        companyName: `Company ${slug}`,
        ownerEmail: email,
        ownerPassword: password,
        ownerFullName: fullName,
      });
    expect(registered.status).toBe(201);

    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password });
    expect(login.status).toBe(201);
    expect(login.body.user.fullName).toBe(fullName);

    const me = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Cookie", login.headers["set-cookie"]);
    expect(me.status).toBe(200);

    // Meme ensemble de cles, memes valeurs d'identite.
    expect(Object.keys(me.body.user).sort()).toEqual(Object.keys(login.body.user).sort());
    expect(me.body.user.id).toBe(login.body.user.id);
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.fullName).toBe(fullName);
    expect(me.body.user.organizationId).toBe(login.body.user.organizationId);
  });

  it("never exposes the password hash or the session token", async () => {
    const login = await request(app.getHttpServer())
      .post("/api/v1/auth/login")
      .send({ email, password });

    const me = await request(app.getHttpServer())
      .get("/api/v1/auth/me")
      .set("Cookie", login.headers["set-cookie"]);

    const serialized = JSON.stringify(me.body);
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain(password);
  });
});
