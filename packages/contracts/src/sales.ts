export type QuoteStatus = "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
export type ContractStatus = "ACTIVE" | "ARCHIVED";
export type ContractVariationStatus =
  "DRAFT" | "SUBMITTED" | "APPROVED" | "REJECTED";

export interface QuoteLineView {
  id: string;
  lotId?: string | null;
  position: number;
  reference: string | null;
  designation: string;
  unitCode: string;
  /** Decimal exact copie immuable de la ligne DQE source, six decimales. */
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface CommercialDocumentLotView {
  id: string;
  position: number;
  code: string;
  designation: string;
  lineCount: number;
  subtotal: string;
}

export interface QuoteSourceView {
  dqeId: string;
  dqeCode: string;
}

/** La route de liste renvoie le meme contrat complet que la route de detail. */
export interface QuoteView {
  id: string;
  companyId: string;
  opportunityId: string;
  code: string;
  title: string;
  currency: string;
  version: number;
  status: QuoteStatus;
  subtotal: string;
  submittedAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
  lots?: CommercialDocumentLotView[];
  lines: QuoteLineView[];
  source: QuoteSourceView;
}

export type QuoteSummaryView = QuoteView;

export interface ContractLineView {
  id: string;
  lotId?: string | null;
  position: number;
  reference: string | null;
  designation: string;
  unitCode: string;
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface ContractSourceView {
  quoteId: string;
  quoteCode: string;
}

/** La route de liste renvoie le meme contrat complet que la route de detail. */
export interface ContractView {
  id: string;
  companyId: string;
  opportunityId: string;
  code: string;
  title: string;
  currency: string;
  status: ContractStatus;
  subtotal: string;
  createdAt: string;
  lots?: CommercialDocumentLotView[];
  lines: ContractLineView[];
  source: ContractSourceView;
}

export type ContractSummaryView = ContractView;

/** Projection minimale permettant de sélectionner le contrat parent d'un avenant. */
export interface ContractVariationParentView {
  id: string;
  companyId: string;
  code: string;
  title: string;
  currency: string;
  status: ContractStatus;
  subtotal: string;
  createdAt: string;
}

export interface ContractVariationLineView {
  id: string;
  sourceContractLotId: string | null;
  position: number;
  reference: string | null;
  designation: string;
  unitCode: string;
  /** Une quantité négative représente une moins-value contractuelle. */
  quantity: string;
  unitPrice: string;
  lineTotal: string;
}

export interface ContractVariationView {
  id: string;
  companyId: string;
  contractId: string;
  revisionNumber: number;
  code: string;
  title: string;
  reason: string;
  currency: string;
  amountDelta: string;
  /** Montant du contrat incluant les avenants approuvés et, pour cette fiche, l'avenant courant s'il est encore à décider. */
  revisedContractAmount: string;
  status: ContractVariationStatus;
  version: number;
  submittedAt: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  lines: ContractVariationLineView[];
}
