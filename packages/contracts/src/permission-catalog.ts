import { ALL_PERMISSIONS } from "./permissions.js";

/**
 * Libelles lisibles des permissions, derives de la convention
 * "<module>.<ressource>.<action>". Sert a la matrice des roles : une cle
 * inconnue des dictionnaires reste affichee telle quelle (jamais masquee).
 */
const MODULE_LABELS: Record<string, string> = {
  core: "Administration",
  dashboard: "Vue d'ensemble",
  crm: "CRM",
  estimation: "Études & DQE",
  sales: "Devis & Contrats",
  projects: "Projets",
  procurement: "Achats",
  inventory: "Stock",
  finance: "Finance",
  hr: "Ressources humaines",
  field: "Chantier",
  documents: "GED",
  qhse: "QHSE",
  commissioning: "Commissioning",
  mep: "MEP",
  bim: "BIM",
  assets: "Actifs & GMAO",
  smart: "Smart Building (GTB)",
  building: "Smart Building",
  energy: "Énergie",
  fleet: "Parc",
  subcontracting: "Sous-traitants",
  portal: "Portails",
  workflow: "Workflow",
  ai: "Copilote IA",
  analytics: "Analytique",
  integrations: "API & intégrations",
};

const RESOURCE_LABELS: Record<string, string> = {
  organization: "l'organisation",
  company: "les entreprises",
  user: "les utilisateurs",
  role: "les rôles",
  audit: "le journal d'audit",
  overview: "la vue d'ensemble",
  account: "les comptes",
  contact: "les contacts",
  lead: "les prospects",
  opportunity: "les opportunités",
  activity: "les activités",
  pipeline: "le pipeline",
  study: "les études",
  dqe: "les DQE",
  pricing: "les prix",
  library: "la bibliothèque",
  quote: "les devis",
  contract: "les contrats",
  project: "les projets",
  budget: "les budgets",
  changeorder: "les avenants",
  task: "les tâches",
  supplier: "les fournisseurs",
  request: "les demandes d'achat",
  order: "les commandes",
  receipt: "les réceptions",
  item: "les articles et magasins",
  movement: "les mouvements de stock",
  adjustment: "les ajustements de stock",
  count: "les inventaires",
  invoice: "les factures clients",
  payable: "les factures fournisseurs",
  payment: "les paiements",
  bank: "les banques et caisses",
  settings: "les paramètres",
  employee: "les employés",
  attendance: "les pointages",
  timesheet: "les feuilles de temps",
  leave: "les congés",
  payroll: "la paie",
  document: "les documents",
  file: "les fichiers",
  site: "le chantier",
  log: "les journaux de chantier",
  evidence: "les photos et observations",
  issue: "les réserves",
  inspection: "les inspections QHSE",
  finding: "les non-conformités",
  action: "les actions correctives",
  incident: "les incidents de sécurité",
  permit: "les permis de travail",
  toolbox: "les quarts d'heure sécurité",
  system: "les systèmes et équipements techniques",
  calculation: "les notes de calcul",
  model: "les maquettes BIM",
  clash: "les conflits de synthèse",
  asset: "les équipements exploités",
  ticket: "les demandes d'intervention",
  workorder: "les ordres de travail",
};

const ACTION_LABELS: Record<string, string> = {
  read: "Consulter",
  manage: "Gérer",
  create: "Créer",
  approve: "Approuver",
  validate: "Valider",
  close: "Clôturer",
  pay: "Payer",
  export: "Exporter",
  write: "Écrire",
  execute: "Exécuter",
  issue: "Émettre",
  receive: "Réceptionner",
  post: "Comptabiliser",
  submit: "Soumettre",
  request: "Demander",
  sign: "Signer",
  upload: "Téléverser",
  report: "Déclarer",
  accept: "Réceptionner",
};

export const PERMISSION_LABEL_OVERRIDES: Record<string, string> = {
  "commissioning.activity.read": "Consulter les mises en service",
  "commissioning.activity.manage": "Conduire les essais de mise en service",
  "commissioning.activity.accept": "Réceptionner et remettre les installations",
  "smart.building.read": "Consulter la GTB (points, tendances, alarmes)",
  "smart.building.manage": "Configurer bâtiments, passerelles et points",
  "smart.alarm.acknowledge": "Acquitter les alarmes techniques",
  "smart.setpoint.request": "Demander des consignes (écriture)",
  "smart.gateway.test": "Attester les essais réels de communication",
};

export function registerResourceLabels(labels: Record<string, string>): void {
  Object.assign(RESOURCE_LABELS, labels);
}

export function permissionLabel(key: string): string {
  if (PERMISSION_LABEL_OVERRIDES[key]) return PERMISSION_LABEL_OVERRIDES[key];
  const [, resource, action] = key.split(".");
  if (!resource || !action) return key;
  const actionLabel = ACTION_LABELS[action] ?? action;
  const resourceLabel = RESOURCE_LABELS[resource] ?? resource;
  return `${actionLabel} ${resourceLabel}`;
}

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}

/** Catalogue groupe par module, dans l'ordre de declaration des permissions. */
export function permissionCatalog(): Array<{
  module: string;
  label: string;
  permissions: Array<{ key: string; label: string }>;
}> {
  const groups = new Map<string, Array<{ key: string; label: string }>>();
  for (const key of Object.values(ALL_PERMISSIONS)) {
    const module = key.split(".")[0] ?? key;
    const entries = groups.get(module) ?? [];
    entries.push({ key, label: permissionLabel(key) });
    groups.set(module, entries);
  }
  return [...groups.entries()].map(([module, permissions]) => ({
    module,
    label: moduleLabel(module),
    permissions,
  }));
}

export function isKnownPermission(key: string): boolean {
  return (Object.values(ALL_PERMISSIONS) as string[]).includes(key);
}
