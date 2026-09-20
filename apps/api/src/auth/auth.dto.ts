/**
 * DTO de login — validation stricte, rejet des proprietes inconnues.
 */
export class LoginDto {
  email!: string;
  password!: string;
}

/**
 * DTO de bootstrap d'organisation (INC-01) : cree l'organisation, l'entreprise
 * par defaut, le premier utilisateur (role OWNER avec toutes les permissions
 * Core) et ouvre une session. Reserve a la creation initiale d'un tenant.
 */
export class RegisterOrganizationDto {
  organizationName!: string;
  organizationSlug!: string;
  companyName!: string;
  ownerEmail!: string;
  ownerPassword!: string;
  ownerFullName!: string;
}
