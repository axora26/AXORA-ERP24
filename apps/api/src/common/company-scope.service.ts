import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../core/prisma.service.js";
import type { AuthenticatedUser } from "../auth/session.guard.js";

export interface CompanyScope {
  organizationId: string;
  companyId: string;
  /** Projet resolu depuis la requete et verifie dans la meme entreprise. */
  projectId?: string;
}

/**
 * Resolution du perimetre entreprise pour les modules metier (INC-02+).
 *
 * INVARIANT NON NEGOCIABLE (docs/foundation/03-security.md, prolonge par
 * docs/DECISIONS.md ADR-0004) : un companyId transmis par le client n'est
 * JAMAIS une preuve d'autorisation. Il est systematiquement reverifie contre
 * les CompanyMembership de l'utilisateur de la SESSION, et l'entreprise doit
 * appartenir a l'organisation de cette session.
 *
 * Consequence : il n'existe aucun chemin de code permettant de lire ou
 * d'ecrire les donnees CRM d'une autre entreprise, meme en forgeant un
 * identifiant valide appartenant a un autre tenant.
 */
@Injectable()
export class CompanyScopeService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(user: AuthenticatedUser, requestedCompanyId?: string, requestedProjectId?: string): Promise<CompanyScope> {
    const memberships = await this.prisma.companyMembership.findMany({
      where: {
        userId: user.id,
        company: { organizationId: user.organizationId },
      },
      select: { companyId: true },
      orderBy: { createdAt: "asc" },
    });

    if (memberships.length === 0) {
      throw new ForbiddenException("User is not a member of any company");
    }

    const allowed = new Set(memberships.map((membership) => membership.companyId));

    if (requestedCompanyId !== undefined && requestedCompanyId !== "") {
      if (!allowed.has(requestedCompanyId)) {
        // Meme message qu'une entreprise inexistante : ne pas divulguer
        // l'existence d'une entreprise appartenant a un autre tenant.
        throw new ForbiddenException("Company not accessible");
      }
      return this.withProject(user.organizationId, requestedCompanyId, requestedProjectId);
    }

    if (memberships.length > 1) {
      throw new BadRequestException(
        "companyId is required: this user belongs to several companies",
      );
    }

    return this.withProject(user.organizationId, memberships[0]!.companyId, requestedProjectId);
  }

  private async withProject(organizationId: string, companyId: string, requestedProjectId?: string): Promise<CompanyScope> {
    if (requestedProjectId === undefined || requestedProjectId === "") {
      return { organizationId, companyId };
    }

    const project = await this.prisma.project.findFirst({
      where: { id: requestedProjectId, organizationId, companyId },
      select: { id: true },
    });
    if (!project) {
      // Meme message generique que pour une entreprise inaccessible : ne pas
      // divulguer l'existence d'un chantier d'un autre perimetre.
      throw new ForbiddenException("Project not accessible");
    }
    return { organizationId, companyId, projectId: project.id };
  }
}
