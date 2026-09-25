import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type {
  ProjectDetailView,
  ProjectStatus,
  ProjectSummaryView,
  ProjectTaskStatus,
  ProjectWbsNodeView,
} from "@axora24/contracts";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { NumberingService } from "../common/numbering.service.js";
import { writeAudit } from "../common/audit.js";
import { dec, money, percent, sumDecimals } from "../common/decimal.js";
import {
  assertBody,
  optionalDate,
  optionalEnum,
  optionalId,
  optionalText,
  requiredDate,
  requiredDecimal,
  requiredEnum,
  requiredId,
  requiredInt,
  requiredText,
} from "../common/validation.js";
import { projectCostFigures } from "./project-costs.js";

const WBS_KINDS = ["LOT", "PHASE", "WORK_PACKAGE"] as const;
const COST_CATEGORIES = ["MATERIAL", "LABOR", "EQUIPMENT", "SUBCONTRACT", "OVERHEAD", "OTHER"] as const;
const TASK_STATUSES = ["TODO", "IN_PROGRESS", "BLOCKED", "DONE"] as const;
const RISK_STATUSES = ["OPEN", "MITIGATED", "CLOSED"] as const;
const PROJECT_STATUSES = ["PLANNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;

/** Transitions de statut autorisees (toute autre transition est refusee). */
const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  PLANNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["ON_HOLD", "COMPLETED", "CANCELLED"],
  ON_HOLD: ["IN_PROGRESS", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

type Tx = Prisma.TransactionClient;

/**
 * INC-05 — Projets & Construction (docs/foundation/02-domain-model.md BC-04).
 * Toutes les requetes portent le filtre organizationId + companyId du scope.
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly numbering: NumberingService,
  ) {}

  // ---------------------------------------------------------------------
  // Lecture
  // ---------------------------------------------------------------------

  async list(scope: CompanyScope): Promise<ProjectSummaryView[]> {
    const projects = await this.prisma.project.findMany({
      where: scope,
      include: {
        budgetLines: { select: { amount: true } },
        changeOrders: { where: { status: "APPROVED" }, select: { amount: true } },
        tasks: { select: { status: true, weight: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    });
    const contractCodes = await this.contractCodes(scope, projects.map((project) => project.contractId));
    return projects.map((project) => {
      const revised = sumDecimals(project.budgetLines.map((line) => line.amount)).plus(
        sumDecimals(project.changeOrders.map((order) => order.amount)),
      );
      return {
        ...summaryFields(project, contractCodes),
        revisedBudget: money(revised),
        physicalProgress: taskProgress(project.tasks),
      };
    });
  }

  async detail(scope: CompanyScope, projectId: string): Promise<ProjectDetailView> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, ...scope },
      include: {
        wbsItems: { orderBy: [{ position: "asc" }, { code: "asc" }] },
        budgetLines: { orderBy: { createdAt: "asc" } },
        tasks: { orderBy: [{ plannedStart: "asc" }, { createdAt: "asc" }] },
        milestones: { orderBy: { dueDate: "asc" } },
        changeOrders: { orderBy: { createdAt: "desc" } },
        risks: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");

    const contractCodes = await this.contractCodes(scope, [project.contractId]);
    const wbs = buildWbs(project.wbsItems, project.budgetLines, project.changeOrders, project.tasks);
    const initialBudget = sumDecimals(project.budgetLines.map((line) => line.amount));
    const approved = sumDecimals(
      project.changeOrders.filter((order) => order.status === "APPROVED").map((order) => order.amount),
    );
    const revised = initialBudget.plus(approved);
    const progress = taskProgress(project.tasks);
    const taskCounts = { TODO: 0, IN_PROGRESS: 0, BLOCKED: 0, DONE: 0 } as Record<ProjectTaskStatus, number>;
    for (const task of project.tasks) taskCounts[task.status] += 1;
    const costs = await projectCostFigures(this.prisma, scope, project.id);
    const now = new Date();

    return {
      ...summaryFields(project, contractCodes),
      revisedBudget: money(revised),
      physicalProgress: progress,
      description: project.description,
      statusReason: project.statusReason,
      cockpit: {
        contractAmount: money(project.contractAmount),
        initialBudget: money(initialBudget),
        approvedChangeOrders: money(approved),
        revisedBudget: money(revised),
        forecastMargin: money(dec(project.contractAmount).minus(revised)),
        ...costs,
        physicalProgress: progress,
        taskCounts,
      },
      wbs,
      budgetLines: project.budgetLines.map((line) => ({
        id: line.id,
        wbsItemId: line.wbsItemId,
        category: line.category,
        description: line.description,
        amount: money(line.amount),
        createdAt: line.createdAt.toISOString(),
      })),
      tasks: project.tasks.map((task) => ({
        id: task.id,
        wbsItemId: task.wbsItemId,
        name: task.name,
        status: task.status,
        weight: dec(task.weight).toFixed(2),
        plannedStart: task.plannedStart?.toISOString() ?? null,
        plannedEnd: task.plannedEnd?.toISOString() ?? null,
        assigneeUserId: task.assigneeUserId,
        completedAt: task.completedAt?.toISOString() ?? null,
      })),
      milestones: project.milestones.map((milestone) => ({
        id: milestone.id,
        name: milestone.name,
        dueDate: milestone.dueDate.toISOString(),
        status: milestone.status,
        achievedAt: milestone.achievedAt?.toISOString() ?? null,
        overdue: milestone.status === "PLANNED" && milestone.dueDate < startOfDay(now),
      })),
      changeOrders: project.changeOrders.map((order) => ({
        id: order.id,
        wbsItemId: order.wbsItemId,
        code: order.code,
        title: order.title,
        reason: order.reason,
        amount: money(order.amount),
        status: order.status,
        requestedByUserId: order.requestedByUserId,
        decidedByUserId: order.decidedByUserId,
        decidedAt: order.decidedAt?.toISOString() ?? null,
        decisionNote: order.decisionNote,
        createdAt: order.createdAt.toISOString(),
      })),
      risks: project.risks.map((risk) => ({
        id: risk.id,
        title: risk.title,
        description: risk.description,
        probability: risk.probability,
        impact: risk.impact,
        score: risk.probability * risk.impact,
        status: risk.status,
        mitigation: risk.mitigation,
        createdAt: risk.createdAt.toISOString(),
      })),
    };
  }

  // ---------------------------------------------------------------------
  // Projet
  // ---------------------------------------------------------------------

  async create(scope: CompanyScope, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 180);
    const contractId = optionalId(input.contractId, "contractId");
    const description = optionalText(input.description, "description", 2000);
    const location = optionalText(input.location, "location", 180);
    const plannedStart = optionalDate(input.plannedStart, "plannedStart");
    const plannedEnd = optionalDate(input.plannedEnd, "plannedEnd");
    const importContractLines = input.importContractLines === true;
    assertDateOrder(plannedStart, plannedEnd);

    const projectId = await this.prisma.$transaction(async (tx) => {
      let contract: Prisma.ContractGetPayload<{ include: { lines: true } }> | null = null;
      let clientName = optionalText(input.clientName, "clientName", 180);
      let currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "USD";
      if (!/^[A-Z]{3}$/.test(currency)) throw new BadRequestException("currency must be an ISO 4217 code");

      if (contractId) {
        contract = await tx.contract.findFirst({
          where: { id: contractId, ...scope },
          include: { lines: { orderBy: { position: "asc" } } },
        });
        if (!contract) throw new NotFoundException("Contract not found");
        if (contract.status !== "ACTIVE") throw new BadRequestException("Only an ACTIVE contract can start a project");
        const existing = await tx.project.findUnique({ where: { contractId }, select: { code: true } });
        if (existing) throw new ConflictException(`This contract already has a project (${existing.code})`);
        currency = contract.currency.trim();
        const opportunity = await tx.crmOpportunity.findFirst({
          where: { id: contract.opportunityId, ...scope },
          include: { account: { select: { name: true } } },
        });
        clientName = clientName ?? opportunity?.account?.name ?? null;
      }

      const code = await this.numbering.next(tx, scope, "PRJ");
      const project = await tx.project.create({
        data: {
          ...scope,
          code,
          name,
          description,
          location,
          clientName,
          currency,
          contractId: contract?.id ?? null,
          contractAmount: contract ? new Prisma.Decimal(contract.subtotal).toDecimalPlaces(2) : new Prisma.Decimal(0),
          plannedStart,
          plannedEnd,
          createdByUserId: actorUserId,
        },
      });

      if (contract && importContractLines) {
        let position = 0;
        for (const line of contract.lines) {
          position += 1;
          await tx.projectWbsItem.create({
            data: {
              ...scope,
              projectId: project.id,
              code: line.reference ?? `L${line.position}`,
              name: line.designation,
              kind: "WORK_PACKAGE",
              position,
            },
          });
        }
      }

      await writeAudit(tx, scope, actorUserId, "projects.project.created", "Project", project.id, {
        code,
        contractId: contract?.id ?? null,
        importedWbsItems: contract && importContractLines ? contract.lines.length : 0,
      });
      return project.id;
    });
    return this.detail(scope, projectId);
  }

  async changeStatus(scope: CompanyScope, projectId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const target = requiredEnum(input.status, "status", PROJECT_STATUSES);
    const reason = optionalText(input.reason, "reason", 500);

    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      if (!TRANSITIONS[project.status].includes(target)) {
        throw new BadRequestException(`Transition ${project.status} -> ${target} is not allowed`);
      }
      if ((target === "ON_HOLD" || target === "CANCELLED") && !reason) {
        throw new BadRequestException("A reason is required to suspend or cancel a project");
      }
      if (target === "IN_PROGRESS" && !project.budgetBaselinedAt) {
        throw new BadRequestException("Freeze the budget baseline before starting the project");
      }
      if (target === "COMPLETED") {
        const openTasks = await tx.projectTask.count({ where: { projectId, ...scope, status: { not: "DONE" } } });
        if (openTasks > 0) throw new BadRequestException(`${openTasks} task(s) are not done`);
        const pending = await tx.projectChangeOrder.count({ where: { projectId, ...scope, status: "PENDING" } });
        if (pending > 0) throw new BadRequestException(`${pending} change order(s) are still pending`);
      }
      await tx.project.update({
        where: { id: project.id },
        data: {
          status: target,
          statusReason: reason,
          completedAt: target === "COMPLETED" ? new Date() : null,
        },
      });
      await writeAudit(tx, scope, actorUserId, "projects.project.status_changed", "Project", project.id, {
        from: project.status,
        to: target,
        reason,
      });
    });
    return this.detail(scope, projectId);
  }

  // ---------------------------------------------------------------------
  // WBS et budget
  // ---------------------------------------------------------------------

  async addWbsItem(scope: CompanyScope, projectId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const code = requiredText(input.code, "code", 40);
    const name = requiredText(input.name, "name", 180);
    const kind = optionalEnum(input.kind, "kind", WBS_KINDS) ?? "WORK_PACKAGE";
    const parentId = optionalId(input.parentId, "parentId");

    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      assertEditable(project.status);
      if (parentId) {
        const parent = await tx.projectWbsItem.findFirst({ where: { id: parentId, projectId, ...scope } });
        if (!parent) throw new NotFoundException("Parent WBS item not found");
        const [lines, tasks, orders] = await Promise.all([
          tx.projectBudgetLine.count({ where: { wbsItemId: parentId } }),
          tx.projectTask.count({ where: { wbsItemId: parentId } }),
          tx.projectChangeOrder.count({ where: { wbsItemId: parentId } }),
        ]);
        if (lines + tasks + orders > 0) {
          throw new BadRequestException(
            "This WBS item carries budget lines, tasks or change orders: budget is carried by leaf items only",
          );
        }
      }
      const duplicate = await tx.projectWbsItem.findFirst({ where: { projectId, code }, select: { id: true } });
      if (duplicate) throw new ConflictException(`WBS code "${code}" already exists in this project`);
      const siblings = await tx.projectWbsItem.count({ where: { projectId, parentId } });
      const item = await tx.projectWbsItem.create({
        data: { ...scope, projectId, parentId, code, name, kind, position: siblings + 1 },
      });
      await writeAudit(tx, scope, actorUserId, "projects.wbs.created", "ProjectWbsItem", item.id, {
        projectId,
        code,
        parentId,
      });
    });
    return this.detail(scope, projectId);
  }

  async addBudgetLine(scope: CompanyScope, projectId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const wbsItemId = requiredId(input.wbsItemId, "wbsItemId");
    const category = requiredEnum(input.category, "category", COST_CATEGORIES);
    const description = requiredText(input.description, "description", 240);
    const amount = requiredDecimal(input.amount, "amount", { positive: true });

    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      assertEditable(project.status);
      if (project.budgetBaselinedAt) {
        throw new BadRequestException("Budget baseline is frozen: use a change order");
      }
      await this.requireLeaf(tx, scope, projectId, wbsItemId);
      const line = await tx.projectBudgetLine.create({
        data: { ...scope, projectId, wbsItemId, category, description, amount, createdByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "projects.budget.line_added", "ProjectBudgetLine", line.id, {
        projectId,
        wbsItemId,
        amount: money(amount),
      });
    });
    return this.detail(scope, projectId);
  }

  async removeBudgetLine(scope: CompanyScope, projectId: string, lineId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      if (project.budgetBaselinedAt) throw new BadRequestException("Budget baseline is frozen: lines are immutable");
      const line = await tx.projectBudgetLine.findFirst({ where: { id: lineId, projectId, ...scope } });
      if (!line) throw new NotFoundException("Budget line not found");
      await tx.projectBudgetLine.delete({ where: { id: line.id } });
      await writeAudit(tx, scope, actorUserId, "projects.budget.line_removed", "ProjectBudgetLine", line.id, {
        projectId,
        amount: money(line.amount),
      });
    });
    return this.detail(scope, projectId);
  }

  async baseline(scope: CompanyScope, projectId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      assertEditable(project.status);
      if (project.budgetBaselinedAt) throw new BadRequestException("Budget baseline is already frozen");
      const lines = await tx.projectBudgetLine.findMany({ where: { projectId, ...scope }, select: { amount: true } });
      if (lines.length === 0) throw new BadRequestException("Add at least one budget line before freezing the baseline");
      await tx.project.update({
        where: { id: project.id },
        data: { budgetBaselinedAt: new Date(), budgetBaselinedBy: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "projects.budget.baselined", "Project", project.id, {
        initialBudget: money(sumDecimals(lines.map((line) => line.amount))),
        lineCount: lines.length,
      });
    });
    return this.detail(scope, projectId);
  }

  // ---------------------------------------------------------------------
  // Avenants
  // ---------------------------------------------------------------------

  async requestChangeOrder(scope: CompanyScope, projectId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const wbsItemId = requiredId(input.wbsItemId, "wbsItemId");
    const title = requiredText(input.title, "title", 180);
    const reason = requiredText(input.reason, "reason", 1000);
    const amount = requiredDecimal(input.amount, "amount", { allowNegative: true });
    if (amount.isZero()) throw new BadRequestException("amount must not be zero");

    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      assertEditable(project.status);
      if (!project.budgetBaselinedAt) {
        throw new BadRequestException("Change orders apply after the budget baseline; edit budget lines instead");
      }
      await this.requireLeaf(tx, scope, projectId, wbsItemId);
      const count = await tx.projectChangeOrder.count({ where: { projectId } });
      const code = `AV-${String(count + 1).padStart(3, "0")}`;
      const order = await tx.projectChangeOrder.create({
        data: { ...scope, projectId, wbsItemId, code, title, reason, amount, requestedByUserId: actorUserId },
      });
      await writeAudit(tx, scope, actorUserId, "projects.changeorder.requested", "ProjectChangeOrder", order.id, {
        projectId,
        code,
        amount: money(amount),
      });
    });
    return this.detail(scope, projectId);
  }

  async decideChangeOrder(
    scope: CompanyScope,
    projectId: string,
    orderId: string,
    decision: "APPROVED" | "REJECTED",
    body: unknown,
    actorUserId: string,
  ) {
    const note = optionalText(assertBody(body ?? {}).note, "note", 1000);
    if (decision === "REJECTED" && !note) throw new BadRequestException("A note is required to reject a change order");

    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      assertEditable(project.status);
      const order = await tx.projectChangeOrder.findFirst({ where: { id: orderId, projectId, ...scope } });
      if (!order) throw new NotFoundException("Change order not found");
      if (order.requestedByUserId === actorUserId) {
        // Separation des devoirs : le demandeur ne valide jamais sa propre demande.
        throw new ForbiddenException("The requester cannot decide on their own change order");
      }
      const updated = await tx.projectChangeOrder.updateMany({
        where: { id: order.id, status: "PENDING" },
        data: { status: decision, decidedByUserId: actorUserId, decidedAt: new Date(), decisionNote: note },
      });
      if (updated.count !== 1) throw new BadRequestException("Only a pending change order can be decided");
      await writeAudit(
        tx,
        scope,
        actorUserId,
        decision === "APPROVED" ? "projects.changeorder.approved" : "projects.changeorder.rejected",
        "ProjectChangeOrder",
        order.id,
        { projectId, code: order.code, amount: money(order.amount), note },
      );
    });
    return this.detail(scope, projectId);
  }

  // ---------------------------------------------------------------------
  // Taches, jalons, risques
  // ---------------------------------------------------------------------

  async addTask(scope: CompanyScope, projectId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const wbsItemId = requiredId(input.wbsItemId, "wbsItemId");
    const name = requiredText(input.name, "name", 180);
    const weight = input.weight === undefined ? new Prisma.Decimal(1) : requiredDecimal(input.weight, "weight", { positive: true });
    const plannedStart = optionalDate(input.plannedStart, "plannedStart");
    const plannedEnd = optionalDate(input.plannedEnd, "plannedEnd");
    const assigneeUserId = optionalId(input.assigneeUserId, "assigneeUserId");
    assertDateOrder(plannedStart, plannedEnd);

    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      assertEditable(project.status);
      await this.requireLeaf(tx, scope, projectId, wbsItemId);
      if (assigneeUserId) {
        const member = await tx.companyMembership.findFirst({
          where: { userId: assigneeUserId, companyId: scope.companyId },
          select: { id: true },
        });
        if (!member) throw new BadRequestException("Assignee is not a member of this company");
      }
      const task = await tx.projectTask.create({
        data: { ...scope, projectId, wbsItemId, name, weight, plannedStart, plannedEnd, assigneeUserId },
      });
      await writeAudit(tx, scope, actorUserId, "projects.task.created", "ProjectTask", task.id, { projectId, name });
    });
    return this.detail(scope, projectId);
  }

  async setTaskStatus(scope: CompanyScope, projectId: string, taskId: string, body: unknown, actorUserId: string) {
    const status = requiredEnum(assertBody(body).status, "status", TASK_STATUSES);
    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      if (project.status !== "IN_PROGRESS" && project.status !== "PLANNED") {
        throw new BadRequestException(`Tasks cannot progress while the project is ${project.status}`);
      }
      const task = await tx.projectTask.findFirst({ where: { id: taskId, projectId, ...scope } });
      if (!task) throw new NotFoundException("Task not found");
      if (task.status === status) return;
      await tx.projectTask.update({
        where: { id: task.id },
        data: { status, completedAt: status === "DONE" ? new Date() : null },
      });
      await writeAudit(tx, scope, actorUserId, "projects.task.status_changed", "ProjectTask", task.id, {
        projectId,
        from: task.status,
        to: status,
      });
    });
    return this.detail(scope, projectId);
  }

  async addMilestone(scope: CompanyScope, projectId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const name = requiredText(input.name, "name", 180);
    const dueDate = requiredDate(input.dueDate, "dueDate");
    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      assertEditable(project.status);
      const milestone = await tx.projectMilestone.create({ data: { ...scope, projectId, name, dueDate } });
      await writeAudit(tx, scope, actorUserId, "projects.milestone.created", "ProjectMilestone", milestone.id, {
        projectId,
        name,
      });
    });
    return this.detail(scope, projectId);
  }

  async achieveMilestone(scope: CompanyScope, projectId: string, milestoneId: string, actorUserId: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockProject(tx, scope, projectId);
      const updated = await tx.projectMilestone.updateMany({
        where: { id: milestoneId, projectId, ...scope, status: "PLANNED" },
        data: { status: "ACHIEVED", achievedAt: new Date() },
      });
      if (updated.count !== 1) throw new BadRequestException("Milestone not found or already achieved");
      await writeAudit(tx, scope, actorUserId, "projects.milestone.achieved", "ProjectMilestone", milestoneId, {
        projectId,
      });
    });
    return this.detail(scope, projectId);
  }

  async addRisk(scope: CompanyScope, projectId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const title = requiredText(input.title, "title", 180);
    const description = optionalText(input.description, "description", 2000);
    const probability = requiredInt(input.probability, "probability", { min: 1, max: 5 });
    const impact = requiredInt(input.impact, "impact", { min: 1, max: 5 });
    const mitigation = optionalText(input.mitigation, "mitigation", 2000);
    await this.prisma.$transaction(async (tx) => {
      const project = await this.lockProject(tx, scope, projectId);
      assertEditable(project.status);
      const risk = await tx.projectRisk.create({
        data: { ...scope, projectId, title, description, probability, impact, mitigation },
      });
      await writeAudit(tx, scope, actorUserId, "projects.risk.created", "ProjectRisk", risk.id, {
        projectId,
        score: probability * impact,
      });
    });
    return this.detail(scope, projectId);
  }

  async updateRisk(scope: CompanyScope, projectId: string, riskId: string, body: unknown, actorUserId: string) {
    const input = assertBody(body);
    const status = optionalEnum(input.status, "status", RISK_STATUSES);
    const mitigation = optionalText(input.mitigation, "mitigation", 2000);
    await this.prisma.$transaction(async (tx) => {
      await this.lockProject(tx, scope, projectId);
      const risk = await tx.projectRisk.findFirst({ where: { id: riskId, projectId, ...scope } });
      if (!risk) throw new NotFoundException("Risk not found");
      await tx.projectRisk.update({
        where: { id: risk.id },
        data: { ...(status ? { status } : {}), ...(mitigation !== null ? { mitigation } : {}) },
      });
      await writeAudit(tx, scope, actorUserId, "projects.risk.updated", "ProjectRisk", risk.id, {
        projectId,
        status,
      });
    });
    return this.detail(scope, projectId);
  }

  // ---------------------------------------------------------------------
  // Internes
  // ---------------------------------------------------------------------

  /**
   * Verrou pessimiste sur la ligne projet (SELECT ... FOR UPDATE) : toutes les
   * mutations d'un meme projet sont serialisees, ce qui protege les invariants
   * budgetaires contre les conditions de course.
   */
  private async lockProject(tx: Tx, scope: CompanyScope, projectId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "projects"
      WHERE "id" = ${projectId} AND "organizationId" = ${scope.organizationId} AND "companyId" = ${scope.companyId}
      FOR UPDATE
    `;
    if (rows.length === 0) throw new NotFoundException("Project not found");
    return tx.project.findUniqueOrThrow({ where: { id: projectId } });
  }

  private async requireLeaf(tx: Tx, scope: CompanyScope, projectId: string, wbsItemId: string) {
    const item = await tx.projectWbsItem.findFirst({
      where: { id: wbsItemId, projectId, ...scope },
      include: { _count: { select: { children: true } } },
    });
    if (!item) throw new NotFoundException("WBS item not found");
    if (item._count.children > 0) {
      throw new BadRequestException("Budget, tasks and change orders are carried by leaf WBS items only");
    }
    return item;
  }

  private async contractCodes(scope: CompanyScope, ids: Array<string | null>): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (unique.length === 0) return new Map();
    const contracts = await this.prisma.contract.findMany({
      where: { id: { in: unique }, ...scope },
      select: { id: true, code: true },
    });
    return new Map(contracts.map((contract) => [contract.id, contract.code]));
  }
}

function assertEditable(status: ProjectStatus): void {
  if (status === "COMPLETED" || status === "CANCELLED") {
    throw new BadRequestException(`A ${status} project can no longer be modified`);
  }
}

function assertDateOrder(start: Date | null, end: Date | null): void {
  if (start && end && end < start) throw new BadRequestException("plannedEnd must be on or after plannedStart");
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function taskProgress(tasks: Array<{ status: string; weight: Prisma.Decimal }>): string {
  const total = sumDecimals(tasks.map((task) => task.weight));
  const done = sumDecimals(tasks.filter((task) => task.status === "DONE").map((task) => task.weight));
  return percent(done, total);
}

function summaryFields(
  project: Prisma.ProjectGetPayload<object>,
  contractCodes: Map<string, string>,
): Omit<ProjectSummaryView, "revisedBudget" | "physicalProgress"> {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
    clientName: project.clientName,
    location: project.location,
    currency: project.currency.trim(),
    contractId: project.contractId,
    contractCode: project.contractId ? (contractCodes.get(project.contractId) ?? null) : null,
    contractAmount: money(project.contractAmount),
    plannedStart: project.plannedStart?.toISOString() ?? null,
    plannedEnd: project.plannedEnd?.toISOString() ?? null,
    budgetBaselinedAt: project.budgetBaselinedAt?.toISOString() ?? null,
    createdAt: project.createdAt.toISOString(),
  };
}

/**
 * Arbre WBS a plat (ordre de parcours en profondeur) avec budgets DERIVES :
 * une feuille porte ses propres lignes ; un parent = somme de ses feuilles
 * descendantes (jamais de double comptage).
 */
export function buildWbs(
  items: Array<{ id: string; parentId: string | null; code: string; name: string; kind: ProjectWbsNodeView["kind"]; position: number }>,
  budgetLines: Array<{ wbsItemId: string; amount: Prisma.Decimal }>,
  changeOrders: Array<{ wbsItemId: string; amount: Prisma.Decimal; status: string }>,
  tasks: Array<{ wbsItemId: string; status: string; weight: Prisma.Decimal }>,
): ProjectWbsNodeView[] {
  const children = new Map<string | null, typeof items>();
  for (const item of items) {
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  for (const list of children.values()) list.sort((a, b) => a.position - b.position || a.code.localeCompare(b.code));

  const own = new Map<string, Prisma.Decimal>();
  for (const line of budgetLines) own.set(line.wbsItemId, dec(own.get(line.wbsItemId)).plus(line.amount));
  const variations = new Map<string, Prisma.Decimal>();
  for (const order of changeOrders) {
    if (order.status === "APPROVED") variations.set(order.wbsItemId, dec(variations.get(order.wbsItemId)).plus(order.amount));
  }

  const result: ProjectWbsNodeView[] = [];
  function visit(item: (typeof items)[number], depth: number) {
    const index = result.length;
    result.push(null as unknown as ProjectWbsNodeView);
    const kids = children.get(item.id) ?? [];
    let initial = dec(own.get(item.id));
    let revised = initial.plus(dec(variations.get(item.id)));
    const subtreeTasks = tasks.filter((task) => task.wbsItemId === item.id);
    for (const child of kids) {
      const childNode = visit(child, depth + 1);
      initial = initial.plus(childNode.initial);
      revised = revised.plus(childNode.revised);
      subtreeTasks.push(...childNode.tasks);
    }
    result[index] = {
      id: item.id,
      parentId: item.parentId,
      code: item.code,
      name: item.name,
      kind: item.kind,
      isLeaf: kids.length === 0,
      depth,
      initialBudget: money(initial),
      revisedBudget: money(revised),
      physicalProgress: taskProgress(subtreeTasks),
    };
    return { initial, revised, tasks: subtreeTasks };
  }
  for (const root of children.get(null) ?? []) visit(root, 0);
  return result;
}
