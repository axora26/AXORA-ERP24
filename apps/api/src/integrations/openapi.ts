/**
 * Specification OpenAPI 3.1 de l'API publique v1. Tenue a jour a la main et
 * verifiee par test : chaque route du controleur public y est decrite, avec
 * la permission exigee de la cle (`x-axora-permission`).
 */
const page = (item: string) => ({
  type: "object",
  properties: { data: { type: "array", items: { $ref: `#/components/schemas/${item}` } }, nextCursor: { type: ["string", "null"], description: "Identifiant a passer en `cursor` pour la page suivante." } },
});
const listParams = [
  { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
  { name: "cursor", in: "query", schema: { type: "string" }, description: "Pagination : renvoie les elements d'identifiant strictement superieur." },
];
const errors = {
  "401": { description: "Cle absente, invalide, revoquee, expiree ou suspendue." },
  "403": { description: "Permission non accordee a la cle, ou adresse IP non autorisee." },
  "429": { description: "Limite de debit (par minute) ou quota journalier depasse ; voir l'en-tete Retry-After." },
};
const list = (summary: string, permission: string, item: string) => ({
  get: { summary, "x-axora-permission": permission, security: [{ apiKey: [] }], parameters: listParams, responses: { "200": { description: "Page de resultats", content: { "application/json": { schema: page(item) } } }, ...errors } },
});
const money = { type: "string", pattern: "^-?\\d+\\.\\d{2}$" };

export const OPENAPI_SPEC = {
  openapi: "3.1.0",
  info: {
    title: "AXORA-ERP24 — API publique",
    version: "1.0.0",
    description:
      "API REST versionnee. Authentification : `Authorization: Bearer axk_…` (cle d'API emise dans Integrations). Une cle ne porte que des permissions explicites, jamais plus que son createur ; limitation de debit par minute, quota journalier et liste d'IP par cle. Montants en chaines decimales, jamais additionnes entre devises. Perimetre : l'entreprise de la cle.",
  },
  servers: [{ url: "/api/v1" }],
  components: {
    securitySchemes: { apiKey: { type: "http", scheme: "bearer", bearerFormat: "axk_ (cle d'API AXORA)" } },
    schemas: {
      Project: { type: "object", properties: { id: { type: "string" }, code: { type: "string" }, name: { type: "string" }, status: { type: "string" }, currency: { type: "string" }, contractAmount: money, plannedStart: { type: ["string", "null"], format: "date" }, plannedEnd: { type: ["string", "null"], format: "date" } } },
      CustomerInvoice: { type: "object", properties: { id: { type: "string" }, code: { type: "string" }, customerName: { type: "string" }, status: { type: "string" }, issueDate: { type: ["string", "null"], format: "date" }, dueDate: { type: ["string", "null"], format: "date" }, currency: { type: "string" }, total: money, paidAmount: money } },
      SupplierInvoice: { type: "object", properties: { id: { type: "string" }, code: { type: "string" }, supplierReference: { type: "string" }, status: { type: "string" }, matchStatus: { type: "string" }, invoiceDate: { type: "string", format: "date" }, dueDate: { type: "string", format: "date" }, currency: { type: "string" }, total: money, paidAmount: money } },
      PurchaseOrder: { type: "object", properties: { id: { type: "string" }, code: { type: "string" }, supplierName: { type: "string" }, status: { type: "string" }, currency: { type: "string" }, total: money, issuedAt: { type: ["string", "null"], format: "date-time" }, expectedDate: { type: ["string", "null"], format: "date" } } },
      WorkOrder: { type: "object", properties: { id: { type: "string" }, code: { type: "string" }, title: { type: "string" }, type: { type: "string" }, status: { type: "string" }, priority: { type: "string" }, dueDate: { type: "string", format: "date" }, completedAt: { type: ["string", "null"], format: "date-time" }, assetCode: { type: "string" } } },
      LeadInput: { type: "object", required: ["contactName", "companyName"], properties: { contactName: { type: "string", maxLength: 180 }, companyName: { type: "string", maxLength: 180 }, email: { type: "string", maxLength: 180 }, phone: { type: "string", maxLength: 40 }, source: { type: "string", maxLength: 120 } } },
    },
  },
  paths: {
    "/public/me": { get: { summary: "Cle courante : entreprise, permissions effectives et limites", security: [{ apiKey: [] }], "x-axora-permission": null, responses: { "200": { description: "Cle authentifiee" }, ...errors } } },
    "/public/projects": list("Projets de l'entreprise", "projects.project.read", "Project"),
    "/public/customer-invoices": list("Factures clients emises (brouillons exclus)", "finance.invoice.read", "CustomerInvoice"),
    "/public/supplier-invoices": list("Factures fournisseurs", "finance.payable.read", "SupplierInvoice"),
    "/public/purchase-orders": list("Commandes fournisseurs emises (brouillons exclus)", "procurement.order.read", "PurchaseOrder"),
    "/public/work-orders": list("Ordres de travail de maintenance", "assets.asset.read", "WorkOrder"),
    "/public/analytics/{metric}": {
      get: {
        summary: "Serie mensuelle d'un indicateur (exige aussi la permission de lecture du module source)",
        "x-axora-permission": "analytics.report.read",
        security: [{ apiKey: [] }],
        parameters: [{ name: "metric", in: "path", required: true, schema: { type: "string" } }, { name: "months", in: "query", schema: { type: "integer", minimum: 3, maximum: 24, default: 12 } }],
        responses: { "200": { description: "Serie mensuelle" }, "404": { description: "Indicateur inconnu" }, ...errors },
      },
    },
    "/public/crm/leads": {
      post: {
        summary: "Creer un prospect CRM",
        "x-axora-permission": "crm.lead.manage",
        security: [{ apiKey: [] }],
        requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/LeadInput" } } } },
        responses: { "201": { description: "Prospect cree" }, "400": { description: "Donnees invalides" }, ...errors },
      },
    },
    "/public/inbound/{endpointId}": {
      post: {
        summary: "Webhook entrant signe (formulaire web -> prospect CRM)",
        description:
          "Aucune cle d'API : en-tetes `X-Axora-Timestamp` (secondes Unix, tolerance 5 min) et `X-Axora-Signature` = `v1=` + HMAC-SHA256(secret, horodatage + '.' + corps brut). Idempotent par `id` d'evenement. Corps : `{ id, type: 'crm.lead', data: { contactName, companyName, email?, phone?, message? } }`.",
        parameters: [{ name: "endpointId", in: "path", required: true, schema: { type: "string" } }],
        responses: { "201": { description: "Evenement accepte" }, "200": { description: "Doublon : resultat initial renvoye" }, "401": { description: "Signature invalide ou horodatage hors tolerance" }, "404": { description: "Point d'entree inconnu ou desactive" }, "422": { description: "Evenement authentique mais contenu refuse (trace)" } },
      },
    },
  },
} as const;
