import { SetMetadata } from "@nestjs/common";

export const PERMISSION_KEY = "axora:required-permission";

/**
 * Decorateur declaratif de permission — evalue par PermissionGuard.
 * Reference : docs/foundation/03-security.md.
 */
export const RequirePermission = (permissionKey: string) =>
  SetMetadata(PERMISSION_KEY, permissionKey);
