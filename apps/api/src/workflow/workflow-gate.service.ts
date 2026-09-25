import { ConflictException, Injectable } from "@nestjs/common";
import type { Prisma } from "@axora24/database";
import type { CompanyScope } from "../common/company-scope.service.js";
import type { StoredAction } from "./automation.service.js";

type Tx = Prisma.TransactionClient;

/**
 * Point de controle des decisions metier sensibles (approbation d'une demande
 * d'achat, d'une facture fournisseur, d'une situation de sous-traitance).
 *
 * Fail-closed : la decision est refusee tant qu'une approbation de workflow
 * est en attente ou a ete refusee, ET tant qu'un evenement de la ressource
 * susceptible d'en creer une n'a pas encore ete evalue par le moteur.
 */
@Injectable()
export class WorkflowGate {
  async assertCleared(tx: Tx, scope: CompanyScope, resourceType: string, resourceId: string): Promise<void> {
    const blocking = await tx.workflowApproval.findFirst({
      where: { ...scope, resourceType, resourceId, status: { in: ["PENDING", "REJECTED"] } },
      orderBy: { createdAt: "asc" },
      select: { code: true, title: true, status: true, decisionNote: true },
    });
    if (blocking?.status === "PENDING") throw new ConflictException(`Approbation de workflow ${blocking.code} en attente (${blocking.title})`);
    if (blocking?.status === "REJECTED") throw new ConflictException(`Approbation de workflow ${blocking.code} refusée : ${blocking.decisionNote ?? "sans motif"}`);

    const pending = await tx.automationEvent.findMany({ where: { ...scope, resourceType, resourceId, processedAt: null }, select: { type: true, occurredAt: true } });
    if (pending.length === 0) return;
    const definitions = await tx.workflowDefinition.findMany({
      where: { ...scope, active: true, eventType: { in: [...new Set(pending.map((event) => event.type))] } },
      select: { eventType: true, createdAt: true, actions: true },
    });
    const gated = pending.some((event) =>
      definitions.some((definition) => definition.eventType === event.type && definition.createdAt <= event.occurredAt && (definition.actions as unknown as StoredAction[]).some((action) => action.type === "REQUIRE_APPROVAL")),
    );
    if (gated) throw new ConflictException("Évaluation du workflow en cours pour cette pièce : réessayez dans quelques secondes");
  }
}
