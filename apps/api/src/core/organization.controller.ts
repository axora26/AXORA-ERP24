import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { OrganizationService } from "./organization.service.js";

/**
 * NOTE SECURITE (docs/foundation/03-security.md) : ce controller n'a PAS
 * encore de guard RBAC brancher — il ne doit pas etre expose sur un
 * environnement partage tant que l'authentification (session + guard de
 * permission) n'est pas ajoutee. Statut module : FOUNDATION.
 */
@Controller("organizations")
export class OrganizationController {
  constructor(private readonly organizationService: OrganizationService) {}

  @Get()
  async list() {
    return this.organizationService.list();
  }

  @Get(":slug")
  async findBySlug(@Param("slug") slug: string) {
    return this.organizationService.findBySlug(slug);
  }

  @Post()
  async create(@Body() body: { name: string; slug: string; isDemo?: boolean }) {
    return this.organizationService.create(body);
  }
}
