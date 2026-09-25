/**
 * INC-23 — API publique & integrations (BC-24). Toute integration externe non
 * testee reellement est etiquetee NOT_TESTED — jamais presentee comme
 * fonctionnelle.
 */

/** Seules permissions attribuables a une cle d'API (catalogue de l'API publique v1). */
export const PUBLIC_API_PERMISSIONS = [
  "projects.project.read",
  "finance.invoice.read",
  "finance.payable.read",
  "procurement.order.read",
  "assets.asset.read",
  "analytics.report.read",
  "crm.lead.manage",
] as const;

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  permissions: string[];
  rateLimitPerMinute: number;
  dailyQuota: number;
  allowedIps: string[];
  expiresAt: string | null;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  revokedAt: string | null;
  revokeReason: string | null;
  lastUsedAt: string | null;
  usageToday: number;
  createdByName: string;
  createdAt: string;
}

/** Le secret n'est montre qu'une fois ; seule son empreinte SHA-256 est conservee. */
export interface ApiKeyIssued {
  key: ApiKeyView;
  secret: string;
}

export interface ApiRequestLogView {
  id: string;
  method: string;
  path: string;
  status: number;
  ip: string | null;
  durationMs: number;
  at: string;
}

export interface InboundEndpointView {
  id: string;
  name: string;
  kind: "CRM_LEAD";
  active: boolean;
  path: string;
  accepted: number;
  rejected: number;
  lastReceivedAt: string | null;
  createdByName: string;
  createdAt: string;
}

export interface InboundEndpointIssued {
  endpoint: InboundEndpointView;
  secret: string;
}

export interface InboundEventView {
  id: string;
  externalId: string;
  status: "ACCEPTED" | "REJECTED";
  error: string | null;
  resourceType: string | null;
  resourceId: string | null;
  receivedAt: string;
}

/**
 * Grille de verite par connecteur (docs/foundation/03-security.md §11) :
 * supporte, implemente, systeme externe reellement accessible, lecture
 * testee, ecriture testee. `status` = TESTED seulement si aucun systeme
 * externe n'est en jeu ou s'il a ete reellement atteint.
 */
export interface ConnectorEntry {
  key: string;
  name: string;
  category: "API" | "Webhook" | "Fichier" | "GTB" | "Messagerie" | "Stockage" | "IA" | "Finance";
  supported: boolean;
  implemented: boolean;
  /** null : sans objet (aucun systeme externe). */
  externalReached: boolean | null;
  readTested: boolean | null;
  writeTested: boolean | null;
  status: "TESTED" | "NOT_TESTED" | "NOT_IMPLEMENTED";
  evidence: string;
}

export const CONNECTORS: ConnectorEntry[] = [
  { key: "public-api", name: "API REST publique v1 (clés d'API)", category: "API", supported: true, implemented: true, externalReached: null, readTested: true, writeTested: true, status: "TESTED", evidence: "Tests e2e : authentification par clé, permissions explicites, limitation de débit, quotas, liste d'IP, pagination, création de prospect." },
  { key: "webhook-in-crm", name: "Webhook entrant → prospect CRM", category: "Webhook", supported: true, implemented: true, externalReached: false, readTested: null, writeTested: true, status: "NOT_TESTED", evidence: "Signature, anti-rejeu, idempotence et création testées en e2e avec des requêtes HTTP réelles ; aucun émetteur tiers réel (formulaire web, CRM externe) n'a été raccordé." },
  { key: "webhook-out", name: "Webhooks sortants signés (workflows)", category: "Webhook", supported: true, implemented: true, externalReached: false, readTested: null, writeTested: true, status: "NOT_TESTED", evidence: "Livraison et signature HMAC vérifiées contre un récepteur HTTP local (e2e et démo) ; jamais contre un service externe réel." },
  { key: "ifc-import", name: "Import de maquettes IFC", category: "Fichier", supported: true, implemented: true, externalReached: null, readTested: true, writeTested: false, status: "TESTED", evidence: "Fichiers réels buildingSMART IFC2X3, IFC4 et IFC4X3 lus en test ; export IFC non développé." },
  { key: "energy-csv", name: "Import CSV d'intervalles d'énergie", category: "Fichier", supported: true, implemented: true, externalReached: null, readTested: true, writeTested: null, status: "TESTED", evidence: "Import idempotent testé en e2e et dans le navigateur." },
  { key: "revit", name: "Revit (RVT natif)", category: "Fichier", supported: false, implemented: false, externalReached: false, readTested: false, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Non développé : passer par un export IFC depuis Revit." },
  { key: "bms-gateway", name: "Passerelle GTB (API d'ingestion HTTP)", category: "GTB", supported: true, implemented: true, externalReached: false, readTested: true, writeTested: true, status: "NOT_TESTED", evidence: "Ingestion et consignes testées en e2e avec un client HTTP ; aucune passerelle physique raccordée." },
  { key: "bacnet", name: "BACnet/IP", category: "GTB", supported: false, implemented: false, externalReached: false, readTested: false, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Pilote natif non développé ; aucun équipement disponible." },
  { key: "modbus", name: "Modbus TCP", category: "GTB", supported: false, implemented: false, externalReached: false, readTested: false, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Pilote natif non développé ; aucun équipement disponible." },
  { key: "knx", name: "KNXnet/IP", category: "GTB", supported: false, implemented: false, externalReached: false, readTested: false, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Pilote natif non développé ; aucun équipement disponible." },
  { key: "mqtt", name: "Client MQTT", category: "GTB", supported: false, implemented: false, externalReached: false, readTested: false, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Pilote natif non développé ; aucun courtier disponible." },
  { key: "smtp", name: "E-mail (SMTP)", category: "Messagerie", supported: false, implemented: false, externalReached: false, readTested: null, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Aucun serveur SMTP configuré : notifications dans l'application uniquement." },
  { key: "sms-push", name: "SMS / notifications push", category: "Messagerie", supported: false, implemented: false, externalReached: false, readTested: null, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Aucun fournisseur configuré." },
  { key: "s3", name: "Stockage objet S3", category: "Stockage", supported: false, implemented: false, externalReached: false, readTested: false, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Pilote livré : système de fichiers local uniquement." },
  { key: "llm", name: "Modèle de langage (reformulation du copilote)", category: "IA", supported: false, implemented: false, externalReached: false, readTested: null, writeTested: null, status: "NOT_IMPLEMENTED", evidence: "Aucun fournisseur ni clé configurés : le copilote est déterministe (modelProvider = null)." },
  { key: "bank", name: "Banque / mobile money (relevés, paiements)", category: "Finance", supported: false, implemented: false, externalReached: false, readTested: false, writeTested: false, status: "NOT_IMPLEMENTED", evidence: "Aucune connexion bancaire : paiements saisis dans l'application." },
];
