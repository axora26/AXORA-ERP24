import type { LucideIcon } from "lucide-react";
import {
  Building2,
  Calculator,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  Receipt,
  ScrollText,
  ShoppingCart,
  ShieldCheck,
  UserCog,
  UsersRound,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Permission de lecture requise : l'entree est masquee sinon (le serveur refuse de toute facon). */
  permission?: string;
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
    label: "Pilotage",
    items: [{ href: "/", label: "Vue d'ensemble", icon: LayoutDashboard, keywords: "dashboard accueil command center" }],
  },
  {
    label: "Commercial",
    items: [
      { href: "/crm", label: "CRM & Pipeline", icon: UsersRound, permission: "crm.opportunity.read", keywords: "prospects leads opportunites clients" },
      { href: "/estimation", label: "Études & DQE", icon: Calculator, permission: "estimation.dqe.read", keywords: "bpu boq chiffrage estimation" },
      { href: "/sales", label: "Devis & Contrats", icon: Receipt, permission: "sales.quote.read", keywords: "offres contrats ventes" },
    ],
  },
  {
    label: "Projets & chantiers",
    items: [
      { href: "/projects", label: "Projets", icon: FolderKanban, permission: "projects.project.read", keywords: "wbs budget planning gantt avenants affaires" },
    ],
  },
  {
    label: "Supply chain",
    items: [
      { href: "/procurement", label: "Achats", icon: ShoppingCart, permission: "procurement.request.read", keywords: "demandes commandes fournisseurs receptions" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/users", label: "Utilisateurs", icon: UserCog, permission: "core.user.manage", keywords: "comptes acces" },
      { href: "/admin/roles", label: "Rôles & permissions", icon: ShieldCheck, permission: "core.role.manage", keywords: "rbac droits matrice" },
      { href: "/admin/companies", label: "Entreprises", icon: Building2, permission: "core.company.manage", keywords: "filiales societes" },
      { href: "/admin/audit", label: "Journal d'audit", icon: ScrollText, permission: "core.audit.read", keywords: "traces historique" },
      { href: "/account", label: "Mon compte", icon: KeyRound, keywords: "mot de passe mfa securite profil" },
    ],
  },
];

export function visibleGroups(can: (permission: string) => boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || can(item.permission)),
  })).filter((group) => group.items.length > 0);
}

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
