import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Box,
  Boxes,
  Building2,
  Cable,
  Calculator,
  CalendarRange,
  ChartColumn,
  ChartNoAxesCombined,
  Cpu,
  FileStack,
  FolderKanban,
  Globe2,
  Handshake,
  HardHat,
  IdCard,
  KeyRound,
  Landmark,
  LayoutDashboard,
  PlugZap,
  RadioTower,
  Receipt,
  ScrollText,
  ShieldCheck,
  ShieldPlus,
  ShoppingCart,
  Truck,
  UserCog,
  UsersRound,
  Workflow,
  Wrench,
  Zap,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Permission(s) de lecture requise(s), l'une suffit : l'entree est masquee sinon (le serveur refuse de toute facon). */
  permission?: string | string[];
  /** Mots-cles additionnels pour la palette de commandes (Ctrl K). */
  keywords?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navigation : seuls les modules REELLEMENT livres y figurent. Un module
 * n'apparait ici qu'une fois son API, sa base et ses tests en place — jamais
 * un ecran vide laissant croire qu'il existe deja.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Accueil",
    items: [
      { href: "/", label: "Vue d'ensemble", icon: LayoutDashboard, keywords: "dashboard accueil command center" },
    ],
  },
  {
    label: "Commercial",
    items: [
      { href: "/crm", label: "CRM & Pipeline", icon: UsersRound, permission: ["crm.opportunity.read", "crm.lead.read", "crm.account.read", "crm.contact.read", "crm.activity.read"], keywords: "prospects leads opportunites clients comptes contacts activites" },
      { href: "/estimation", label: "Études & DQE", icon: Calculator, permission: "estimation.dqe.read", keywords: "bpu boq chiffrage estimation" },
      { href: "/sales", label: "Devis & Contrats", icon: Receipt, permission: "sales.quote.read", keywords: "offres contrats ventes" },
    ],
  },
  {
    label: "Chantiers",
    items: [
      { href: "/projects", label: "Projets", icon: FolderKanban, permission: "projects.project.read", keywords: "wbs budget planning gantt avenants affaires" },
      { href: "/projects/forecasts", label: "Prévisions EAC", icon: ChartNoAxesCombined, permission: "projects.forecast.read", keywords: "eac coût budget marge" },
      { href: "/projects/resources", label: "Ressources projet", icon: CalendarRange, permission: "projects.resource.read", keywords: "équipes matériel capacité planning" },
      { href: "/field", label: "Chantier", icon: HardHat, permission: "field.site.read", keywords: "journal reserves photos terrain hors ligne punch list" },
      { href: "/qhse", label: "QHSE", icon: ShieldPlus, permission: "qhse.inspection.read", keywords: "securite qualite environnement ncr non-conformite incident accident permis feu inspection" },
      { href: "/documents", label: "Documents (GED)", icon: FileStack, permission: "documents.document.read", keywords: "ged plans visa revisions indices fichiers" },
      { href: "/subcontracting", label: "Sous-traitance", icon: Handshake, permission: "subcontracting.package.read", keywords: "sous-traitants lots situations retenue de garantie vigilance" },
    ],
  },
  {
    label: "Achats & stock",
    items: [
      { href: "/procurement", label: "Achats", icon: ShoppingCart, permission: "procurement.request.read", keywords: "demandes commandes fournisseurs receptions" },
      { href: "/inventory", label: "Stock & logistique", icon: Boxes, permission: "inventory.item.read", keywords: "articles magasins inventaire sorties transferts" },
      { href: "/inventory/reservations", label: "Réservations de stock", icon: Boxes, permission: "inventory.item.read", keywords: "réservations allocations matériel chantier libre" },
    ],
  },
  {
    label: "Finance & comptabilité",
    items: [
      { href: "/finance", label: "Finance & trésorerie", icon: Landmark, permission: ["finance.invoice.read", "finance.payable.read", "finance.credit.read"], keywords: "factures paiements banques encaissements creances dettes avoirs remboursements" },
    ],
  },
  {
    label: "Personnel",
    items: [
      { href: "/hr", label: "RH & temps", icon: IdCard, permission: "hr.employee.read", keywords: "employes pointage presence feuilles de temps conges paie badge" },
      { href: "/hr/advances", label: "Avances salariés", icon: Receipt, permission: ["hr.advance.read", "hr.advance.request"], keywords: "avance salaire acompte remboursement retenue paie" },
      { href: "/hr/payroll-policy", label: "Règles de paie", icon: Calculator, permission: ["hr.payroll.read", "hr.payrollpolicy.manage"], keywords: "politique heures mensuelles majoration preparation calcul brut" },
    ],
  },
  {
    label: "Ingénierie & exploitation",
    items: [
      { href: "/mep", label: "MEP & calculs", icon: Cpu, permission: "mep.system.read", keywords: "cvc electricite plomberie incendie equipements notes de calcul" },
      { href: "/bim", label: "BIM / IFC", icon: Box, permission: "bim.model.read", keywords: "maquette ifc revit clash synthese globalid" },
      { href: "/commissioning", label: "Mise en service", icon: PlugZap, permission: "commissioning.activity.read", keywords: "commissioning essais retest reception doe" },
      { href: "/assets", label: "Actifs & GMAO", icon: Wrench, permission: "assets.asset.read", keywords: "maintenance preventif correctif ordres de travail tickets mtbf mttr" },
      { href: "/smart", label: "Smart Building", icon: RadioTower, permission: "smart.building.read", keywords: "gtb bms bacnet modbus knx mqtt iot telemetrie alarmes consignes capteurs" },
      { href: "/energy", label: "Énergie", icon: Zap, permission: "energy.meter.read", keywords: "compteurs consommation photovoltaique groupe electrogene batterie autonomie tarifs kwh" },
      { href: "/fleet", label: "Parc véhicules & engins", icon: Truck, permission: "fleet.vehicle.read", keywords: "flotte vehicules engins chauffeurs affectation carburant assurance kilometrage" },
    ],
  },
  {
    label: "Pilotage",
    items: [
      { href: "/analytics", label: "Analyses & BI", icon: ChartColumn, permission: "analytics.report.read", keywords: "bi reporting tendances indicateurs kpi export csv instantanes tableaux de bord" },
      { href: "/copilot", label: "Copilote", icon: Bot, permission: "ai.copilot.use", keywords: "ia assistant question synthese intelligence artificielle" },
      { href: "/workflow", label: "Workflows & approbations", icon: Workflow, permission: ["workflow.definition.read", "workflow.approval.decide"], keywords: "automatisation regles approbation validation escalade notifications webhook" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Utilisateurs", icon: UserCog, permission: "core.user.manage", keywords: "comptes acces" },
      { href: "/admin/roles", label: "Rôles & permissions", icon: ShieldCheck, permission: "core.role.manage", keywords: "rbac droits matrice" },
      { href: "/admin/companies", label: "Entreprises", icon: Building2, permission: "core.company.manage", keywords: "filiales societes" },
      { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText, permission: "core.audit.read", keywords: "traces historique" },
      { href: "/integrations", label: "API & intégrations", icon: Cable, permission: "integrations.apikey.read", keywords: "api cle token webhook connecteurs openapi integration" },
      { href: "/portal-admin", label: "Portails externes", icon: Globe2, permission: "portal.principal.read", keywords: "portail client fournisseur invitation acces externe" },
      { href: "/account", label: "Mon compte", icon: KeyRound, keywords: "mot de passe mfa securite profil" },
    ],
  },
];

export function visibleGroups(can: (permission: string) => boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || (Array.isArray(item.permission) ? item.permission.some(can) : can(item.permission))),
  })).filter((group) => group.items.length > 0);
}

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (!(pathname === href || pathname.startsWith(`${href}/`))) return false;
  return !NAV_GROUPS.some(group => group.items.some(item => item.href !== href && item.href.startsWith(`${href}/`) && (pathname === item.href || pathname.startsWith(`${item.href}/`))));
}

export function navGroupId(label: string): string {
  return label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function activeNavigation(pathname: string): { group: NavGroup; item: NavItem } | null {
  for (const group of NAV_GROUPS) {
    const item = group.items.find((candidate) => isActive(pathname, candidate.href));
    if (item) return { group, item };
  }
  return null;
}
