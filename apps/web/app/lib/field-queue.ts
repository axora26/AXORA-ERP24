import type { FieldSyncOperation, FieldSyncResult, SiteDailyLogView, SiteIssueView } from "@axora24/contracts";

/**
 * File de synchronisation terrain — logique pure (sans IndexedDB ni reseau),
 * testee unitairement.
 *
 * INVARIANTS (docs/foundation/02-domain-model.md BC-09) :
 * - une operation n'est retiree de la file QUE sur accuse serveur
 *   (APPLIED ou DUPLICATE) : aucune perte silencieuse ;
 * - un CONFLIT ou un REJET reste en file, visible, jusqu'a une decision
 *   explicite de l'utilisateur (reappliquer sur la version serveur, ou
 *   abandonner) ;
 * - l'ordre de saisie est conserve (une photo suit la reserve qu'elle documente).
 */
export type QueueState = "PENDING" | "CONFLICT" | "REJECTED";

export interface QueuedOperation extends FieldSyncOperation {
  projectId: string;
  label: string;
  queuedAt: string;
  state: QueueState;
  /** Photo en attente d'envoi (cle IndexedDB) : televersee juste avant la synchronisation. */
  blobKey?: string;
  blobName?: string;
  message?: string;
  server?: SiteIssueView | SiteDailyLogView;
}

export function newClientId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${random}`;
}

/** Operations a envoyer, dans l'ordre de saisie. */
export function pendingOperations(queue: QueuedOperation[]): QueuedOperation[] {
  return [...queue].filter((operation) => operation.state === "PENDING").sort((left, right) => left.queuedAt.localeCompare(right.queuedAt));
}

/** Applique les accuses serveur : seules les operations confirmees quittent la file. */
export function applyResults(
  queue: QueuedOperation[],
  results: FieldSyncResult[],
): { queue: QueuedOperation[]; confirmed: QueuedOperation[]; conflicts: number; rejected: number } {
  const byClientId = new Map(results.map((result) => [result.clientId, result]));
  const remaining: QueuedOperation[] = [];
  const confirmed: QueuedOperation[] = [];
  let conflicts = 0;
  let rejected = 0;
  for (const operation of queue) {
    const result = byClientId.get(operation.clientId);
    if (!result) {
      remaining.push(operation);
      continue;
    }
    if (result.status === "APPLIED" || result.status === "DUPLICATE") {
      confirmed.push(operation);
    } else if (result.status === "CONFLICT") {
      conflicts += 1;
      remaining.push({ ...operation, state: "CONFLICT", message: result.message, server: result.server });
    } else {
      rejected += 1;
      remaining.push({ ...operation, state: "REJECTED", message: result.message });
    }
  }
  return { queue: remaining, confirmed, conflicts, rejected };
}

/**
 * Decision explicite sur un conflit : reappliquer la saisie sur la version
 * serveur affichee (meme identifiant d'operation, version de base mise a
 * jour) — jamais un ecrasement sans que l'utilisateur ait vu l'etat serveur.
 */
export function reapplyOnServerVersion(operation: QueuedOperation): QueuedOperation {
  if (operation.state !== "CONFLICT" || !operation.server) throw new Error("Only a conflict with a server state can be re-applied");
  return { ...operation, state: "PENDING", baseVersion: operation.server.version, message: undefined, server: undefined };
}

export function queueSummary(queue: QueuedOperation[]): { pending: number; conflicts: number; rejected: number } {
  return {
    pending: queue.filter((operation) => operation.state === "PENDING").length,
    conflicts: queue.filter((operation) => operation.state === "CONFLICT").length,
    rejected: queue.filter((operation) => operation.state === "REJECTED").length,
  };
}
