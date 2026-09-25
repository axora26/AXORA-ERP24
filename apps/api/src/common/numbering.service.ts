import { Injectable } from "@nestjs/common";
import type { Prisma } from "@axora24/database";
import type { CompanyScope } from "./company-scope.service.js";

type SequenceClient = Pick<Prisma.TransactionClient, "$queryRaw">;

/**
 * Numerotation automatique par entreprise (INC-01, "numerotation automatique").
 *
 * Format : `<PREFIXE>-<ANNEE>-<NNNN>` (ex. PRJ-2026-0007). Le compteur est
 * incremente atomiquement par un seul `INSERT ... ON CONFLICT DO UPDATE ...
 * RETURNING` : deux transactions concurrentes ne peuvent jamais obtenir le
 * meme numero, sans verrou applicatif.
 *
 * A appeler DANS la transaction de creation : si la creation echoue, le
 * compteur est annule avec elle (pas de trou dans la sequence).
 */
@Injectable()
export class NumberingService {
  async next(
    tx: SequenceClient,
    scope: CompanyScope,
    prefix: string,
    at: Date = new Date(),
  ): Promise<string> {
    const year = at.getUTCFullYear();
    const key = `${prefix}-${year}`;
    const rows = await tx.$queryRaw<Array<{ value: number }>>`
      INSERT INTO "number_sequences" ("id", "organizationId", "companyId", "key", "value", "updatedAt")
      VALUES (gen_random_uuid()::text, ${scope.organizationId}, ${scope.companyId}, ${key}, 1, now())
      ON CONFLICT ("companyId", "key")
      DO UPDATE SET "value" = "number_sequences"."value" + 1, "updatedAt" = now()
      RETURNING "value"
    `;
    const value = rows[0]?.value ?? 1;
    return `${key}-${String(value).padStart(4, "0")}`;
  }
}
