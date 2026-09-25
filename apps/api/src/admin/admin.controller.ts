import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { CORE_PERMISSIONS } from "@axora24/contracts";
import { SessionGuard } from "../auth/session.guard.js";
import { PermissionGuard } from "../auth/permission.guard.js";
import { RequirePermission } from "../auth/require-permission.decorator.js";
import { AdminService } from "./admin.service.js";

/**
 * Administration de l'organisation — perimetre ORGANISATION (pas entreprise) :
 * l'organisation est toujours celle de la session, jamais un parametre client.
 * Aucune route UPDATE/DELETE n'existe sur le journal d'audit (append-only).
 */
@Controller("admin")
@UseGuards(SessionGuard, PermissionGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("permissions")
  @RequirePermission(CORE_PERMISSIONS.ROLE_MANAGE)
  permissions() {
    return this.admin.permissions();
  }

  @Get("users")
  @RequirePermission(CORE_PERMISSIONS.USER_MANAGE)
  listUsers(@Req() request: Request) {
    return this.admin.listUsers(request.axoraUser!);
  }

  @Post("users")
  @RequirePermission(CORE_PERMISSIONS.USER_MANAGE)
  createUser(@Req() request: Request, @Body() body: unknown) {
    return this.admin.createUser(request.axoraUser!, body);
  }

  @Patch("users/:id")
  @RequirePermission(CORE_PERMISSIONS.USER_MANAGE)
  updateUser(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    return this.admin.updateUser(request.axoraUser!, id, body);
  }

  @Get("roles")
  @RequirePermission(CORE_PERMISSIONS.ROLE_MANAGE)
  listRoles(@Req() request: Request) {
    return this.admin.listRoles(request.axoraUser!);
  }

  @Post("roles")
  @RequirePermission(CORE_PERMISSIONS.ROLE_MANAGE)
  createRole(@Req() request: Request, @Body() body: unknown) {
    return this.admin.createRole(request.axoraUser!, body);
  }

  @Put("roles/:id/permissions")
  @RequirePermission(CORE_PERMISSIONS.ROLE_MANAGE)
  setRolePermissions(@Req() request: Request, @Param("id") id: string, @Body() body: unknown) {
    return this.admin.setRolePermissions(request.axoraUser!, id, body);
  }

  @Delete("roles/:id")
  @RequirePermission(CORE_PERMISSIONS.ROLE_MANAGE)
  deleteRole(@Req() request: Request, @Param("id") id: string) {
    return this.admin.deleteRole(request.axoraUser!, id);
  }

  @Get("companies")
  @RequirePermission(CORE_PERMISSIONS.COMPANY_MANAGE)
  listCompanies(@Req() request: Request) {
    return this.admin.listCompanies(request.axoraUser!);
  }

  @Post("companies")
  @RequirePermission(CORE_PERMISSIONS.COMPANY_MANAGE)
  createCompany(@Req() request: Request, @Body() body: unknown) {
    return this.admin.createCompany(request.axoraUser!, body);
  }

  @Get("audit")
  @RequirePermission(CORE_PERMISSIONS.AUDIT_READ)
  listAudit(@Req() request: Request, @Query() query: Record<string, unknown>) {
    return this.admin.listAudit(request.axoraUser!, query);
  }
}
