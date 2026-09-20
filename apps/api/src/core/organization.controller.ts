import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { OrganizationService } from "./organization.service.js";
import { SessionGuard } from "../auth/session.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { CORE_PERMISSIONS } from "@axora24/contracts";

/**
 * Securise par SessionGuard + PermissionGuard (docs/foundation/03-security.md).
 * INVARIANT : ne retourne QUE l'organisation de l'utilisateur authentifie
 * (request.axoraUser.organizationId), jamais une liste globale cross-tenant.
 * La creation d'organisation passe exclusivement par POST /auth/register-organization
 * (bootstrap transactionnel) — pas de route de creation libre ici.
 * Statut module : IMPLEMENTED_NOT_VERIFIED — isolation tenant testee manuellement
 * (2 organisations, verification croisee), tests automatises a ajouter avant VERIFIED.
 */
@Controller("organizations")
@UseGuards(SessionGuard, PermissionGuard)
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get("me")
  @RequirePermission(CORE_PERMISSIONS.ORG_MANAGE)
  async getOwn(@Req() request: Request) {
    const organizationId = request.axoraUser!.organizationId;
    return this.organizationService.getOwn(organizationId);
  }
}
