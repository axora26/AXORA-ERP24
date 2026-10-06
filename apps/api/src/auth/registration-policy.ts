/**
 * Politique de creation d'organisations (REGISTRATION_MODE).
 *
 * - `open` (defaut, comportement historique) : toute personne peut creer son espace ;
 * - `first-organization` : seule la toute premiere organisation peut etre creee
 *   (installation d'une instance privee), ensuite l'administrateur ajoute les
 *   utilisateurs depuis l'administration ;
 * - `closed` : aucune creation publique.
 *
 * Une valeur inconnue ferme l'inscription : une faute de frappe dans la
 * configuration ne doit jamais ouvrir une instance privee au public.
 */
export type RegistrationMode = "open" | "first-organization" | "closed";

export function registrationMode(env: NodeJS.ProcessEnv = process.env): RegistrationMode {
  const raw = (env.REGISTRATION_MODE ?? "").trim().toLowerCase();
  if (raw === "" || raw === "open") return "open";
  if (raw === "first-organization") return "first-organization";
  return "closed";
}

export function registrationAllowed(mode: RegistrationMode, existingOrganizations: number): boolean {
  if (mode === "open") return true;
  if (mode === "first-organization") return existingOrganizations === 0;
  return false;
}
