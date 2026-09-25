/**
 * Libelles lisibles des actions du journal d'audit. Une action inconnue est
 * affichee telle quelle (jamais masquee).
 */
const LABELS: Record<string, string> = {
  "organization.bootstrap": "Organisation créée",
  "auth.login.succeeded": "Connexion",
  "auth.logout.succeeded": "Déconnexion",
  "crm.lead.created": "Prospect créé",
  "crm.lead.converted": "Prospect converti en opportunité",
  "crm.opportunity.stage_changed": "Opportunité déplacée dans le pipeline",
  "estimation.study.created": "Étude créée",
  "estimation.study.ready": "Étude prête pour chiffrage",
  "estimation.dqe.created": "DQE créé",
  "estimation.dqe.finalized": "DQE finalisé",
  "sales.quote.created": "Devis créé",
  "sales.quote.submitted": "Devis soumis",
  "sales.quote.accepted": "Devis accepté",
  "sales.quote.rejected": "Devis rejeté",
  "sales.contract.created": "Contrat créé",
  "auth.password.changed": "Mot de passe modifié",
  "auth.mfa.enabled": "Double authentification activée",
  "auth.mfa.disabled": "Double authentification désactivée",
  "auth.mfa.failed": "Code MFA invalide",
  "auth.login.failed": "Échec de connexion",
  "core.user.created": "Utilisateur créé",
  "core.user.updated": "Utilisateur modifié",
  "core.role.created": "Rôle créé",
  "core.role.permissions_changed": "Permissions d'un rôle modifiées",
  "core.role.deleted": "Rôle supprimé",
  "core.company.created": "Entreprise créée",
};

export function describeAudit(action: string): string {
  return LABELS[action] ?? action;
}

export function registerAuditLabels(labels: Record<string, string>): void {
  Object.assign(LABELS, labels);
}
