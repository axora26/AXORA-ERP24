"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { FieldSyncResult, SiteDailyLogView, SiteIssueView, StoredFileView } from "@axora24/contracts";
import { CloudOff, RefreshCw, Trash2, Wifi } from "lucide-react";
import { ApiError, api } from "../lib/api";
import { applyResults, newClientId, pendingOperations, queueSummary, reapplyOnServerVersion, type QueuedOperation } from "../lib/field-queue";
import { fieldStore } from "../lib/field-store";
import { formatDateTime } from "../lib/format";
import { Button, Panel, StatusChip } from "./ui";

export type NewOperation = Omit<QueuedOperation, "queuedAt" | "state" | "clientId"> & { clientId?: string };

export interface FieldQueue {
  queue: QueuedOperation[];
  online: boolean;
  syncing: boolean;
  lastSync: string;
  /** Met l'operation en file (persistante) puis tente l'envoi immediat si le reseau est disponible. */
  enqueue: (operations: NewOperation[], blob?: { forClientIndex: number; blob: Blob; name: string }) => Promise<string[]>;
  syncNow: () => Promise<void>;
  reapply: (clientId: string) => Promise<void>;
  discard: (clientId: string) => Promise<void>;
}

/**
 * File de synchronisation terrain : toute saisie passe par elle, en ligne
 * comme hors ligne (un seul chemin, donc un seul comportement a tester).
 */
export function useFieldQueue(onSynced?: () => void): FieldQueue {
  const [queue, setQueue] = useState<QueuedOperation[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState("");
  const busy = useRef(false);
  const onSyncedRef = useRef(onSynced);
  onSyncedRef.current = onSynced;

  const reload = useCallback(async () => {
    const stored = await fieldStore.list().catch(() => []);
    setQueue(stored.sort((left, right) => left.queuedAt.localeCompare(right.queuedAt)));
    return stored;
  }, []);

  const syncNow = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setSyncing(true);
    try {
      const stored = await reload();
      let pending = pendingOperations(stored);
      if (pending.length === 0) return;

      // 1. Photos en attente : televersees (idempotent : meme contenu = meme fichier).
      for (const operation of pending) {
        if (!operation.blobKey || operation.payload.fileId) continue;
        const blob = await fieldStore.getBlob(operation.blobKey);
        if (!blob) {
          await fieldStore.put({ ...operation, state: "REJECTED", message: "Photo introuvable sur cet appareil." });
          continue;
        }
        try {
          const file = await api.upload<StoredFileView>("/files", blob, operation.blobName ?? "photo.jpg");
          const updated = { ...operation, payload: { ...operation.payload, fileId: file.id } };
          await fieldStore.put(updated);
        } catch (error) {
          if (error instanceof ApiError && error.status === 0) {
            setOnline(false);
            return;
          }
          await fieldStore.put({ ...operation, state: "REJECTED", message: error instanceof Error ? error.message : "Envoi de la photo refusé." });
        }
      }

      // 2. Operations, dans l'ordre de saisie.
      pending = pendingOperations(await reload());
      if (pending.length === 0) return;
      let results: FieldSyncResult[];
      try {
        const response = await api.post<{ results: FieldSyncResult[] }>("/field/sync", {
          operations: pending.map(({ clientId, type, payload, baseVersion }) => ({ clientId, type, payload, ...(baseVersion !== undefined ? { baseVersion } : {}) })),
        });
        results = response.results;
      } catch (error) {
        if (error instanceof ApiError && error.status === 0) setOnline(false);
        return;
      }
      setOnline(true);

      // 3. Seuls les accuses serveur retirent une operation de la file.
      const outcome = applyResults(pending, results);
      for (const operation of outcome.confirmed) {
        await fieldStore.remove(operation.clientId);
        if (operation.blobKey) await fieldStore.removeBlob(operation.blobKey);
      }
      for (const operation of outcome.queue) await fieldStore.put(operation);
      setLastSync(
        `${outcome.confirmed.length} opération(s) synchronisée(s)` +
          (outcome.conflicts ? ` · ${outcome.conflicts} conflit(s) à résoudre` : "") +
          (outcome.rejected ? ` · ${outcome.rejected} refusée(s)` : ""),
      );
      if (outcome.confirmed.length > 0) onSyncedRef.current?.();
    } finally {
      await reload();
      busy.current = false;
      setSyncing(false);
    }
  }, [reload]);

  useEffect(() => {
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    const up = () => {
      setOnline(true);
      void syncNow();
    };
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    void reload().then((stored) => {
      if (pendingOperations(stored).length > 0 && navigator.onLine) void syncNow();
    });
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, [reload, syncNow]);

  const enqueue = useCallback<FieldQueue["enqueue"]>(
    async (operations, blob) => {
      const now = Date.now();
      const ids: string[] = [];
      for (const [index, operation] of operations.entries()) {
        const clientId = operation.clientId ?? newClientId(operation.type.split(".")[0] ?? "op");
        ids.push(clientId);
        const queued: QueuedOperation = { ...operation, clientId, queuedAt: new Date(now + index).toISOString(), state: "PENDING" };
        if (blob && blob.forClientIndex === index) {
          await fieldStore.putBlob(clientId, blob.blob);
          queued.blobKey = clientId;
          queued.blobName = blob.name;
        }
        await fieldStore.put(queued);
      }
      await reload();
      if (navigator.onLine) await syncNow();
      return ids;
    },
    [reload, syncNow],
  );

  const reapply = useCallback(
    async (clientId: string) => {
      const operation = (await fieldStore.list()).find((candidate) => candidate.clientId === clientId);
      if (!operation) return;
      await fieldStore.put(reapplyOnServerVersion(operation));
      await syncNow();
    },
    [syncNow],
  );

  const discard = useCallback(
    async (clientId: string) => {
      const operation = (await fieldStore.list()).find((candidate) => candidate.clientId === clientId);
      await fieldStore.remove(clientId);
      if (operation?.blobKey) await fieldStore.removeBlob(operation.blobKey);
      await reload();
    },
    [reload],
  );

  return { queue, online, syncing, lastSync, enqueue, syncNow, reapply, discard };
}

function serverSummary(server: SiteIssueView | SiteDailyLogView): string {
  if ("code" in server) return `${server.code} · statut ${server.status} · version ${server.version}${server.correctionNote ? ` · « ${server.correctionNote} »` : ""}`;
  return `Journal du ${server.logDate} · version ${server.version} · ${server.workforceCount} pers. · « ${server.summary} »`;
}

/** Etat de la file : reseau, operations en attente, conflits a trancher explicitement. */
export function SyncPanel({ field }: { field: FieldQueue }): React.ReactElement {
  const summary = queueSummary(field.queue);
  const attention = field.queue.filter((operation) => operation.state !== "PENDING");
  return (
    <Panel
      title="Synchronisation terrain"
      subtitle={
        field.online
          ? "En ligne : chaque saisie est envoyée immédiatement et reste en file tant que le serveur ne l'a pas confirmée."
          : "Hors ligne : les saisies sont conservées sur cet appareil et partiront à la reprise du réseau."
      }
      actions={
        <>
          <span className={`net-state ${field.online ? "on" : "off"}`} role="status">
            {field.online ? <Wifi size={14} aria-hidden="true" /> : <CloudOff size={14} aria-hidden="true" />}
            {field.online ? "En ligne" : "Hors ligne"}
          </span>
          <Button onClick={() => void field.syncNow()} disabled={field.syncing || summary.pending === 0}>
            <RefreshCw size={14} aria-hidden="true" /> {field.syncing ? "Envoi…" : `Synchroniser (${summary.pending})`}
          </Button>
        </>
      }
    >
      <div className="sync-body">
        <p className="inline-note">
          {summary.pending} en attente · {summary.conflicts} conflit(s) · {summary.rejected} refusée(s)
          {field.lastSync ? ` — ${field.lastSync}` : ""}
        </p>
        {field.queue.filter((operation) => operation.state === "PENDING").length > 0 && (
          <ul className="queue-list">
            {field.queue
              .filter((operation) => operation.state === "PENDING")
              .map((operation) => (
                <li key={operation.clientId}>
                  <StatusChip status="pending" label="En attente" /> {operation.label}
                  <small>saisie le {formatDateTime(operation.queuedAt)}</small>
                </li>
              ))}
          </ul>
        )}
        {attention.map((operation) => (
          <div key={operation.clientId} className={`conflict-card ${operation.state === "CONFLICT" ? "conflict" : "rejected"}`}>
            <div>
              <StatusChip status={operation.state === "CONFLICT" ? "warning" : "rejected"} label={operation.state === "CONFLICT" ? "Conflit" : "Refusée"} />
              <strong>{operation.label}</strong>
              <p>
                {operation.state === "CONFLICT" && operation.server
                  ? operation.baseVersion === undefined
                    ? "Cet élément existe déjà sur le serveur : votre saisie n'a pas été appliquée."
                    : `Modifié entre-temps : le serveur est en version ${operation.server.version}, votre saisie portait sur la version ${operation.baseVersion}. Rien n'a été écrasé.`
                  : operation.message}
              </p>
              {operation.state === "CONFLICT" && operation.message && <small className="server-detail">{operation.message}</small>}
              {operation.server && <p className="server-state">État actuel sur le serveur : {serverSummary(operation.server)}</p>}
            </div>
            <div className="conflict-actions">
              {operation.state === "CONFLICT" && operation.server && (
                <Button variant="primary" onClick={() => void field.reapply(operation.clientId)}>
                  Réappliquer ma saisie sur cette version
                </Button>
              )}
              <Button variant="ghost" onClick={() => void field.discard(operation.clientId)}>
                <Trash2 size={14} aria-hidden="true" /> Abandonner ma saisie
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
