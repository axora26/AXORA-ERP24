import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "axora:required-permission";

/**
 * Decorateur declaratif de permission — evalue par PermissionGuard.
 * Reference : docs/foundation/03-security.md.
 */
export const RequirePermission = (permissionKey: string) =>
  SetMetadata(PERMISSION_KEY, [permissionKey]);

/**
 * Variante "l'une des permissions" : pour une ressource transverse (ex. un
 * fichier) lisible depuis plusieurs modules. Toujours au moins une cle.
 */
export const RequireAnyPermission = (first: string, ...others: string[]) =>
  SetMetadata(PERMISSION_KEY, [first, ...others]);
