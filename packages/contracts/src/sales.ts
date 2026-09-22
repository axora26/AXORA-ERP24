export type QuoteStatus = "DRAFT" | "SUBMITTED" | "ACCEPTED" | "REJECTED";
export type ContractStatus = "ACTIVE" | "ARCHIVED";

export interface QuoteLineView {
  id: string;
  position: number;
  reference: string | null;
  designation: string;
  unitCode: string;
  /** Decimal exact copie immuable de la ligne DQE source, six decimales. */
  quantity: string;
  unitPrice: string;
  lineTotal: string;
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
  lines: QuoteLineView[];
  source: QuoteSourceView;
}

export type QuoteSummaryView = QuoteView;

export interface ContractLineView {
  id: string;
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
  lines: ContractLineView[];
  source: ContractSourceView;
}

export type ContractSummaryView = ContractView;
