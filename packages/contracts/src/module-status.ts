/**
 * Vocabulaire de statut obligatoire — docs/foundation/06-product-backlog.md §2.
 *
 * INTERDIT ABSOLU : ne jamais utiliser "READY", "DEPLOYED", "TESTED",
 * "CONNECTED", "COMPLETE" comme statut de module. Ces mots ne doivent
 * apparaitre que dans un texte descriptif appuye par une preuve CI reelle.
 */
export const MODULE_STATUS_VALUES = [
  "NOT_STARTED",
  "FOUNDATION",
  "IN_PROGRESS",
  "IMPLEMENTED_NOT_VERIFIED",
  "VERIFIED",
  "BLOCKED",
  "NOT_TESTED",
  "DEPRECATED",
] as const;

export type ModuleStatus = (typeof MODULE_STATUS_VALUES)[number];

export interface ModuleStatusEntry {
  moduleId: string;
  name: string;
  status: ModuleStatus;
  /** Numero de run CI + SHA exact — obligatoire pour tout statut VERIFIED. */
  evidence?: {
    ciRunId: string;
    commitSha: string;
  };
  notes?: string;
}
