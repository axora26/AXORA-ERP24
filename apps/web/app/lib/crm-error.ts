import { ApiError } from "./api";

export function isStaleRecord(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409 && /changed|concurr|version|modifi/i.test(error.message);
}
export function crmError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (isStaleRecord(error)) return "Cette fiche a été modifiée ailleurs. Actualisez la liste avant de réessayer.";
  if (/active primary contact/i.test(error.message)) return "Ce compte possède déjà un contact principal. Décochez le contact principal actuel avant d’en choisir un autre.";
  if (/restore.*account/i.test(error.message)) return "Restaurez d’abord le compte associé pour poursuivre cette opération.";
  if (/restore.*contact/i.test(error.message)) return "Restaurez d’abord ce contact pour poursuivre cette opération.";
  if (/already active/i.test(error.message)) return "Cette fiche est déjà active. Actualisez la liste.";
  if (/already archived/i.test(error.message)) return "Cette fiche est déjà archivée. Actualisez la liste.";
  return error.message;
}
