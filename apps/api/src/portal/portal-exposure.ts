import type { PortalGrantCandidate, PortalResourceType } from "@axora24/contracts";
import type { PrismaService } from "../core/prisma.service.js";

export interface PrincipalRoot {
  organizationId: string;
  companyId: string;
  kind: "CLIENT" | "SUPPLIER";
  crmAccountId: string | null;
  supplierId: string | null;
}

/** Types exposables par nature de principal (un fournisseur ne voit jamais un projet client, et reciproquement). */
export const TYPES_BY_KIND: Record<"CLIENT" | "SUPPLIER", PortalResourceType[]> = {
  CLIENT: ["PROJECT", "CUSTOMER_INVOICE", "DOCUMENT"],
  SUPPLIER: ["PURCHASE_ORDER", "SUPPLIER_INVOICE"],
};

const EXPOSABLE_CUSTOMER_INVOICE = ["ISSUED", "PARTIALLY_PAID", "PAID"];
const EXPOSABLE_ORDER = ["ISSUED", "PARTIALLY_RECEIVED", "RECEIVED"];
const EXPOSABLE_SUPPLIER_INVOICE = ["RECORDED", "APPROVED", "PARTIALLY_PAID", "PAID"];

/** Projets dont le contrat provient d'une opportunite du compte CRM du client. */
async function clientProjectIds(prisma: PrismaService, root: PrincipalRoot): Promise<Array<{ id: string; code: string; name: string; contractId: string | null }>> {
  const scope = { organizationId: root.organizationId, companyId: root.companyId };
  const opportunities = await prisma.crmOpportunity.findMany({ where: { ...scope, accountId: root.crmAccountId! }, select: { id: true } });
  const contracts = await prisma.contract.findMany({ where: { ...scope, opportunityId: { in: opportunities.map((row) => row.id) } }, select: { id: true } });
  return prisma.project.findMany({ where: { ...scope, contractId: { in: contracts.map((row) => row.id) } }, select: { id: true, code: true, name: true, contractId: true } });
}

/**
 * Ressources que l'enregistrement racine du principal POSSEDE reellement et
 * qui sont dans un etat exposable. Sert a la fois a proposer des
 * autorisations et a les re-verifier a chaque lecture (defense en profondeur).
 */
export async function exposableResources(prisma: PrismaService, root: PrincipalRoot): Promise<PortalGrantCandidate[]> {
  const scope = { organizationId: root.organizationId, companyId: root.companyId };
  if (root.kind === "CLIENT") {
    const projects = await clientProjectIds(prisma, root);
    const projectIds = projects.map((project) => project.id);
    const contractIds = projects.map((project) => project.contractId).filter((id): id is string => Boolean(id));
    const [invoices, documents] = await Promise.all([
      prisma.customerInvoice.findMany({
        where: { ...scope, status: { in: EXPOSABLE_CUSTOMER_INVOICE as never }, OR: [{ projectId: { in: projectIds } }, { contractId: { in: contractIds } }] },
        select: { id: true, code: true, total: true, currency: true },
      }),
      prisma.managedDocument.findMany({ where: { ...scope, projectId: { in: projectIds }, status: "APPROVED" }, select: { id: true, code: true, title: true } }),
    ]);
    return [
      ...projects.map((project) => ({ resourceType: "PROJECT" as const, resourceId: project.id, label: `${project.code} — ${project.name}`, granted: false })),
      ...invoices.map((invoice) => ({ resourceType: "CUSTOMER_INVOICE" as const, resourceId: invoice.id, label: `Facture ${invoice.code ?? "—"} (${invoice.total.toString()} ${invoice.currency.trim()})`, granted: false })),
      ...documents.map((document) => ({ resourceType: "DOCUMENT" as const, resourceId: document.id, label: `${document.code} — ${document.title}`, granted: false })),
    ];
  }
  const [orders, invoices] = await Promise.all([
    prisma.purchaseOrder.findMany({ where: { ...scope, supplierId: root.supplierId!, status: { in: EXPOSABLE_ORDER as never } }, select: { id: true, code: true, total: true, currency: true } }),
    prisma.supplierInvoice.findMany({ where: { ...scope, supplierId: root.supplierId!, status: { in: EXPOSABLE_SUPPLIER_INVOICE as never } }, select: { id: true, code: true, supplierReference: true } }),
  ]);
  return [
    ...orders.map((order) => ({ resourceType: "PURCHASE_ORDER" as const, resourceId: order.id, label: `Commande ${order.code} (${order.total.toString()} ${order.currency.trim()})`, granted: false })),
    ...invoices.map((invoice) => ({ resourceType: "SUPPLIER_INVOICE" as const, resourceId: invoice.id, label: `Facture ${invoice.code} — réf. ${invoice.supplierReference}`, granted: false })),
  ];
}

/** Identifiants autorises ET toujours exposables, par type. */
export async function visibleIds(prisma: PrismaService, root: PrincipalRoot & { id: string }): Promise<Record<PortalResourceType, Set<string>>> {
  const [grants, exposable] = await Promise.all([
    prisma.portalResourceGrant.findMany({ where: { principalId: root.id, revokedAt: null }, select: { resourceType: true, resourceId: true } }),
    exposableResources(prisma, root),
  ]);
  const allowed = new Set(exposable.map((row) => `${row.resourceType}|${row.resourceId}`));
  const result: Record<PortalResourceType, Set<string>> = { PROJECT: new Set(), CUSTOMER_INVOICE: new Set(), DOCUMENT: new Set(), PURCHASE_ORDER: new Set(), SUPPLIER_INVOICE: new Set() };
  for (const grant of grants) if (allowed.has(`${grant.resourceType}|${grant.resourceId}`)) result[grant.resourceType].add(grant.resourceId);
  return result;
}
