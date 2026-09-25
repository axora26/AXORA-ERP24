import { createHash } from "node:crypto";
import { BadRequestException, Controller, HttpCode, HttpException, HttpStatus, NotFoundException, Param, Post, Req, Res, UnauthorizedException } from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request, Response } from "express";
import { Prisma } from "@axora24/database";
import { decryptSecret } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import { CrmService } from "../crm/crm.service.js";
import { LoginThrottleService } from "../auth/login-throttle.service.js";
import { writeAudit } from "../common/audit.js";
import { integrationKey } from "../workflow/automation.service.js";
import { verifyWebhook } from "../workflow/engine.js";
import { normalizeIp } from "./api-key.js";

/** Essais invalides limites PAR point d'entree et par IP : un flot sur l'un ne bloque pas les autres. */
const throttleSubject = (endpointId: string) => `inbound:${endpointId.slice(0, 64)}`;

interface LeadEvent {
  id: string;
  data: { contactName: string; companyName: string; email?: string; phone?: string; message?: string };
}

/** Validation stricte du schema (tout champ inattendu ou mal type est refuse). */
function parseLeadEvent(body: unknown): { event?: LeadEvent; externalId?: string; error?: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Corps JSON objet attendu" };
  const input = body as Record<string, unknown>;
  const externalId = typeof input.id === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(input.id) ? input.id : undefined;
  if (!externalId) return { error: "id d'événement requis (1 à 120 caractères [A-Za-z0-9._:-])" };
  if (input.type !== "crm.lead") return { externalId, error: "type non pris en charge (attendu : crm.lead)" };
  const data = input.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return { externalId, error: "data objet attendu" };
  const fields = data as Record<string, unknown>;
  const allowed = ["contactName", "companyName", "email", "phone", "message"];
  const unknown = Object.keys(fields).filter((field) => !allowed.includes(field));
  if (unknown.length) return { externalId, error: `Champs inconnus : ${unknown.join(", ")}` };
  const text = (value: unknown, max: number, required: boolean): string | undefined | null => {
    if (value === undefined || value === null || value === "") return required ? null : undefined;
    return typeof value === "string" && value.trim().length <= max ? value.trim() : null;
  };
  const contactName = text(fields.contactName, 180, true);
  const companyName = text(fields.companyName, 180, true);
  const email = text(fields.email, 180, false);
  const phone = text(fields.phone, 40, false);
  const message = text(fields.message, 2000, false);
  if (!contactName || !companyName) return { externalId, error: "contactName et companyName requis (180 caractères au plus)" };
  if (email === null || phone === null || message === null) return { externalId, error: "email, phone ou message invalide" };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { externalId, error: "email invalide" };
  return { externalId, event: { id: externalId, data: { contactName, companyName, email, phone, message } } };
}

/**
 * Webhook entrant (BC-24) : la signature est verifiee sur le corps BRUT avant
 * tout traitement ; l'evenement est idempotent par identifiant (unique en
 * base) ; le prospect et la trace sont ecrits dans la meme transaction.
 */
@Controller("public/inbound")
export class InboundController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmService,
    private readonly throttle: LoginThrottleService,
  ) {}

  @Post(":endpointId")
  @HttpCode(201)
  async receive(@Param("endpointId") endpointId: string, @Req() request: RawBodyRequest<Request>, @Res({ passthrough: true }) response: Response) {
    const ip = normalizeIp(request.ip);
    await this.throttle.enforce(throttleSubject(endpointId), ip).catch(() => {
      throw new HttpException("Trop de signatures invalides depuis cette adresse : réessayez dans 15 minutes", HttpStatus.TOO_MANY_REQUESTS);
    });
    const endpoint = await this.prisma.inboundEndpoint.findUnique({ where: { id: endpointId } });
    if (!endpoint || !endpoint.active) throw new NotFoundException("Point d'entrée inconnu ou désactivé");
    const raw = request.rawBody?.toString("utf8") ?? "";
    if (!raw) throw new BadRequestException("Corps JSON requis");
    const key = integrationKey();
    if (!key) throw new HttpException("Webhooks entrants indisponibles : clé de chiffrement des intégrations non configurée", HttpStatus.SERVICE_UNAVAILABLE);
    const timestamp = String(request.headers["x-axora-timestamp"] ?? "");
    const signature = String(request.headers["x-axora-signature"] ?? "");
    if (!verifyWebhook(decryptSecret(endpoint.secretEnc, key), timestamp, raw, signature)) {
      await this.throttle.recordFailure(throttleSubject(endpointId), ip);
      throw new UnauthorizedException("Signature invalide ou horodatage hors tolérance (5 min)");
    }

    const scope = { organizationId: endpoint.organizationId, companyId: endpoint.companyId };
    const parsed = parseLeadEvent(request.body);
    if (!parsed.externalId) throw new BadRequestException(parsed.error);
    const existing = await this.prisma.inboundEvent.findUnique({ where: { endpointId_externalId: { endpointId, externalId: parsed.externalId } } });
    if (existing) {
      response.status(existing.status === "ACCEPTED" ? 200 : 422);
      return { duplicate: true, eventId: existing.id, status: existing.status, resourceType: existing.resourceType, resourceId: existing.resourceId, error: existing.error };
    }
    const payloadSha256 = createHash("sha256").update(raw, "utf8").digest("hex");

    try {
      const event = await this.prisma.$transaction(async (tx) => {
        if (!parsed.event) {
          return tx.inboundEvent.create({ data: { ...scope, endpointId, externalId: parsed.externalId!, status: "REJECTED", error: parsed.error!, payloadSha256 } });
        }
        const { data } = parsed.event;
        const lead = await this.crm.insertLead(tx, scope, { contactName: data.contactName, companyName: data.companyName, email: data.email, phone: data.phone, source: `Webhook : ${endpoint.name}` } as never, endpoint.createdByUserId);
        if (data.message) {
          await tx.crmActivity.create({ data: { ...scope, type: "NOTE", subject: "Message reçu (webhook)", body: data.message, relatedType: "Lead", relatedId: lead.id, actorUserId: endpoint.createdByUserId } });
        }
        const created = await tx.inboundEvent.create({ data: { ...scope, endpointId, externalId: parsed.externalId!, status: "ACCEPTED", resourceType: "CrmLead", resourceId: lead.id, payloadSha256 } });
        await tx.inboundEndpoint.update({ where: { id: endpointId }, data: { lastReceivedAt: new Date() } });
        await writeAudit(tx, scope, null, "integrations.inbound.lead.created", "CrmLead", lead.id, { endpointId, externalId: parsed.externalId });
        return created;
      });
      if (event.status === "REJECTED") response.status(422);
      return { duplicate: false, eventId: event.id, status: event.status, resourceType: event.resourceType, resourceId: event.resourceId, error: event.error };
    } catch (error) {
      // Course entre deux livraisons du meme evenement : la contrainte d'unicite tranche.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const winner = await this.prisma.inboundEvent.findUniqueOrThrow({ where: { endpointId_externalId: { endpointId, externalId: parsed.externalId } } });
        response.status(200);
        return { duplicate: true, eventId: winner.id, status: winner.status, resourceType: winner.resourceType, resourceId: winner.resourceId, error: winner.error };
      }
      throw error;
    }
  }
}
