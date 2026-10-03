import { describe, expect, it, vi } from "vitest";
import type { ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { Reflector } from "@nestjs/core";
import type { PrismaService } from "../src/core/prisma.service.js";
import { PermissionGuard } from "../src/auth/permission.guard.js";
import { SessionGuard } from "../src/auth/session.guard.js";
import { readCookie } from "../src/portal/portal-session.guard.js";
import { OriginGuard } from "../src/auth/origin.guard.js";
import { JsonBodyGuard } from "../src/auth/json-body.guard.js";
import { credentialPassword, parseLogin, parseRegistration } from "../src/auth/credentials.js";
import { nextSessionExpiry, SESSION_IDLE_MS, SESSION_MAX_AGE_MS } from "../src/auth/session-policy.js";

function context(request: object): ExecutionContext { return { switchToHttp: () => ({ getRequest: () => request }), getHandler: () => ({}) } as unknown as ExecutionContext; }
describe("Security qualification regression checks", () => {
  it("rejects non-object JSON while preserving webhooks, uploads and bodyless actions", () => {
    const guard = new JsonBodyGuard();
    const request = { method: "POST", path: "/api/v1/crm/leads", headers: { "content-type": "application/json", "content-length": "4" } };
    for (const body of [null, [], "text", 3, false]) expect(() => guard.canActivate(context({ ...request, body }))).toThrow("JSON body must be an object");
    expect(guard.canActivate(context({ ...request, body: {} }))).toBe(true);
    expect(guard.canActivate(context({ ...request, path: "/api/v1/public/inbound/id", body: null }))).toBe(true);
    expect(guard.canActivate(context({ ...request, headers: { "content-type": "multipart/form-data; boundary=test" }, body: undefined }))).toBe(true);
    const bodyless: { path: string; headers: object; body?: object } = { path: "/api/v1/crm/leads/id/convert", headers: {} };
    expect(guard.canActivate(context(bodyless))).toBe(true);
    expect(bodyless.body).toEqual({});
  });
  it("company-scoped permissions and effective permissions stay in the resolved company", async () => {
    const roleAssignment = { findMany: vi.fn().mockResolvedValue([
      { companyId: "company-a", projectId: null, role: { organizationId: "org", permissions: [{ permission: { key: "crm.lead.read" } }] } },
      { companyId: "company-b", projectId: null, role: { organizationId: "org", permissions: [{ permission: { key: "finance.invoice.read" } }] } },
    ]) };
    const guard = new PermissionGuard({ get: () => ["crm.lead.read"] } as unknown as Reflector, { roleAssignment } as unknown as PrismaService);
    const request = { axoraUser: { id: "user", organizationId: "org" }, axoraScope: { companyId: "company-a" }, axoraPermissions: undefined as Set<string> | undefined };
    expect(await guard.canActivate(context(request))).toBe(true);
    expect([...request.axoraPermissions!]).toEqual(["crm.lead.read"]);
    request.axoraScope.companyId = "company-b";
    await expect(guard.canActivate(context(request))).rejects.toMatchObject({ status: 403 });
    await expect(guard.canActivate(context({ axoraUser: request.axoraUser }))).rejects.toMatchObject({ status: 403 });
  });
  it("malformed encoded cookies are unauthenticated, not server errors", async () => {
    const prisma = { session: { findUnique: vi.fn() } } as unknown as PrismaService;
    await expect(new SessionGuard(prisma).canActivate(context({ headers: { cookie: "axora_erp24_session=%E0%A4%A" } }))).rejects.toMatchObject({ status: 401 });
    expect(readCookie({ headers: { cookie: "axora_portal_session=%E0%A4%A" } } as Request, "axora_portal_session")).toBeUndefined();
  });
  it("origin and media-type checks preserve server calls, uploads and signed webhooks", () => {
    const guard = new OriginGuard(); const base = { method: "POST", path: "/api/v1/admin/users", headers: { cookie: "axora_erp24_session=opaque", "content-length": "20", "content-type": "application/json" } };
    expect(guard.canActivate(context(base))).toBe(true);
    expect(guard.canActivate(context({ ...base, headers: { ...base.headers, origin: "http://localhost:3100" } }))).toBe(true);
    expect(() => guard.canActivate(context({ ...base, headers: { ...base.headers, origin: "https://untrusted.example" } }))).toThrow();
    expect(() => guard.canActivate(context({ ...base, headers: { ...base.headers, "content-type": "text/plain" } }))).toThrow();
    expect(guard.canActivate(context({ ...base, path: "/api/v1/files", headers: { ...base.headers, "content-type": "multipart/form-data; boundary=test" } }))).toBe(true);
    expect(guard.canActivate(context({ ...base, path: "/api/v1/public/inbound/id", headers: { "content-type": "application/json" } }))).toBe(true);
  });
  it("credentials normalize email, preserve passwords and reject malformed and privileged fields", () => {
    expect(parseLogin({ email: "User@Example.COM", password: "  password spaces  " })).toEqual({ email: "user@example.com", password: "  password spaces  " });
    expect(() => parseLogin({ email: 123, password: "test" })).toThrow();
    expect(() => parseLogin({ email: "a@example.com", password: "test", organizationId: "foreign" })).toThrow();
    expect(() => parseRegistration({})).toThrow();
    expect(() => credentialPassword("x".repeat(257), "password")).toThrow();
  });
  it("sliding expiry never extends past the absolute session lifetime", () => {
    const createdAt = new Date(1_000_000);
    expect(nextSessionExpiry(createdAt, createdAt.getTime()).getTime()).toBe(createdAt.getTime() + SESSION_IDLE_MS);
    expect(nextSessionExpiry(createdAt, createdAt.getTime() + SESSION_MAX_AGE_MS - 1000).getTime()).toBe(createdAt.getTime() + SESSION_MAX_AGE_MS);
  });
});
