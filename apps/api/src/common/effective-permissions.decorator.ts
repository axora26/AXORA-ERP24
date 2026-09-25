import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";

/**
 * Permissions effectives de la session, telles que resolues par la garde RBAC
 * pour CETTE requete (jamais transmises par le client). Sert aux services qui
 * filtrent eux-memes par permission (copilote, analytique).
 */
export const EffectivePermissions = createParamDecorator((_data: unknown, context: ExecutionContext): Set<string> => {
  return context.switchToHttp().getRequest<Request>().axoraPermissions ?? new Set<string>();
});
