/**
 * INC-19 — Sous-traitants. Reutilise Achats (fournisseur, commande),
 * Projets (lot WBS et taches) et Finance (factures fournisseurs).
 */

export type SubcontractorDocumentKind = "RCCM" | "TAX_CERTIFICATE" | "SOCIAL_CERTIFICATE" | "LIABILITY_INSURANCE" | "DECENNIAL_INSURANCE" | "OTHER";

export interface SubcontractorComplianceItem {
  kind: SubcontractorDocumentKind;
  state: "VALID" | "EXPIRING" | "EXPIRED" | "MISSING";
  validUntil: string | null;
  reference: string | null;
  required: boolean;
}

export interface SubcontractorView {
  id: string;
  supplierId: string;
  supplierCode: string;
  supplierName: string;
  trades: string;
  workforce: number | null;
  status: "PENDING" | "QUALIFIED" | "SUSPENDED";
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  compliance: SubcontractorComplianceItem[];
  compliant: boolean;
  packages: number;
  contractedAmount: string;
  retentionHeld: string;
  currency: string;
  documents?: Array<{ id: string; kind: SubcontractorDocumentKind; reference: string; issuer: string | null; validFrom: string; validUntil: string; fileId: string | null }>;
}

export interface SubcontractStatementView {
  id: string;
  code: string;
  packageId: string;
  packageCode: string;
  supplierName: string;
  number: number;
  periodEnd: string;
  cumulativePercent: string;
  previousPercent: string;
  doneTasks: number;
  totalTasks: number;
  grossAmount: string;
  retentionAmount: string;
  netAmount: string;
  status: "DRAFT" | "APPROVED" | "REJECTED";
  preparedByName: string;
  preparedByUserId: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  supplierInvoiceId: string | null;
  supplierInvoiceCode: string | null;
  supplierInvoiceStatus: string | null;
}

export interface SubcontractRetentionView {
  id: string;
  packageId: string;
  packageCode: string;
  statementCode: string;
  supplierName: string;
  amount: string;
  releaseCondition: string;
  releaseDueDate: string;
  due: boolean;
  status: "HELD" | "RELEASED";
  guaranteeReference: string | null;
  releasedByName: string | null;
  releasedAt: string | null;
  releaseNote: string | null;
  releaseInvoiceId: string | null;
  releaseInvoiceCode: string | null;
}

export interface SubcontractPackageView {
  id: string;
  code: string;
  projectId: string;
  projectCode: string;
  supplierId: string;
  supplierName: string;
  purchaseOrderId: string;
  purchaseOrderCode: string;
  wbsItemId: string;
  wbsCode: string;
  wbsName: string;
  title: string;
  scope: string;
  amount: string;
  retentionRate: string;
  retentionReleaseDays: number;
  status: "ACTIVE" | "COMPLETED" | "TERMINATED";
  /** Avancement actuel derive des taches du lot WBS (non certifie). */
  livePercent: string;
  liveDoneTasks: number;
  liveTotalTasks: number;
  certifiedPercent: string;
  certifiedGross: string;
  retentionHeld: string;
  retentionReleased: string;
  currency: string;
  statements?: SubcontractStatementView[];
  retentions?: SubcontractRetentionView[];
}

export interface SubcontractingSummaryView {
  subcontractors: number;
  qualified: number;
  nonCompliant: number;
  activePackages: number;
  contracted: string;
  certified: string;
  pendingStatements: number;
  retentionHeld: string;
  retentionDue: number;
  currency: string;
}
