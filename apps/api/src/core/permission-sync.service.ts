import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ALL_PERMISSIONS } from "@axora24/contracts";
import { PrismaService } from "./prisma.service.js";

const OWNER_ROLE_NAME = "OWNER";

/**
 * Synchronisation des permissions au demarrage (Core / RBAC).
 *
 * PROBLEME RESOLU : le bootstrap d'organisation donne au role systeme OWNER
 * toutes les permissions connues AU MOMENT de sa creation. Chaque nouvel
 * increment ajoute des cles (INC-02 a ajoute les 11 cles CRM). Sans cette
 * synchronisation, les tenants deja crees se voyaient refuser (403) l'acces
 * a tout nouveau module, sans aucun message exploitable.
 *
 * PERIMETRE STRICTEMENT LIMITE (docs/foundation/03-security.md) :
 * - seuls les roles `isSystem = true` nommes OWNER sont completes ; aucun
 *   role personnalise par un tenant n'est jamais modifie ;
 * - l'operation n'AJOUTE que des grants manquants : elle ne retire rien et
 *   ne cree aucun role ;
 * - elle est idempotente et sans course (upsert + skipDuplicates), donc sure
 *   si plusieurs instances demarrent simultanement.
 *
 * Le deny-by-default reste entier : une cle absente de ALL_PERMISSIONS n'est
 * jamais accordee, et les roles non systeme restent exactement ce que le
 * tenant en a fait.
 */
@Injectable()
export class PermissionSyncService implements OnModuleInit {
  private readonly logger = new Logger(PermissionSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const granted = await this.sync();
    if (granted > 0) {
      this.logger.log(`Permissions systeme synchronisees : ${granted} grant(s) ajoute(s) au role ${OWNER_ROLE_NAME}`);
    }
  }

  /** Retourne le nombre de grants reellement ajoutes. */
  async sync(): Promise<number> {
    const permissionKeys = Object.values(ALL_PERMISSIONS);

    for (const key of permissionKeys) {
      await this.prisma.permission.upsert({
        where: { key },
        update: {},
        create: { key, description: `Permission systeme: ${key}` },
      });
    }

    const permissions = await this.prisma.permission.findMany({
      where: { key: { in: [...permissionKeys] } },
      select: { id: true },
    });

    const ownerRoles = await this.prisma.role.findMany({
      where: { isSystem: true, name: OWNER_ROLE_NAME },
      select: { id: true },
    });

    let granted = 0;
    for (const role of ownerRoles) {
      const result = await this.prisma.rolePermission.createMany({
        data: permissions.map((permission) => ({
          roleId: role.id,
          permissionId: permission.id,
        })),
        skipDuplicates: true,
      });
      granted += result.count;
    }

    return granted;
  }
}
