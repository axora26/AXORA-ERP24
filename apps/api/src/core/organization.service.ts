import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "./prisma.service.js";

/**
 * INVARIANT NON NEGOCIABLE (docs/foundation/02-domain-model.md,
 * docs/foundation/03-security.md) : Organization est la racine du tenant.
 * Un utilisateur ne doit JAMAIS pouvoir lire ou lister une organisation
 * autre que la sienne — il n'existe pas de role "super-admin cross-tenant"
 * dans ce module. Toute methode ici prend organizationId en parametre et
 * l'utilise comme filtre serveur, jamais deduit d'une valeur cliente libre.
 */
@Injectable()
export class OrganizationService {
  constructor(private readonly prisma: PrismaService) {}

  /** Retourne UNIQUEMENT l'organisation de l'appelant (jamais une liste globale). */
  async getOwn(organizationId: string) {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization) {
      throw new NotFoundException("Organization not found");
    }
    return organization;
  }
}
