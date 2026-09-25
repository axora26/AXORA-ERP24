import {
  AI_PERMISSIONS,
  ASSETS_PERMISSIONS,
  CRM_PERMISSIONS,
  FINANCE_PERMISSIONS,
  FLEET_PERMISSIONS,
  HR_PERMISSIONS,
  PROCUREMENT_PERMISSIONS,
  PROJECT_PERMISSIONS,
  QHSE_PERMISSIONS,
  SMART_PERMISSIONS,
  WORKFLOW_PERMISSIONS,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import type { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { dec, money, sumDecimals } from "../common/decimal.js";
import { formatAmount, formatDay, type ToolDescriptor } from "./planner.js";

export interface ToolContext {
  prisma: PrismaService;
  scope: CompanyScope;
  userId: string;
  /** Permissions effectives de la session (memes que celles des routes API). */
  permissions: Set<string>;
  now: Date;
}

export interface ToolSource {
  resourceType: string;
  resourceId: string;
  label: string;
  link: string | null;
}

export interface ToolFact {
  text: string;
  sources: ToolSource[];
}

export interface ToolOutput {
  title: string;
  facts: ToolFact[];
}

export interface CopilotTool extends ToolDescriptor {
  label: string;
  /** Au moins une de ces permissions de lecture est requise (deny-by-default). */
  permissions: string[];
  example: string;
  run(context: ToolContext): Promise<ToolOutput>;
}

const DAY_MS = 86_400_000;
const LIMIT = 8;

export function granted(tool: { permissions: string[] }, permissions: Set<string>): boolean {
  return tool.permissions.some((permission) => permissions.has(permission));
}

function daysLate(due: Date, now: Date): number {
  return Math.floor((now.getTime() - due.getTime()) / DAY_MS);
}

function byCurrency(rows: Array<{ currency: string; amount: Prisma.Decimal }>): string {
  const totals = new Map<string, Prisma.Decimal>();
  for (const row of rows) totals.set(row.currency.trim(), (totals.get(row.currency.trim()) ?? new Prisma.Decimal(0)).plus(row.amount));
  return [...totals.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([currency, amount]) => formatAmount(money(amount), currency)).join(" + ") || "0,00";
}

async function projectProgress(prisma: PrismaService, projectIds: string[]): Promise<Map<string, string>> {
  const tasks = await prisma.projectTask.findMany({ where: { projectId: { in: projectIds } }, select: { projectId: true, status: true, weight: true } });
  const result = new Map<string, string>();
  for (const id of projectIds) {
    const mine = tasks.filter((task) => task.projectId === id);
    const total = sumDecimals(mine.map((task) => task.weight));
    const done = sumDecimals(mine.filter((task) => task.status === "DONE").map((task) => task.weight));
    result.set(id, total.isZero() ? "0,0" : done.mul(100).div(total).toFixed(1).replace(".", ","));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Outils thematiques
// ---------------------------------------------------------------------------

export const COPILOT_TOOLS: CopilotTool[] = [
  {
    id: "finance.receivables",
    label: "Créances clients",
    permissions: [FINANCE_PERMISSIONS.INVOICE_READ],
    keywords: ["impaye", "impayes", "impayee", "impayees", "creance", "creances", "facture client", "factures clients", "encaissement", "encaissements", "relance", "relances", "recouvrement"],
    example: "Quelles factures clients sont impayées ?",
    async run({ prisma, scope, now }) {
      const invoices = await prisma.customerInvoice.findMany({ where: { ...scope, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" } });
      const open = invoices.map((invoice) => ({ invoice, balance: dec(invoice.total).minus(invoice.paidAmount) })).filter((row) => row.balance.greaterThan(0));
      const overdue = open.filter((row) => row.invoice.dueDate && row.invoice.dueDate < now);
      if (open.length === 0) return { title: "Créances clients", facts: [{ text: "Aucune facture client ouverte : tout ce qui a été émis est réglé.", sources: [] }] };
      const source = (row: (typeof open)[number]): ToolSource => ({ resourceType: "CustomerInvoice", resourceId: row.invoice.id, label: row.invoice.code ?? "Facture", link: `/finance/invoices/${row.invoice.id}` });
      return {
        title: "Créances clients",
        facts: [
          { text: `${open.length} facture(s) client ouverte(s), reste dû ${byCurrency(open.map((row) => ({ currency: row.invoice.currency, amount: row.balance })))} ; ${overdue.length} échue(s).`, sources: open.slice(0, LIMIT).map(source) },
          ...(overdue.length ? overdue : open).slice(0, LIMIT).map((row) => ({
            text: `${row.invoice.code} — ${row.invoice.customerName} : reste ${formatAmount(money(row.balance), row.invoice.currency)}, échéance ${formatDay(row.invoice.dueDate)}${row.invoice.dueDate && row.invoice.dueDate < now ? ` (retard ${daysLate(row.invoice.dueDate, now)} j)` : ""}.`,
            sources: [source(row)],
          })),
        ],
      };
    },
  },
  {
    id: "finance.payables",
    label: "Factures fournisseurs",
    permissions: [FINANCE_PERMISSIONS.PAYABLE_READ],
    keywords: ["facture fournisseur", "factures fournisseurs", "a payer", "payer", "dette", "dettes", "decaissement", "decaissements", "reglement fournisseur", "echeances fournisseurs"],
    example: "Quelles factures fournisseurs devons-nous payer ?",
    async run({ prisma, scope, now }) {
      const invoices = await prisma.supplierInvoice.findMany({ where: { ...scope, status: { in: ["RECORDED", "APPROVED", "PARTIALLY_PAID"] } }, orderBy: { dueDate: "asc" } });
      const suppliers = new Map((await prisma.supplier.findMany({ where: { ...scope, id: { in: [...new Set(invoices.map((invoice) => invoice.supplierId))] } }, select: { id: true, name: true } })).map((supplier) => [supplier.id, supplier.name]));
      if (invoices.length === 0) return { title: "Factures fournisseurs", facts: [{ text: "Aucune facture fournisseur en attente d'approbation ou de paiement.", sources: [] }] };
      const source = (invoice: (typeof invoices)[number]): ToolSource => ({ resourceType: "SupplierInvoice", resourceId: invoice.id, label: invoice.code, link: `/finance/payables/${invoice.id}` });
      const toPay = invoices.filter((invoice) => invoice.status !== "RECORDED");
      const toApprove = invoices.filter((invoice) => invoice.status === "RECORDED");
      return {
        title: "Factures fournisseurs",
        facts: [
          {
            text: `${toPay.length} facture(s) approuvée(s) à payer (${byCurrency(toPay.map((invoice) => ({ currency: invoice.currency, amount: dec(invoice.total).minus(invoice.paidAmount) })))}) et ${toApprove.length} à approuver.`,
            sources: invoices.slice(0, LIMIT).map(source),
          },
          ...invoices.slice(0, LIMIT).map((invoice) => ({
            text: `${invoice.code} — ${suppliers.get(invoice.supplierId) ?? "fournisseur"} (réf. ${invoice.supplierReference}) : ${formatAmount(money(dec(invoice.total).minus(invoice.paidAmount)), invoice.currency)} ${invoice.status === "RECORDED" ? `à approuver (rapprochement ${invoice.matchStatus})` : "à payer"}, échéance ${formatDay(invoice.dueDate)}${invoice.dueDate < now ? " — échue" : ""}.`,
            sources: [source(invoice)],
          })),
        ],
      };
    },
  },
  {
    id: "procurement.requests",
    label: "Demandes d'achat",
    permissions: [PROCUREMENT_PERMISSIONS.REQUEST_READ],
    keywords: ["demande d achat", "demandes d achat", "achat", "achats", "da", "approvisionnement"],
    example: "Quelles demandes d'achat attendent une décision ?",
    async run({ prisma, scope }) {
      const requests = await prisma.purchaseRequest.findMany({ where: { ...scope, status: "SUBMITTED" }, include: { lines: { select: { quantity: true, estimatedUnitPrice: true } } }, orderBy: { submittedAt: "asc" } });
      if (requests.length === 0) return { title: "Demandes d'achat", facts: [{ text: "Aucune demande d'achat soumise n'attend de décision.", sources: [] }] };
      return {
        title: "Demandes d'achat",
        facts: [
          { text: `${requests.length} demande(s) d'achat soumise(s) en attente de décision.`, sources: [] },
          ...requests.slice(0, LIMIT).map((request) => ({
            text: `${request.code} — ${request.title} : ${formatAmount(money(sumDecimals(request.lines.map((line) => dec(line.quantity).mul(line.estimatedUnitPrice)))), request.currency)} estimés, soumise le ${formatDay(request.submittedAt)}.`,
            sources: [{ resourceType: "PurchaseRequest", resourceId: request.id, label: request.code, link: `/procurement/requests/${request.id}` }],
          })),
        ],
      };
    },
  },
  {
    id: "procurement.orders",
    label: "Commandes fournisseurs",
    permissions: [PROCUREMENT_PERMISSIONS.ORDER_READ],
    keywords: ["commande", "commandes", "livraison", "livraisons", "bon de commande", "reception", "receptions", "retard fournisseur"],
    example: "Quelles commandes sont en retard de livraison ?",
    async run({ prisma, scope, now }) {
      const orders = await prisma.purchaseOrder.findMany({ where: { ...scope, status: { in: ["ISSUED", "PARTIALLY_RECEIVED"] } }, include: { supplier: { select: { name: true } } }, orderBy: { expectedDate: "asc" } });
      if (orders.length === 0) return { title: "Commandes fournisseurs", facts: [{ text: "Aucune commande émise en attente de livraison.", sources: [] }] };
      const late = orders.filter((order) => order.expectedDate && order.expectedDate < now);
      return {
        title: "Commandes fournisseurs",
        facts: [
          { text: `${orders.length} commande(s) en attente de livraison, dont ${late.length} en retard.`, sources: [] },
          ...(late.length ? late : orders).slice(0, LIMIT).map((order) => ({
            text: `${order.code} — ${order.supplier.name} : ${formatAmount(money(order.total), order.currency)}, ${order.status === "PARTIALLY_RECEIVED" ? "partiellement livrée" : "émise"}, livraison attendue ${formatDay(order.expectedDate)}${order.expectedDate && order.expectedDate < now ? ` (retard ${daysLate(order.expectedDate, now)} j)` : ""}.`,
            sources: [{ resourceType: "PurchaseOrder", resourceId: order.id, label: order.code, link: `/procurement/orders/${order.id}` }],
          })),
        ],
      };
    },
  },
  {
    id: "projects.portfolio",
    label: "Projets",
    permissions: [PROJECT_PERMISSIONS.PROJECT_READ],
    keywords: ["projet", "projets", "avancement", "planning", "affaire", "affaires", "retard projet", "portefeuille"],
    example: "Où en sont les projets en cours ?",
    async run({ prisma, scope, now }) {
      const projects = await prisma.project.findMany({ where: { ...scope, status: { in: ["PLANNED", "IN_PROGRESS", "ON_HOLD"] } }, orderBy: { plannedEnd: "asc" } });
      if (projects.length === 0) return { title: "Projets", facts: [{ text: "Aucun projet actif.", sources: [] }] };
      const progress = await projectProgress(prisma, projects.map((project) => project.id));
      const status: Record<string, string> = { PLANNED: "planifié", IN_PROGRESS: "en cours", ON_HOLD: "suspendu" };
      return {
        title: "Projets",
        facts: projects.slice(0, LIMIT).map((project) => ({
          text: `${project.code} — ${project.name} : ${status[project.status]}, avancement physique ${progress.get(project.id)} %, fin prévue ${formatDay(project.plannedEnd)}${project.plannedEnd && project.plannedEnd < now ? " — échéance dépassée" : ""}.`,
          sources: [{ resourceType: "Project", resourceId: project.id, label: project.code, link: `/projects/${project.id}` }],
        })),
      };
    },
  },
  {
    id: "qhse.open",
    label: "QHSE",
    permissions: [QHSE_PERMISSIONS.READ],
    keywords: ["non conformite", "non conformites", "nc", "qhse", "securite", "qualite", "environnement", "incident", "incidents", "accident", "accidents", "action corrective", "actions correctives"],
    example: "Quelles non-conformités sont ouvertes ?",
    async run({ prisma, scope, now }) {
      const findings = await prisma.qhseFinding.findMany({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] } }, orderBy: { detectedAt: "asc" } });
      const lateActions = await prisma.qhseCorrectiveAction.count({ where: { ...scope, status: "OPEN", dueDate: { lt: now } } });
      if (findings.length === 0) return { title: "QHSE", facts: [{ text: `Aucune non-conformité ouverte${lateActions ? `, mais ${lateActions} action(s) corrective(s) en retard` : ""}.`, sources: [] }] };
      const order: Record<string, number> = { CRITICAL: 0, MAJOR: 1, MINOR: 2 };
      const label: Record<string, string> = { CRITICAL: "critique", MAJOR: "majeure", MINOR: "mineure" };
      const sorted = [...findings].sort((left, right) => order[left.severity]! - order[right.severity]!);
      return {
        title: "QHSE",
        facts: [
          { text: `${findings.length} non-conformité(s) ouverte(s) dont ${findings.filter((finding) => finding.severity === "CRITICAL").length} critique(s) ; ${lateActions} action(s) corrective(s) en retard.`, sources: [] },
          ...sorted.slice(0, LIMIT).map((finding) => ({
            text: `${finding.code} — ${finding.title} : ${label[finding.severity]}, ${finding.status === "OPEN" ? "ouverte" : "en traitement"} depuis le ${formatDay(finding.detectedAt)}.`,
            sources: [{ resourceType: "QhseFinding", resourceId: finding.id, label: finding.code, link: `/qhse/findings/${finding.id}` }],
          })),
        ],
      };
    },
  },
  {
    id: "assets.maintenance",
    label: "Maintenance (GMAO)",
    permissions: [ASSETS_PERMISSIONS.ASSET_READ],
    keywords: ["maintenance", "gmao", "panne", "pannes", "ordre de travail", "ordres de travail", "ot", "ticket", "tickets", "equipement", "equipements", "intervention", "interventions"],
    example: "Quels ordres de travail sont en retard ?",
    async run({ prisma, scope, now }) {
      const [orders, tickets] = await Promise.all([
        prisma.workOrder.findMany({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] } }, include: { asset: { select: { code: true, name: true } } }, orderBy: { dueDate: "asc" } }),
        prisma.maintenanceTicket.count({ where: { ...scope, status: "OPEN" } }),
      ]);
      const late = orders.filter((order) => order.dueDate < now);
      return {
        title: "Maintenance (GMAO)",
        facts: [
          { text: `${orders.length} ordre(s) de travail ouvert(s) dont ${late.length} en retard ; ${tickets} ticket(s) de panne à qualifier.`, sources: [] },
          ...(late.length ? late : orders).slice(0, LIMIT).map((order) => ({
            text: `${order.code} — ${order.title} (${order.asset.code} ${order.asset.name}) : ${order.type === "CORRECTIVE" ? "correctif" : "préventif"}, échéance ${formatDay(order.dueDate)}${order.dueDate < now ? ` (retard ${daysLate(order.dueDate, now)} j)` : ""}.`,
            sources: [{ resourceType: "WorkOrder", resourceId: order.id, label: order.code, link: `/assets/work-orders/${order.id}` }],
          })),
        ],
      };
    },
  },
  {
    id: "smart.alarms",
    label: "Alarmes techniques (GTB)",
    permissions: [SMART_PERMISSIONS.READ],
    keywords: ["alarme", "alarmes", "gtb", "bms", "capteur", "capteurs", "temperature", "batiment intelligent", "smart building"],
    example: "Y a-t-il des alarmes techniques actives ?",
    async run({ prisma, scope }) {
      const alarms = await prisma.smartAlarm.findMany({ where: { ...scope, status: { in: ["ACTIVE", "ACKNOWLEDGED"] } }, orderBy: { raisedAt: "desc" } });
      if (alarms.length === 0) return { title: "Alarmes techniques", facts: [{ text: "Aucune alarme technique active.", sources: [] }] };
      const points = new Map((await prisma.smartPoint.findMany({ where: { ...scope, id: { in: alarms.map((alarm) => alarm.pointId) } }, select: { id: true, name: true, unit: true } })).map((point) => [point.id, point]));
      const severity: Record<string, string> = { CRITICAL: "critique", WARNING: "avertissement", INFO: "information" };
      return {
        title: "Alarmes techniques",
        facts: [
          { text: `${alarms.length} alarme(s) non résorbée(s) : ${alarms.filter((alarm) => alarm.status === "ACTIVE").length} active(s), ${alarms.filter((alarm) => alarm.status === "ACKNOWLEDGED").length} acquittée(s).`, sources: [] },
          ...alarms.slice(0, LIMIT).map((alarm) => {
            const point = points.get(alarm.pointId);
            return {
              text: `${point?.name ?? "Point"} — ${alarm.message} : ${severity[alarm.severity] ?? alarm.severity}, valeur ${alarm.triggerValue.toString()}${point?.unit ? ` ${point.unit}` : ""} le ${formatDay(alarm.raisedAt)}${alarm.status === "ACKNOWLEDGED" ? " (acquittée)" : ""}.`,
              sources: [{ resourceType: "SmartAlarm", resourceId: alarm.id, label: point?.name ?? "Alarme", link: `/smart/points/${alarm.pointId}` }],
            };
          }),
        ],
      };
    },
  },
  {
    id: "fleet.status",
    label: "Parc véhicules & engins",
    permissions: [FLEET_PERMISSIONS.READ],
    keywords: ["vehicule", "vehicules", "engin", "engins", "parc", "flotte", "camion", "camions", "immobilise", "immobilises", "sinistre", "sinistres"],
    example: "Quels véhicules sont immobilisés ?",
    async run({ prisma, scope }) {
      const [vehicles, incidents] = await Promise.all([
        prisma.fleetVehicle.findMany({ where: { ...scope, status: { not: "DISPOSED" } }, orderBy: { code: "asc" } }),
        prisma.fleetIncident.findMany({ where: { ...scope, status: "OPEN" }, include: { vehicle: { select: { code: true } } }, orderBy: { occurredAt: "desc" } }),
      ]);
      const immobilized = vehicles.filter((vehicle) => vehicle.status === "IMMOBILIZED");
      return {
        title: "Parc véhicules & engins",
        facts: [
          { text: `${vehicles.length} véhicule(s)/engin(s) au parc, ${immobilized.length} immobilisé(s), ${incidents.length} incident(s) ouvert(s).`, sources: [] },
          ...immobilized.slice(0, LIMIT).map((vehicle) => ({
            text: `${vehicle.code} — ${vehicle.make} ${vehicle.model}${vehicle.registration ? ` (${vehicle.registration})` : ""} : immobilisé.`,
            sources: [{ resourceType: "FleetVehicle", resourceId: vehicle.id, label: vehicle.code, link: `/fleet/vehicles/${vehicle.id}` }],
          })),
          ...incidents.slice(0, LIMIT).map((incident) => ({
            text: `${incident.code} — ${incident.vehicle.code} : incident du ${formatDay(incident.occurredAt)}${incident.cost ? `, coût ${formatAmount(money(incident.cost))}` : ""}.`,
            sources: [{ resourceType: "FleetIncident", resourceId: incident.id, label: incident.code, link: `/fleet/vehicles/${incident.vehicleId}` }],
          })),
        ],
      };
    },
  },
  {
    id: "hr.people",
    label: "Ressources humaines",
    permissions: [HR_PERMISSIONS.EMPLOYEE_READ],
    keywords: ["effectif", "effectifs", "employe", "employes", "salarie", "salaries", "personnel", "conge", "conges", "absence", "absences", "rh"],
    example: "Quel est l'effectif et quels congés sont en attente ?",
    async run({ prisma, scope }) {
      const [active, leaves] = await Promise.all([
        prisma.employee.count({ where: { ...scope, status: "ACTIVE" } }),
        prisma.leaveRequest.findMany({ where: { ...scope, status: "REQUESTED" }, include: { employee: { select: { code: true, firstName: true, lastName: true } } }, orderBy: { startDate: "asc" } }),
      ]);
      return {
        title: "Ressources humaines",
        facts: [
          { text: `${active} employé(s) actif(s) ; ${leaves.length} demande(s) de congé en attente.`, sources: [{ resourceType: "EmployeeRegister", resourceId: "active", label: "Registre du personnel", link: "/hr" }] },
          ...leaves.slice(0, LIMIT).map((leave) => ({
            text: `${leave.employee.firstName} ${leave.employee.lastName} (${leave.employee.code}) : ${leave.days.toString()} j du ${formatDay(leave.startDate)} au ${formatDay(leave.endDate)}.`,
            sources: [{ resourceType: "LeaveRequest", resourceId: leave.id, label: `Congé ${leave.employee.code}`, link: "/hr" }],
          })),
        ],
      };
    },
  },
  {
    id: "crm.pipeline",
    label: "Pipeline commercial",
    permissions: [CRM_PERMISSIONS.OPPORTUNITY_READ],
    keywords: ["pipeline", "opportunite", "opportunites", "prospect", "prospects", "commercial", "ventes", "affaires en cours", "carnet"],
    example: "Que contient le pipeline commercial ?",
    async run({ prisma, scope }) {
      const opportunities = await prisma.crmOpportunity.findMany({ where: { ...scope, status: "OPEN" }, include: { stage: { select: { name: true, probability: true } } }, orderBy: { amount: "desc" } });
      if (opportunities.length === 0) return { title: "Pipeline commercial", facts: [{ text: "Aucune opportunité ouverte.", sources: [] }] };
      const weighted = opportunities.map((opportunity) => ({ currency: opportunity.currency, amount: dec(opportunity.amount).mul(opportunity.stage.probability).div(100) }));
      return {
        title: "Pipeline commercial",
        facts: [
          { text: `${opportunities.length} opportunité(s) ouverte(s) : ${byCurrency(opportunities.map((opportunity) => ({ currency: opportunity.currency, amount: dec(opportunity.amount) })))} brut, ${byCurrency(weighted)} pondéré.`, sources: [] },
          ...opportunities.slice(0, 5).map((opportunity) => ({
            text: `${opportunity.name} : ${formatAmount(money(opportunity.amount), opportunity.currency)}, étape « ${opportunity.stage.name} » (${opportunity.stage.probability} %), clôture visée ${formatDay(opportunity.expectedCloseDate)}.`,
            sources: [{ resourceType: "CrmOpportunity", resourceId: opportunity.id, label: opportunity.name, link: "/crm" }],
          })),
        ],
      };
    },
  },
  {
    id: "workflow.approvals",
    label: "Approbations de workflow",
    permissions: [WORKFLOW_PERMISSIONS.READ, WORKFLOW_PERMISSIONS.APPROVE],
    keywords: ["approbation", "approbations", "valider", "validation", "visa", "visas", "a signer", "ma decision", "mes approbations"],
    example: "Quelles approbations attendent ma décision ?",
    async run({ prisma, scope, userId, now }) {
      const approvals = await prisma.workflowApproval.findMany({ where: { ...scope, status: "PENDING" }, orderBy: { dueAt: "asc" } });
      if (approvals.length === 0) return { title: "Approbations de workflow", facts: [{ text: "Aucune approbation de workflow en attente.", sources: [] }] };
      const roles = new Set((await prisma.roleAssignment.findMany({ where: { userId, role: { organizationId: scope.organizationId }, OR: [{ companyId: null }, { companyId: scope.companyId }] }, select: { roleId: true } })).map((row) => row.roleId));
      const mine = approvals.filter((approval) => approval.requesterUserId !== userId && (roles.has(approval.approverRoleId) || Boolean(approval.escalatedAt && approval.escalationRoleId && roles.has(approval.escalationRoleId))));
      return {
        title: "Approbations de workflow",
        facts: [
          { text: `${approvals.length} approbation(s) en attente, dont ${mine.length} relevant de votre décision et ${approvals.filter((approval) => approval.dueAt < now).length} hors délai.`, sources: [] },
          ...(mine.length ? mine : approvals).slice(0, LIMIT).map((approval) => ({
            text: `${approval.code} — ${approval.title} : échéance ${formatDay(approval.dueAt)}${approval.dueAt < now ? " (hors délai)" : ""}${mine.includes(approval) ? " — à vous de décider" : ""}.`,
            sources: [{ resourceType: "WorkflowApproval", resourceId: approval.id, label: approval.code, link: "/workflow?tab=approvals" }],
          })),
        ],
      };
    },
  },
];

// ---------------------------------------------------------------------------
// Consultation par reference de piece
// ---------------------------------------------------------------------------

export interface ReferenceHandler {
  label: string;
  permissions: string[];
  find(context: ToolContext, code: string): Promise<ToolFact | null>;
}

export const REFERENCE_HANDLERS: Record<string, ReferenceHandler> = {
  PRJ: {
    label: "Projet",
    permissions: [PROJECT_PERMISSIONS.PROJECT_READ],
    async find({ prisma, scope }, code) {
      const project = await prisma.project.findFirst({ where: { ...scope, code } });
      if (!project) return null;
      const progress = await projectProgress(prisma, [project.id]);
      return { text: `${project.code} — ${project.name} : statut ${project.status}, avancement physique ${progress.get(project.id)} %, du ${formatDay(project.plannedStart)} au ${formatDay(project.plannedEnd)}, marché ${formatAmount(money(project.contractAmount), project.currency)}.`, sources: [{ resourceType: "Project", resourceId: project.id, label: project.code, link: `/projects/${project.id}` }] };
    },
  },
  DA: {
    label: "Demande d'achat",
    permissions: [PROCUREMENT_PERMISSIONS.REQUEST_READ],
    async find({ prisma, scope, permissions }, code) {
      const request = await prisma.purchaseRequest.findFirst({ where: { ...scope, code }, include: { lines: { select: { quantity: true, estimatedUnitPrice: true } } } });
      if (!request) return null;
      const status: Record<string, string> = { DRAFT: "brouillon", SUBMITTED: "soumise, en attente de décision", APPROVED: "approuvée", REJECTED: "refusée", CANCELLED: "annulée" };
      let workflow = "";
      const sources: ToolSource[] = [{ resourceType: "PurchaseRequest", resourceId: request.id, label: request.code, link: `/procurement/requests/${request.id}` }];
      // L'etat du workflow n'est cite que si l'utilisateur peut lui-meme le consulter.
      if (permissions.has(WORKFLOW_PERMISSIONS.READ) || permissions.has(WORKFLOW_PERMISSIONS.APPROVE)) {
        const approvals = await prisma.workflowApproval.findMany({ where: { ...scope, resourceType: "PurchaseRequest", resourceId: request.id }, orderBy: { createdAt: "asc" } });
        const labels: Record<string, string> = { PENDING: "en attente", APPROVED: "accordée", REJECTED: "refusée" };
        if (approvals.length) workflow = ` Workflow : ${approvals.map((approval) => `${approval.code} ${labels[approval.status]}`).join(", ")}.`;
        sources.push(...approvals.map((approval) => ({ resourceType: "WorkflowApproval", resourceId: approval.id, label: approval.code, link: "/workflow?tab=approvals" })));
      }
      return { text: `${request.code} — ${request.title} : ${status[request.status] ?? request.status}, ${formatAmount(money(sumDecimals(request.lines.map((line) => dec(line.quantity).mul(line.estimatedUnitPrice)))), request.currency)} estimés.${workflow}`, sources };
    },
  },
  BC: {
    label: "Commande",
    permissions: [PROCUREMENT_PERMISSIONS.ORDER_READ],
    async find({ prisma, scope }, code) {
      const order = await prisma.purchaseOrder.findFirst({ where: { ...scope, code }, include: { supplier: { select: { name: true } } } });
      if (!order) return null;
      return { text: `${order.code} — ${order.supplier.name} : statut ${order.status}, ${formatAmount(money(order.total), order.currency)}, livraison attendue ${formatDay(order.expectedDate)}.`, sources: [{ resourceType: "PurchaseOrder", resourceId: order.id, label: order.code, link: `/procurement/orders/${order.id}` }] };
    },
  },
  FF: {
    label: "Facture fournisseur",
    permissions: [FINANCE_PERMISSIONS.PAYABLE_READ],
    async find({ prisma, scope }, code) {
      const invoice = await prisma.supplierInvoice.findFirst({ where: { ...scope, code } });
      if (!invoice) return null;
      return { text: `${invoice.code} (réf. ${invoice.supplierReference}) : statut ${invoice.status}, rapprochement ${invoice.matchStatus}, ${formatAmount(money(invoice.total), invoice.currency)} dont ${formatAmount(money(invoice.paidAmount), invoice.currency)} réglés, échéance ${formatDay(invoice.dueDate)}.`, sources: [{ resourceType: "SupplierInvoice", resourceId: invoice.id, label: invoice.code, link: `/finance/payables/${invoice.id}` }] };
    },
  },
  FAC: {
    label: "Facture client",
    permissions: [FINANCE_PERMISSIONS.INVOICE_READ],
    async find({ prisma, scope }, code) {
      const invoice = await prisma.customerInvoice.findFirst({ where: { ...scope, code } });
      if (!invoice) return null;
      return { text: `${invoice.code} — ${invoice.customerName} : statut ${invoice.status}, ${formatAmount(money(invoice.total), invoice.currency)} dont ${formatAmount(money(invoice.paidAmount), invoice.currency)} encaissés, échéance ${formatDay(invoice.dueDate)}.`, sources: [{ resourceType: "CustomerInvoice", resourceId: invoice.id, label: invoice.code ?? code, link: `/finance/invoices/${invoice.id}` }] };
    },
  },
  NC: {
    label: "Non-conformité",
    permissions: [QHSE_PERMISSIONS.READ],
    async find({ prisma, scope }, code) {
      const finding = await prisma.qhseFinding.findFirst({ where: { ...scope, code }, include: { actions: { select: { status: true } } } });
      if (!finding) return null;
      return { text: `${finding.code} — ${finding.title} : gravité ${finding.severity}, statut ${finding.status}, ${finding.actions.filter((action) => action.status === "OPEN").length} action(s) corrective(s) ouverte(s) sur ${finding.actions.length}.`, sources: [{ resourceType: "QhseFinding", resourceId: finding.id, label: finding.code, link: `/qhse/findings/${finding.id}` }] };
    },
  },
  OT: {
    label: "Ordre de travail",
    permissions: [ASSETS_PERMISSIONS.ASSET_READ],
    async find({ prisma, scope }, code) {
      const order = await prisma.workOrder.findFirst({ where: { ...scope, code }, include: { asset: { select: { code: true, name: true } } } });
      if (!order) return null;
      return { text: `${order.code} — ${order.title} (${order.asset.code} ${order.asset.name}) : statut ${order.status}, échéance ${formatDay(order.dueDate)}${order.completedAt ? `, terminé le ${formatDay(order.completedAt)}` : ""}.`, sources: [{ resourceType: "WorkOrder", resourceId: order.id, label: order.code, link: `/assets/work-orders/${order.id}` }] };
    },
  },
  WFA: {
    label: "Approbation de workflow",
    permissions: [WORKFLOW_PERMISSIONS.READ, WORKFLOW_PERMISSIONS.APPROVE],
    async find({ prisma, scope }, code) {
      const approval = await prisma.workflowApproval.findFirst({ where: { ...scope, code } });
      if (!approval) return null;
      return { text: `${approval.code} — ${approval.title} : statut ${approval.status}, échéance ${formatDay(approval.dueAt)}${approval.decisionNote ? `, motif « ${approval.decisionNote} »` : ""}.`, sources: [{ resourceType: "WorkflowApproval", resourceId: approval.id, label: approval.code, link: "/workflow?tab=approvals" }] };
    },
  },
};

/** Permission d'usage du copilote (ne donne acces a aucune donnee par elle-meme). */
export const COPILOT_USE = AI_PERMISSIONS.USE;
