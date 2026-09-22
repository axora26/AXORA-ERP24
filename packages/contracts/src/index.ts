/**
 * @axora24/contracts — types et cles de permission partages entre apps/api et apps/web.
 *
 * IMPORTANT : ce paquet ne contient AUCUNE logique metier, uniquement des
 * contrats stables (types, DTO, enums, cles de permission). Toute logique
 * appartient a packages/security ou aux modules de apps/api.
 */

export * from "./tenancy.js";
export * from "./permissions.js";
export * from "./module-status.js";
export * from "./http.js";
export * from "./crm.js";
export * from "./estimation.js";
export * from "./sales.js";
