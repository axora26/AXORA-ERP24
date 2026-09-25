import {
  ASSETS_PERMISSIONS,
  CRM_PERMISSIONS,
  ENERGY_PERMISSIONS,
  FINANCE_PERMISSIONS,
  FLEET_PERMISSIONS,
  HR_PERMISSIONS,
  PROCUREMENT_PERMISSIONS,
  QHSE_PERMISSIONS,
  type AnalyticsMetricDescriptor,
} from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import type { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { monthStart, type BucketRow } from "./buckets.js";

export interface MetricRows {
  rows: BucketRow[];
  /** Enregistrements sources lus (un enregistrement peut alimenter deux series). */
  sourceRows: number;
}

export interface MetricDefinition extends AnalyticsMetricDescriptor {
  /** Ordre impose des series nommees (absent : series par devise, ordre alphabetique). */
  order?: string[];
  rows(prisma: PrismaService, scope: CompanyScope, from: Date, to: Date): Promise<MetricRows>;
}

const DAY_MS = 86_400_000;
const within = (from: Date, to: Date) => ({ gte: from, lt: to });
const inWindow = (date: Date | null, from: Date, to: Date): date is Date => Boolean(date && date >= from && date < to);

/**
 * Catalogue des indicateurs. Chacun lit les donnees reelles de son module,
 * dans le perimetre entreprise, et exige la permission de lecture de ce module.
 */
export const METRICS: MetricDefinition[] = [
  {
    key: "finance.invoiced",
    label: "Facturation émise",
    domain: "finance",
    domainLabel: "Finance",
    unit: "money",
    description: "Total TTC des factures clients émises, par date d'émission (factures annulées exclues).",
    permission: FINANCE_PERMISSIONS.INVOICE_READ,
    async rows(prisma, scope, from, to) {
      const invoices = await prisma.customerInvoice.findMany({ where: { ...scope, status: { in: ["ISSUED", "PARTIALLY_PAID", "PAID"] }, issueDate: within(from, to) }, select: { issueDate: true, total: true, currency: true } });
      return { rows: invoices.map((invoice) => ({ at: invoice.issueDate!, series: invoice.currency.trim(), value: invoice.total })), sourceRows: invoices.length };
    },
  },
  {
    key: "finance.collected",
    label: "Encaissements",
    domain: "finance",
    domainLabel: "Finance",
    unit: "money",
    description: "Paiements clients reçus, par date de paiement.",
    permission: FINANCE_PERMISSIONS.INVOICE_READ,
    async rows(prisma, scope, from, to) {
      const payments = await prisma.payment.findMany({ where: { ...scope, direction: "IN", paidAt: within(from, to) }, select: { paidAt: true, amount: true, currency: true } });
      return { rows: payments.map((payment) => ({ at: payment.paidAt, series: payment.currency.trim(), value: payment.amount })), sourceRows: payments.length };
    },
  },
  {
    key: "finance.disbursed",
    label: "Décaissements fournisseurs",
    domain: "finance",
    domainLabel: "Finance",
    unit: "money",
    description: "Paiements émis vers les fournisseurs, par date de paiement.",
    permission: FINANCE_PERMISSIONS.PAYABLE_READ,
    async rows(prisma, scope, from, to) {
      const payments = await prisma.payment.findMany({ where: { ...scope, direction: "OUT", paidAt: within(from, to) }, select: { paidAt: true, amount: true, currency: true } });
      return { rows: payments.map((payment) => ({ at: payment.paidAt, series: payment.currency.trim(), value: payment.amount })), sourceRows: payments.length };
    },
  },
  {
    key: "procurement.ordered",
    label: "Commandes fournisseurs émises",
    domain: "procurement",
    domainLabel: "Achats",
    unit: "money",
    description: "Montant des commandes émises (brouillons et annulées exclus), par date d'émission.",
    permission: PROCUREMENT_PERMISSIONS.ORDER_READ,
    async rows(prisma, scope, from, to) {
      const orders = await prisma.purchaseOrder.findMany({ where: { ...scope, status: { in: ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"] }, issuedAt: within(from, to) }, select: { issuedAt: true, total: true, currency: true } });
      return { rows: orders.map((order) => ({ at: order.issuedAt!, series: order.currency.trim(), value: order.total })), sourceRows: orders.length };
    },
  },
  {
    key: "crm.won",
    label: "Affaires gagnées",
    domain: "crm",
    domainLabel: "Commercial",
    unit: "money",
    description: "Montant des opportunités gagnées, par date de clôture.",
    permission: CRM_PERMISSIONS.OPPORTUNITY_READ,
    async rows(prisma, scope, from, to) {
      const won = await prisma.crmOpportunity.findMany({ where: { ...scope, status: "WON", closedAt: within(from, to) }, select: { closedAt: true, amount: true, currency: true } });
      return { rows: won.map((opportunity) => ({ at: opportunity.closedAt!, series: opportunity.currency.trim(), value: opportunity.amount })), sourceRows: won.length };
    },
  },
  {
    key: "qhse.findings",
    label: "Non-conformités ouvertes et clôturées",
    domain: "qhse",
    domainLabel: "QHSE",
    unit: "count",
    description: "Non-conformités constatées (date de détection) et clôturées (date de clôture).",
    permission: QHSE_PERMISSIONS.READ,
    order: ["Ouvertes", "Clôturées"],
    async rows(prisma, scope, from, to) {
      const findings = await prisma.qhseFinding.findMany({ where: { ...scope, OR: [{ detectedAt: within(from, to) }, { closedAt: within(from, to) }] }, select: { detectedAt: true, closedAt: true } });
      const rows: BucketRow[] = [];
      for (const finding of findings) {
        if (inWindow(finding.detectedAt, from, to)) rows.push({ at: finding.detectedAt, series: "Ouvertes", value: 1 });
        if (inWindow(finding.closedAt, from, to)) rows.push({ at: finding.closedAt, series: "Clôturées", value: 1 });
      }
      return { rows, sourceRows: findings.length };
    },
  },
  {
    key: "qhse.incidents",
    label: "Incidents de sécurité",
    domain: "qhse",
    domainLabel: "QHSE",
    unit: "count",
    description: "Incidents déclarés par date de survenue, dont ceux avec arrêt de travail.",
    permission: QHSE_PERMISSIONS.READ,
    order: ["Incidents", "Avec arrêt"],
    async rows(prisma, scope, from, to) {
      const incidents = await prisma.safetyIncident.findMany({ where: { ...scope, occurredAt: within(from, to) }, select: { occurredAt: true, lostDays: true } });
      return {
        rows: incidents.flatMap((incident) => [{ at: incident.occurredAt, series: "Incidents", value: 1 }, ...(incident.lostDays > 0 ? [{ at: incident.occurredAt, series: "Avec arrêt", value: 1 }] : [])]),
        sourceRows: incidents.length,
      };
    },
  },
  {
    key: "assets.workorders",
    label: "Ordres de travail terminés",
    domain: "assets",
    domainLabel: "GMAO",
    unit: "count",
    description: "Ordres de travail terminés par date d'achèvement, dans les délais (au plus tard le jour d'échéance) ou en retard.",
    permission: ASSETS_PERMISSIONS.ASSET_READ,
    order: ["Dans les délais", "En retard"],
    async rows(prisma, scope, from, to) {
      const orders = await prisma.workOrder.findMany({ where: { ...scope, status: "COMPLETED", completedAt: within(from, to) }, select: { completedAt: true, dueDate: true } });
      return {
        rows: orders.map((order) => ({ at: order.completedAt!, series: order.completedAt!.getTime() < order.dueDate.getTime() + DAY_MS ? "Dans les délais" : "En retard", value: 1 })),
        sourceRows: orders.length,
      };
    },
  },
  {
    key: "hr.hours",
    label: "Heures validées",
    domain: "hr",
    domainLabel: "Ressources humaines",
    unit: "hours",
    description: "Heures des feuilles de temps validées, rattachées au mois du lundi de la semaine.",
    permission: HR_PERMISSIONS.EMPLOYEE_READ,
    order: ["Heures validées"],
    async rows(prisma, scope, from, to) {
      const sheets = await prisma.timesheet.findMany({ where: { ...scope, status: "VALIDATED", weekStart: within(from, to) }, select: { weekStart: true, totalHours: true } });
      return { rows: sheets.map((sheet) => ({ at: sheet.weekStart, series: "Heures validées", value: sheet.totalHours })), sourceRows: sheets.length };
    },
  },
  {
    key: "energy.balance",
    label: "Énergie consommée et produite",
    domain: "energy",
    domainLabel: "Énergie",
    unit: "kwh",
    description: "Intervalles réels des compteurs (données simulées exclues) : consommation, import réseau, production photovoltaïque.",
    permission: ENERGY_PERMISSIONS.READ,
    order: ["Consommation", "Import réseau", "Production PV"],
    async rows(prisma, scope, from, to) {
      const label: Record<string, string> = { CONSUMPTION: "Consommation", GRID_IMPORT: "Import réseau", PV_PRODUCTION: "Production PV" };
      const grouped = await prisma.$queryRaw<Array<{ month: string; kind: string; total: Prisma.Decimal; n: number }>>`
        SELECT to_char(date_trunc('month', i."periodStart"), 'YYYY-MM') AS month, m."kind"::text AS kind, SUM(i."value") AS total, COUNT(*)::int AS n
        FROM "energy_intervals" i JOIN "energy_meters" m ON m."id" = i."meterId"
        WHERE i."organizationId" = ${scope.organizationId} AND i."companyId" = ${scope.companyId} AND i."simulated" = false
          AND m."kind"::text IN ('CONSUMPTION', 'GRID_IMPORT', 'PV_PRODUCTION') AND i."periodStart" >= ${from} AND i."periodStart" < ${to}
        GROUP BY 1, 2`;
      return {
        rows: grouped.map((row) => ({ at: monthStart(row.month), series: label[row.kind] ?? row.kind, value: new Prisma.Decimal(row.total) })),
        sourceRows: grouped.reduce((sum, row) => sum + row.n, 0),
      };
    },
  },
  {
    key: "fleet.fuel",
    label: "Carburant du parc",
    domain: "fleet",
    domainLabel: "Parc",
    unit: "liters",
    description: "Litres délivrés aux véhicules et engins, par date de plein.",
    permission: FLEET_PERMISSIONS.READ,
    order: ["Litres"],
    async rows(prisma, scope, from, to) {
      const logs = await prisma.fleetFuelLog.findMany({ where: { ...scope, filledAt: within(from, to) }, select: { filledAt: true, liters: true } });
      return { rows: logs.map((log) => ({ at: log.filledAt, series: "Litres", value: log.liters })), sourceRows: logs.length };
    },
  },
];

export function descriptor(metric: MetricDefinition): AnalyticsMetricDescriptor {
  return { key: metric.key, label: metric.label, domain: metric.domain, domainLabel: metric.domainLabel, unit: metric.unit, description: metric.description, permission: metric.permission };
}
