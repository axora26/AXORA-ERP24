import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import { PROJECT_PERMISSIONS, type ProjectResourceKind, type ProjectResourcePlanView } from "@axora24/contracts";
import type { CompanyScope } from "../common/company-scope.service.js";
import { PrismaService } from "../core/prisma.service.js";

const KINDS: ProjectResourceKind[] = ["EMPLOYEE", "VEHICLE", "ASSET", "MATERIAL"];
const ACTIVE_STATUSES = ["PLANNED", "RESERVED"] as const;

type ResourceBody = {
  kind?: unknown;
  resourceId?: unknown;
  wbsItemId?: unknown;
  plannedQuantity?: unknown;
  plannedRate?: unknown;
  startAt?: unknown;
  endAt?: unknown;
  notes?: unknown;
};

const decimal = (value: unknown, field: string, positive = false): Prisma.Decimal => {
  try {
    const result = new Prisma.Decimal(String(value ?? ""));
    if (!result.isFinite() || (positive ? !result.greaterThan(0) : result.isNegative())) throw new Error("invalid");
    return result.toDecimalPlaces(2);
  } catch {
    throw new BadRequestException(`${field} doit être un montant positif ou nul`);
  }
};

const instant = (value: unknown, field: string, required = true): Date | null => {
  if (value === undefined || value === null || value === "") {
    if (required) throw new BadRequestException(`${field} est obligatoire`);
    return null;
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} est invalide`);
  return date;
};

@Injectable()
export class ProjectResourceService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: CompanyScope, projectId: string, permissions: Set<string>): Promise<ProjectResourcePlanView[]> {
    if (!permissions.has(PROJECT_PERMISSIONS.RESOURCE_READ) && !permissions.has(PROJECT_PERMISSIONS.RESOURCE_MANAGE)) {
      throw new ForbiddenException("Permission de lecture des ressources requise");
    }
    await this.requireProject(scope, projectId);
    const rows = await this.prisma.projectResourcePlan.findMany({
      where: { ...scope, projectId },
      orderBy: [{ startAt: "asc" }, { resourceName: "asc" }],
    });
    return rows.map((row) => this.view(row));
  }

  async create(scope: CompanyScope, projectId: string, body: unknown, actorUserId: string, permissions: Set<string>): Promise<ProjectResourcePlanView> {
    if (!permissions.has(PROJECT_PERMISSIONS.RESOURCE_MANAGE)) throw new ForbiddenException("Permission de planification des ressources requise");
    const input = (body ?? {}) as ResourceBody;
    const kind = String(input.kind ?? "") as ProjectResourceKind;
    if (!KINDS.includes(kind)) throw new BadRequestException("Le type de ressource est invalide");
    const resourceId = String(input.resourceId ?? "").trim();
    if (!resourceId) throw new BadRequestException("La ressource est obligatoire");
    const startAt = instant(input.startAt, "startAt")!;
    const endAt = instant(input.endAt, "endAt", false);
    if (endAt && endAt <= startAt) throw new BadRequestException("La fin doit être postérieure au début");
    const plannedQuantity = decimal(input.plannedQuantity, "plannedQuantity", true);
    const plannedRate = input.plannedRate === undefined || input.plannedRate === null || input.plannedRate === "" ? null : decimal(input.plannedRate, "plannedRate");
    const wbsItemId = input.wbsItemId ? String(input.wbsItemId) : null;
    const notes = input.notes ? String(input.notes).trim().slice(0, 2000) : null;
    const project = await this.requireProject(scope, projectId);
    if (wbsItemId) {
      const wbs = await this.prisma.projectWbsItem.findFirst({ where: { ...scope, id: wbsItemId, projectId }, select: { id: true, parentId: true } });
      if (!wbs) throw new NotFoundException("Lot WBS introuvable");
      if (wbs.parentId) throw new BadRequestException("Une ressource doit être affectée à une feuille WBS");
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const resolved = await this.resolveResource(tx, scope, kind, resourceId);
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`${scope.companyId}:${kind}:${resourceId}`}))`;
      if (kind !== "MATERIAL") {
        const overlap = await tx.projectResourcePlan.findFirst({
          where: {
            ...scope,
            kind,
            resourceId,
            status: { in: [...ACTIVE_STATUSES] },
            startAt: { lt: endAt ?? new Date("9999-12-31T23:59:59.999Z") },
            OR: [{ endAt: null }, { endAt: { gt: startAt } }],
          },
          select: { id: true, projectId: true, resourceName: true },
        });
        if (overlap) throw new ConflictException(`${overlap.resourceName} est déjà planifié sur une période qui se chevauche`);
      }
      return tx.projectResourcePlan.create({
        data: {
          ...scope,
          projectId,
          wbsItemId,
          kind,
          resourceId,
          resourceCode: resolved.code,
          resourceName: resolved.name,
          unitCode: resolved.unitCode,
          plannedQuantity,
          plannedRate,
          startAt,
          endAt,
          notes,
          createdByUserId: actorUserId,
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    void project;
    return this.view(row);
  }

  async release(scope: CompanyScope, projectId: string, planId: string, actorUserId: string, permissions: Set<string>): Promise<ProjectResourcePlanView> {
    if (!permissions.has(PROJECT_PERMISSIONS.RESOURCE_MANAGE)) throw new ForbiddenException("Permission de gestion des ressources requise");
    const row = await this.prisma.projectResourcePlan.findFirst({ where: { ...scope, projectId, id: planId } });
    if (!row) throw new NotFoundException("Plan de ressource introuvable");
    if (row.status === "RELEASED") throw new ConflictException("Ce plan de ressource est déjà libéré");
    const updated = await this.prisma.projectResourcePlan.update({ where: { id: planId }, data: { status: "RELEASED", releasedByUserId: actorUserId, releasedAt: new Date() } });
    return this.view(updated);
  }

  private async requireProject(scope: CompanyScope, projectId: string) {
    const project = await this.prisma.project.findFirst({ where: { ...scope, id: projectId }, select: { id: true } });
    if (!project) throw new NotFoundException("Projet introuvable");
    return project;
  }

  private async resolveResource(tx: Prisma.TransactionClient, scope: CompanyScope, kind: ProjectResourceKind, resourceId: string): Promise<{ code: string; name: string; unitCode: string }> {
    if (kind === "EMPLOYEE") {
      const employee = await tx.employee.findFirst({ where: { ...scope, id: resourceId, status: "ACTIVE" }, select: { code: true, firstName: true, lastName: true, hourlyCost: true } });
      if (!employee) throw new NotFoundException("Employé actif introuvable");
      return { code: employee.code, name: `${employee.firstName} ${employee.lastName}`, unitCode: "H" };
    }
    if (kind === "VEHICLE") {
      const vehicle = await tx.fleetVehicle.findFirst({ where: { ...scope, id: resourceId, status: "ACTIVE" }, select: { code: true, make: true, model: true } });
      if (!vehicle) throw new NotFoundException("Véhicule ou engin actif introuvable");
      return { code: vehicle.code, name: `${vehicle.make} ${vehicle.model}`, unitCode: "DAY" };
    }
    if (kind === "ASSET") {
      const asset = await tx.asset.findFirst({ where: { ...scope, id: resourceId, status: "IN_SERVICE" }, select: { code: true, name: true } });
      if (!asset) throw new NotFoundException("Actif en service introuvable");
      return { code: asset.code, name: asset.name, unitCode: "DAY" };
    }
    const item = await tx.inventoryItem.findFirst({ where: { ...scope, id: resourceId, isActive: true }, select: { code: true, name: true, unitCode: true } });
    if (!item) throw new NotFoundException("Article de stock actif introuvable");
    return { code: item.code, name: item.name, unitCode: item.unitCode };
  }

  private view(row: Prisma.ProjectResourcePlanGetPayload<Record<string, never>>): ProjectResourcePlanView {
    return {
      id: row.id,
      projectId: row.projectId,
      wbsItemId: row.wbsItemId,
      kind: row.kind,
      resourceId: row.resourceId,
      resourceCode: row.resourceCode,
      resourceName: row.resourceName,
      unitCode: row.unitCode,
      plannedQuantity: row.plannedQuantity.toFixed(3),
      plannedRate: row.plannedRate?.toFixed(2) ?? null,
      startAt: row.startAt.toISOString(),
      endAt: row.endAt?.toISOString() ?? null,
      status: row.status,
      notes: row.notes,
      createdByUserId: row.createdByUserId,
      releasedByUserId: row.releasedByUserId,
      releasedAt: row.releasedAt?.toISOString() ?? null,
    };
  }
}
