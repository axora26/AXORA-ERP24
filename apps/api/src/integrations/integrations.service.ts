import { randomBytes } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { CONNECTORS, PUBLIC_API_PERMISSIONS, type ApiKeyIssued, type ApiKeyView, type ApiRequestLogView, type ConnectorEntry, type InboundEndpointIssued, type InboundEndpointView, type InboundEventView } from "@axora24/contracts";
import type { Prisma } from "@axora24/database";
import { encryptSecret } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalDate, optionalInt, requiredText } from "../common/validation.js";
import { integrationKey } from "../workflow/automation.service.js";
import { generateApiKey, rateWindows, validIp } from "./api-key.js";

const MAX_KEY_LIFETIME_MS = 2 * 366 * 86_400_000;

/** INC-23 — Administration des cles d'API, des webhooks entrants et du registre des connecteurs. */
@Injectable()
export class IntegrationsService {
  constructor(private readonly prisma: PrismaService) {}

  connectors(): ConnectorEntry[] {
    return CONNECTORS;
  }

  /** Permissions deleguables : catalogue public ∩ permissions de l'utilisateur. */
  delegable(permissions: Set<string>): Array<{ permission: string; granted: boolean }> {
    return PUBLIC_API_PERMISSIONS.map((permission) => ({ permission, granted: permissions.has(permission) }));
  }

  private async keyViews(scope: CompanyScope, rows: Array<Prisma.ApiKeyGetPayload<object>>): Promise<ApiKeyView[]> {
    const day = rateWindows(new Date()).day;
    const [usage, users] = await Promise.all([
      this.prisma.apiKeyUsage.findMany({ where: { keyId: { in: rows.map((row) => row.id) }, window: day } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.createdByUserId))] } }, select: { id: true, fullName: true } }),
    ]);
    const used = new Map(usage.map((entry) => [entry.keyId, entry.count]));
    const names = new Map(users.map((entry) => [entry.id, entry.fullName]));
    const now = Date.now();
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      prefix: row.prefix,
      permissions: row.permissions,
      rateLimitPerMinute: row.rateLimitPerMinute,
      dailyQuota: row.dailyQuota,
      allowedIps: row.allowedIps,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      status: row.revokedAt ? "REVOKED" : row.expiresAt && row.expiresAt.getTime() <= now ? "EXPIRED" : "ACTIVE",
      revokedAt: row.revokedAt?.toISOString() ?? null,
      revokeReason: row.revokeReason,
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      usageToday: used.get(row.id) ?? 0,
      createdByName: names.get(row.createdByUserId) ?? "—",
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async keys(scope: CompanyScope): Promise<ApiKeyView[]> {
    return this.keyViews(scope, await this.prisma.apiKey.findMany({ where: scope, orderBy: { createdAt: "desc" } }));
  }

  async issueKey(scope: CompanyScope, user: AuthenticatedUser, permissions: Set<string>, body: unknown): Promise<ApiKeyIssued> {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 80);
    if (!Array.isArray(input.permissions) || input.permissions.length === 0) throw new BadRequestException("permissions : au moins une permission explicite (jamais d'accès total)");
    const requested = [...new Set(input.permissions.map(String))].sort();
    for (const permission of requested) {
      if (!(PUBLIC_API_PERMISSIONS as readonly string[]).includes(permission)) throw new BadRequestException(`Permission ${permission} non exposée par l'API publique`);
      if (!permissions.has(permission)) throw new ForbiddenException(`Vous ne pouvez pas déléguer une permission que vous n'avez pas : ${permission}`);
    }
    const rateLimitPerMinute = optionalInt(input.rateLimitPerMinute, "rateLimitPerMinute", { min: 1, max: 600 }) ?? 60;
    const dailyQuota = optionalInt(input.dailyQuota, "dailyQuota", { min: 1, max: 1_000_000 }) ?? 10_000;
    const ips = input.allowedIps === undefined || input.allowedIps === null ? [] : input.allowedIps;
    if (!Array.isArray(ips) || ips.length > 20 || !ips.every((ip) => typeof ip === "string" && validIp(ip))) throw new BadRequestException("allowedIps : 20 adresses IP valides au plus");
    const expiresAt = optionalDate(input.expiresAt, "expiresAt");
    if (expiresAt && (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + MAX_KEY_LIFETIME_MS)) throw new BadRequestException("expiresAt : date future, 2 ans au plus");

    const generated = generateApiKey();
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.apiKey.create({
        data: { ...scope, name, prefix: generated.prefix, keyHash: generated.hash, permissions: requested, rateLimitPerMinute, dailyQuota, allowedIps: ips.map((ip: string) => ip.trim()), expiresAt, createdByUserId: user.id },
      });
      // Jamais le secret dans l'audit : seulement le prefixe et les droits.
      await writeAudit(tx, scope, user.id, "integrations.apikey.issued", "ApiKey", row.id, { name, prefix: generated.prefix, permissions: requested, rateLimitPerMinute, dailyQuota, allowedIps: ips.length });
      return row;
    });
    return { key: (await this.keyViews(scope, [created]))[0]!, secret: generated.secret };
  }

  async revokeKey(scope: CompanyScope, user: AuthenticatedUser, id: string, body: unknown): Promise<ApiKeyView> {
    const reason = requiredText(assertBody(body).reason, "reason", 500);
    const updated = await this.prisma.$transaction(async (tx) => {
      const key = await tx.apiKey.findFirst({ where: { ...scope, id } });
      if (!key) throw new NotFoundException("Clé introuvable");
      const claimed = await tx.apiKey.updateMany({ where: { id, revokedAt: null }, data: { revokedAt: new Date(), revokedByUserId: user.id, revokeReason: reason } });
      if (claimed.count !== 1) throw new ConflictException("Clé déjà révoquée");
      await writeAudit(tx, scope, user.id, "integrations.apikey.revoked", "ApiKey", id, { prefix: key.prefix, reason });
      return tx.apiKey.findUniqueOrThrow({ where: { id } });
    });
    return (await this.keyViews(scope, [updated]))[0]!;
  }

  async requests(scope: CompanyScope, id: string): Promise<ApiRequestLogView[]> {
    if (!(await this.prisma.apiKey.findFirst({ where: { ...scope, id }, select: { id: true } }))) throw new NotFoundException("Clé introuvable");
    const rows = await this.prisma.apiRequestLog.findMany({ where: { ...scope, keyId: id }, orderBy: { at: "desc" }, take: 100 });
    return rows.map((row) => ({ id: row.id, method: row.method, path: row.path, status: row.status, ip: row.ip, durationMs: row.durationMs, at: row.at.toISOString() }));
  }

  // -------------------------------------------------------------------------
  // Webhooks entrants
  // -------------------------------------------------------------------------

  private async endpointViews(rows: Array<Prisma.InboundEndpointGetPayload<object>>): Promise<InboundEndpointView[]> {
    const [counts, users] = await Promise.all([
      this.prisma.inboundEvent.groupBy({ by: ["endpointId", "status"], where: { endpointId: { in: rows.map((row) => row.id) } }, _count: { _all: true } }),
      this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((row) => row.createdByUserId))] } }, select: { id: true, fullName: true } }),
    ]);
    const names = new Map(users.map((entry) => [entry.id, entry.fullName]));
    const count = (endpointId: string, status: string) => counts.find((entry) => entry.endpointId === endpointId && entry.status === status)?._count._all ?? 0;
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: "CRM_LEAD",
      active: row.active,
      path: `/api/v1/public/inbound/${row.id}`,
      accepted: count(row.id, "ACCEPTED"),
      rejected: count(row.id, "REJECTED"),
      lastReceivedAt: row.lastReceivedAt?.toISOString() ?? null,
      createdByName: names.get(row.createdByUserId) ?? "—",
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async endpoints(scope: CompanyScope): Promise<InboundEndpointView[]> {
    return this.endpointViews(await this.prisma.inboundEndpoint.findMany({ where: scope, orderBy: { createdAt: "desc" } }));
  }

  async createEndpoint(scope: CompanyScope, user: AuthenticatedUser, permissions: Set<string>, body: unknown): Promise<InboundEndpointIssued> {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 80);
    if (input.kind !== undefined && input.kind !== "CRM_LEAD") throw new BadRequestException("kind : seul CRM_LEAD est pris en charge");
    // Le point d'entree cree des prospects au nom de son createur : il doit pouvoir le faire lui-meme.
    if (!permissions.has("crm.lead.manage")) throw new ForbiddenException("La permission crm.lead.manage est requise pour recevoir des prospects");
    const key = integrationKey();
    if (!key) throw new BadRequestException("Webhooks entrants indisponibles : clé de chiffrement des intégrations non configurée");
    const secret = `whin_${randomBytes(24).toString("base64url")}`;
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.inboundEndpoint.create({ data: { ...scope, name, kind: "CRM_LEAD", secretEnc: encryptSecret(secret, key), createdByUserId: user.id } });
      await writeAudit(tx, scope, user.id, "integrations.inbound.created", "InboundEndpoint", row.id, { name });
      return row;
    });
    return { endpoint: (await this.endpointViews([created]))[0]!, secret };
  }

  async setEndpointActive(scope: CompanyScope, user: AuthenticatedUser, id: string, body: unknown): Promise<InboundEndpointView> {
    const input = assertBody(body);
    if (typeof input.active !== "boolean") throw new BadRequestException("active doit être un booléen");
    const active = input.active;
    const updated = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.inboundEndpoint.findFirst({ where: { ...scope, id }, select: { id: true } }))) throw new NotFoundException("Point d'entrée introuvable");
      const row = await tx.inboundEndpoint.update({ where: { id }, data: { active } });
      await writeAudit(tx, scope, user.id, active ? "integrations.inbound.activated" : "integrations.inbound.deactivated", "InboundEndpoint", id, {});
      return row;
    });
    return (await this.endpointViews([updated]))[0]!;
  }

  async events(scope: CompanyScope, id: string): Promise<InboundEventView[]> {
    if (!(await this.prisma.inboundEndpoint.findFirst({ where: { ...scope, id }, select: { id: true } }))) throw new NotFoundException("Point d'entrée introuvable");
    const rows = await this.prisma.inboundEvent.findMany({ where: { ...scope, endpointId: id }, orderBy: { receivedAt: "desc" }, take: 100 });
    return rows.map((row) => ({ id: row.id, externalId: row.externalId, status: row.status as InboundEventView["status"], error: row.error, resourceType: row.resourceType, resourceId: row.resourceId, receivedAt: row.receivedAt.toISOString() }));
  }
}
