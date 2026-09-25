import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import cookieParser from "cookie-parser";
import request from "supertest";
import { expect } from "vitest";
import { AppModule } from "../../src/app.module.js";
import { PrismaService } from "../../src/core/prisma.service.js";
import { applySecurityHeaders } from "../../src/common/security-headers.js";

/**
 * Harnais e2e partage : application NestJS complete (memes guards, meme
 * prefixe qu'en production) contre la base PostgreSQL reelle de DATABASE_URL.
 */
export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  applySecurityHeaders(app);
  app.use(cookieParser());
  app.setGlobalPrefix("api/v1", { exclude: ["health"] });
  await app.init();
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

export interface Tenant {
  slug: string;
  email: string;
  password: string;
  cookie: string[];
  userId: string;
  organizationId: string;
  companyId: string;
}

let counter = 0;

/** Cree une organisation reelle (bootstrap transactionnel) et retourne sa session OWNER. */
export async function registerTenant(harness: Harness, label: string): Promise<Tenant> {
  counter += 1;
  const slug = `${label}-${Date.now()}-${counter}`;
  const email = `owner-${slug}@test.com`;
  const password = "StrongPass123!";
  const response = await harness
    .http()
    .post("/api/v1/auth/register-organization")
    .send({
      organizationName: `Org ${slug}`,
      organizationSlug: slug,
      companyName: `Company ${slug}`,
      ownerEmail: email,
      ownerPassword: password,
      ownerFullName: `Owner ${label}`,
    });
  expect(response.status).toBe(201);
  const membership = await harness.prisma.companyMembership.findFirstOrThrow({
    where: { userId: response.body.user.id },
  });
  return {
    slug,
    email,
    password,
    cookie: response.headers["set-cookie"] as unknown as string[],
    userId: response.body.user.id,
    organizationId: response.body.user.organizationId,
    companyId: membership.companyId,
  };
}

/** Requetes authentifiees raccourcies pour un tenant donne. */
export function as(harness: Harness, tenant: Pick<Tenant, "cookie">) {
  return {
    get: (path: string) => harness.http().get(`/api/v1${path}`).set("Cookie", tenant.cookie),
    post: (path: string, body: object = {}) =>
      harness.http().post(`/api/v1${path}`).set("Cookie", tenant.cookie).send(body),
    patch: (path: string, body: object = {}) =>
      harness.http().patch(`/api/v1${path}`).set("Cookie", tenant.cookie).send(body),
    put: (path: string, body: object = {}) =>
      harness.http().put(`/api/v1${path}`).set("Cookie", tenant.cookie).send(body),
    delete: (path: string) => harness.http().delete(`/api/v1${path}`).set("Cookie", tenant.cookie),
  };
}
