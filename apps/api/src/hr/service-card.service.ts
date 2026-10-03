import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type { EmployeeServiceCardDocument, EmployeeServiceCardView } from "@axora24/contracts";
import { hashSessionToken } from "@axora24/security";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalDate, optionalId, optionalText, requiredEnum, requiredText } from "../common/validation.js";
import { cardPayload, createCardCredential, normalizeCardToken } from "./service-card-credentials.js";

type CardMetadata = { id: string; employeeId: string; issuedAt: Date; expiresAt: Date | null; revokedAt: Date | null };
export function serviceCardView(card: CardMetadata): EmployeeServiceCardView {
  return { id: card.id, employeeId: card.employeeId, issuedAt: card.issuedAt.toISOString(), expiresAt: card.expiresAt?.toISOString() ?? null, revokedAt: card.revokedAt?.toISOString() ?? null, status: card.revokedAt ? "REVOKED" : card.expiresAt && card.expiresAt <= new Date() ? "EXPIRED" : "ACTIVE" };
}

@Injectable()
export class ServiceCardService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: CompanyScope, employeeId: string): Promise<EmployeeServiceCardView[]> {
    if (!await this.prisma.employee.findFirst({ where: { id: employeeId, ...scope }, select: { id: true } })) throw new NotFoundException("Employee not found");
    return (await this.prisma.employeeServiceCard.findMany({ where: { employeeId, ...scope }, orderBy: { issuedAt: "desc" }, select: { id: true, employeeId: true, issuedAt: true, expiresAt: true, revokedAt: true } })).map(serviceCardView);
  }

  async issue(scope: CompanyScope, employeeId: string, body: unknown, actorUserId: string): Promise<EmployeeServiceCardDocument> {
    const input = assertBody(body);
    const expiresAt = optionalDate(input.expiresAt, "expiresAt");
    const now = new Date();
    if (expiresAt && expiresAt <= now) throw new BadRequestException("The service card expiration must be in the future");
    const credential = createCardCredential();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "hr_employees" WHERE "id" = ${employeeId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
      const employee = await tx.employee.findFirst({ where: { id: employeeId, ...scope } });
      if (!employee) throw new NotFoundException("Employee not found");
      if (employee.status !== "ACTIVE") throw new BadRequestException("A service card requires an active employee");
      const previous = await tx.employeeServiceCard.updateMany({ where: { ...scope, employeeId, revokedAt: null }, data: { revokedAt: now, revokedByUserId: actorUserId } });
      const card = await tx.employeeServiceCard.create({ data: { ...scope, employeeId, tokenHash: credential.tokenHash, tokenCiphertext: credential.tokenCiphertext, issuedByUserId: actorUserId, issuedAt: now, expiresAt } });
      const company = await tx.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { name: true } });
      await writeAudit(tx, scope, actorUserId, "hr.service_card.issued", "EmployeeServiceCard", card.id, { employeeId, previousCardsRevoked: previous.count, expiresAt: expiresAt?.toISOString() ?? null });
      return { card, employee, company };
    });
    return { card: serviceCardView(result.card), qrPayload: credential.qrPayload, employee: { code: result.employee.code, fullName: `${result.employee.firstName} ${result.employee.lastName}`, jobTitle: result.employee.jobTitle }, company: result.company };
  }

  async document(scope: CompanyScope, employeeId: string, actorUserId: string): Promise<EmployeeServiceCardDocument> {
    const card = await this.prisma.employeeServiceCard.findFirst({ where: { ...scope, employeeId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { issuedAt: "desc" }, include: { employee: true } });
    if (!card || card.employee.status !== "ACTIVE") throw new NotFoundException("No active service card exists for this employee");
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { name: true } });
    const qrPayload = cardPayload(card.tokenCiphertext);
    if (hashSessionToken(normalizeCardToken(qrPayload)) !== card.tokenHash) throw new ConflictException("The service card credential is inconsistent; reissue the card");
    await this.prisma.$transaction((tx) => writeAudit(tx, scope, actorUserId, "hr.service_card.opened", "EmployeeServiceCard", card.id, { employeeId }));
    return { card: serviceCardView(card), qrPayload, employee: { code: card.employee.code, fullName: `${card.employee.firstName} ${card.employee.lastName}`, jobTitle: card.employee.jobTitle }, company };
  }

  async revoke(scope: CompanyScope, cardId: string, body: unknown, actorUserId: string): Promise<EmployeeServiceCardView> {
    const reason = requiredText(assertBody(body).reason, "reason", 500);
    const card = await this.prisma.employeeServiceCard.findFirst({ where: { id: cardId, ...scope }, select: { employeeId: true } });
    if (!card) throw new NotFoundException("Service card not found");
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "hr_employees" WHERE "id" = ${card.employeeId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
      const current = await tx.employeeServiceCard.findFirst({ where: { id: cardId, ...scope } });
      if (!current) throw new NotFoundException("Service card not found");
      if (current.revokedAt) return current;
      const result = await tx.employeeServiceCard.update({ where: { id: current.id }, data: { revokedAt: new Date(), revokedByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "hr.service_card.revoked", "EmployeeServiceCard", current.id, { employeeId: card.employeeId, reason });
      return result;
    });
    return serviceCardView(updated);
  }

  async scanAttendance(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const tokenHash = hashSessionToken(normalizeCardToken(input.cardToken));
    const type = requiredEnum(input.type, "type", ["IN", "OUT"] as const);
    const idempotencyKey = requiredText(input.idempotencyKey, "idempotencyKey", 120);
    const projectId = optionalId(input.projectId, "projectId");
    if (input.occurredAt !== undefined) throw new BadRequestException("Service card attendance uses the server timestamp");
    const candidate = await this.prisma.employeeServiceCard.findFirst({ where: { tokenHash, ...scope }, select: { id: true, employeeId: true } });
    if (!candidate) throw new NotFoundException("Service card not found");
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`hr-attendance:${scope.organizationId}:${scope.companyId}:${idempotencyKey}`}, 0))`;
      // Match issuance/revocation/update locking order, so an in-flight scan cannot evade revocation.
      await tx.$queryRaw`SELECT "id" FROM "hr_employees" WHERE "id" = ${candidate.employeeId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId} FOR UPDATE`;
      const employee = await tx.employee.findFirst({ where: { id: candidate.employeeId, ...scope } });
      const card = await tx.employeeServiceCard.findFirst({ where: { id: candidate.id, tokenHash, ...scope } });
      const now = new Date();
      if (!employee || employee.status !== "ACTIVE" || !card || card.revokedAt || (card.expiresAt && card.expiresAt <= now)) throw new BadRequestException("The service card is revoked, expired, or its employee is inactive");
      const replay = await tx.attendanceEvent.findFirst({ where: { ...scope, idempotencyKey } });
      if (replay) {
        if (replay.serviceCardId !== card.id || replay.type !== type || replay.capturedByUserId !== actorUserId || (type === "IN" ? replay.projectId !== projectId : projectId && replay.projectId !== projectId)) throw new ConflictException("This attendance idempotency key was already used for another request");
        return { ...this.attendanceView(replay, employee), replayed: true };
      }
      if (projectId && !await tx.project.findFirst({ where: { id: projectId, ...scope }, select: { id: true } })) throw new NotFoundException("Project not found");
      const last = await tx.attendanceEvent.findFirst({ where: { employeeId: employee.id, ...scope }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] });
      if (last && last.occurredAt > now) throw new ConflictException("The latest attendance event is in the future");
      if (type === "IN" && last?.type === "IN") throw new BadRequestException("Employee is already clocked in");
      if (type === "OUT" && last?.type !== "IN") throw new BadRequestException("Employee is not clocked in");
      if (type === "OUT" && projectId && last?.projectId !== projectId) throw new BadRequestException("Clock-out must keep the clock-in project");
      const event = await tx.attendanceEvent.create({ data: { ...scope, employeeId: employee.id, serviceCardId: card.id, idempotencyKey, type, source: "QR", occurredAt: now, projectId: type === "OUT" ? last?.projectId ?? null : projectId, deviceRef: optionalText(input.deviceRef, "deviceRef", 80), capturedByUserId: actorUserId } });
      await writeAudit(tx, scope, actorUserId, "hr.attendance.recorded", "AttendanceEvent", event.id, { employeeId: employee.id, serviceCardId: card.id, type, source: "QR" });
      return { ...this.attendanceView(event, employee), replayed: false };
    });
  }
  private attendanceView(event: { id: string; employeeId: string; type: string; source: string; occurredAt: Date; projectId: string | null }, employee: { firstName: string; lastName: string }) {
    return { id: event.id, employeeId: event.employeeId, employeeName: `${employee.firstName} ${employee.lastName}`, type: event.type, source: event.source, occurredAt: event.occurredAt.toISOString(), projectId: event.projectId, projectCode: null, note: null };
  }
}
