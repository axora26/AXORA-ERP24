/**
 * INC-20 — Portails Client & Fournisseur. Identites externes separees ;
 * chaque ressource exposee l'est par une autorisation explicite.
 */

export type PortalPrincipalKind = "CLIENT" | "SUPPLIER";
export type PortalPrincipalStatus = "INVITED" | "ACTIVE" | "SUSPENDED" | "REVOKED";
export type PortalResourceType = "PROJECT" | "CUSTOMER_INVOICE" | "DOCUMENT" | "PURCHASE_ORDER" | "SUPPLIER_INVOICE";

export interface PortalGrantView {
  id: string;
  resourceType: PortalResourceType;
  resourceId: string;
  label: string;
  grantedByName: string;
  grantedAt: string;
  revokedAt: string | null;
}

export interface PortalPrincipalView {
  id: string;
  kind: PortalPrincipalKind;
  email: string;
  fullName: string;
  rootId: string;
  rootName: string;
  status: PortalPrincipalStatus;
  activatedAt: string | null;
  statusReason: string | null;
  activeGrants: number;
  lastLoginAt: string | null;
  pendingInvitation: boolean;
  createdAt: string;
  grants?: PortalGrantView[];
}

/** Invitation : le jeton n'est montre qu'une fois ; seule son empreinte est stockee. */
export interface PortalInvitationIssued {
  principal: PortalPrincipalView;
  token: string;
  activationPath: string;
  expiresAt: string;
}

/** Ressource exposable proposee a l'administrateur (appartient a l'enregistrement racine du principal). */
export interface PortalGrantCandidate {
  resourceType: PortalResourceType;
  resourceId: string;
  label: string;
  granted: boolean;
}

export interface PortalMeView {
  id: string;
  kind: PortalPrincipalKind;
  email: string;
  fullName: string;
  companyName: string;
  rootName: string;
}

export interface PortalProjectView {
  id: string;
  code: string;
  name: string;
  status: string;
  progressPercent: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  milestones: Array<{ name: string; dueDate: string; status: string; achievedAt: string | null }>;
}

export interface PortalCustomerInvoiceView {
  id: string;
  code: string | null;
  projectCode: string | null;
  issueDate: string | null;
  dueDate: string | null;
  total: string;
  paidAmount: string;
  balance: string;
  currency: string;
  status: string;
}

export interface PortalDocumentView {
  id: string;
  code: string;
  title: string;
  category: string;
  revision: string;
  fileName: string;
  contentUrl: string;
}

export interface PortalOrderView {
  id: string;
  code: string;
  status: string;
  issuedAt: string | null;
  expectedDate: string | null;
  total: string;
  currency: string;
  lines: Array<{ description: string; quantity: string; unitCode: string; unitPrice: string; receivedQuantity: string }>;
  acknowledgement: { confirmedDate: string; note: string | null; at: string } | null;
}

export interface PortalSupplierInvoiceView {
  id: string;
  code: string;
  supplierReference: string;
  invoiceDate: string;
  dueDate: string;
  total: string;
  paidAmount: string;
  currency: string;
  status: string;
}

export interface PortalHomeView {
  me: PortalMeView;
  projects: PortalProjectView[];
  customerInvoices: PortalCustomerInvoiceView[];
  documents: PortalDocumentView[];
  orders: PortalOrderView[];
  supplierInvoices: PortalSupplierInvoiceView[];
}
