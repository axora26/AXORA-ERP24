import { describe, expect, it } from "vitest";
import { applyResults, newClientId, pendingOperations, queueSummary, reapplyOnServerVersion, type QueuedOperation } from "./field-queue";

const op = (clientId: string, queuedAt: string, extra: Partial<QueuedOperation> = {}): QueuedOperation => ({
  clientId,
  type: "evidence.create",
  payload: {},
  projectId: "p1",
  label: clientId,
  queuedAt,
  state: "PENDING",
  ...extra,
});

describe("file de synchronisation terrain", () => {
  it("genere des identifiants client uniques et prefixes", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newClientId("ev")));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^ev-[A-Za-z0-9_-]{8,}$/);
  });

  it("envoie les operations en attente dans l'ordre de saisie", () => {
    const queue = [op("b", "2026-09-25T10:00:02Z"), op("a", "2026-09-25T10:00:01Z"), op("c", "2026-09-25T10:00:03Z", { state: "CONFLICT" })];
    expect(pendingOperations(queue).map((operation) => operation.clientId)).toEqual(["a", "b"]);
  });

  it("ne retire une operation que sur accuse serveur ; conflits et rejets restent visibles", () => {
    const queue = [op("a", "1"), op("b", "2"), op("c", "3"), op("d", "4")];
    const server = { id: "i1", version: 2 } as never;
    const outcome = applyResults(queue, [
      { clientId: "a", status: "APPLIED", entityId: "e1" },
      { clientId: "b", status: "DUPLICATE", entityId: "e2" },
      { clientId: "c", status: "CONFLICT", message: "changed", server },
    ]);
    expect(outcome.confirmed.map((operation) => operation.clientId)).toEqual(["a", "b"]);
    expect(outcome.queue.map((operation) => `${operation.clientId}:${operation.state}`)).toEqual(["c:CONFLICT", "d:PENDING"]);
    expect(outcome.conflicts).toBe(1);
    expect(queueSummary(outcome.queue)).toEqual({ pending: 1, conflicts: 1, rejected: 0 });
  });

  it("une reponse partielle (coupure reseau) ne perd rien", () => {
    const queue = [op("a", "1"), op("b", "2")];
    expect(applyResults(queue, []).queue).toHaveLength(2);
  });

  it("resolution explicite : reappliquer sur la version serveur lue, meme identifiant", () => {
    const conflict = op("c", "3", { type: "issue.submitCorrection", baseVersion: 1, state: "CONFLICT", server: { id: "i1", version: 3 } as never });
    const resolved = reapplyOnServerVersion(conflict);
    expect(resolved).toMatchObject({ clientId: "c", state: "PENDING", baseVersion: 3 });
    expect(resolved.server).toBeUndefined();
    expect(() => reapplyOnServerVersion(op("x", "1"))).toThrow();
  });
});
