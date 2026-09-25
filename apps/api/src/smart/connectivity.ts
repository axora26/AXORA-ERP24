import type { ConnectivityLevel, SmartProtocol } from "@axora24/contracts";

/** Catalogue des protocoles : ce que la plateforme modelise et ce pour quoi un pilote natif existe. */
export const PROTOCOL_CATALOG: Record<SmartProtocol, { label: string; addressing: string; nativeConnector: boolean }> = {
  HTTP_API: { label: "API HTTP d'ingestion AXORA", addressing: "identifiant libre de point", nativeConnector: true },
  MQTT: { label: "MQTT", addressing: "topic", nativeConnector: false },
  BACNET_IP: { label: "BACnet/IP", addressing: "objet BACnet (type:instance)", nativeConnector: false },
  MODBUS_TCP: { label: "Modbus TCP", addressing: "unite + registre", nativeConnector: false },
  KNX_IP: { label: "KNXnet/IP", addressing: "adresse de groupe", nativeConnector: false },
};

export interface TestEvidence {
  at: Date;
  by: string;
}

/**
 * Les cinq niveaux de connectivite (docs/foundation/02-domain-model.md BC-16,
 * invariant 1), calcules sur preuves uniquement :
 * - protocole supporte / pilote natif developpe : catalogue de la plateforme ;
 * - reseau : un contact reel de la passerelle a ete recu ;
 * - lecture / ecriture reelles : attestation d'un essai point-a-point contre
 *   l'equipement physique (jamais deduite du simple flux de donnees).
 * Une passerelle de simulation ne produit jamais de niveau 3 a 5.
 */
export function connectivityLevels(input: {
  protocol: SmartProtocol;
  simulated: boolean;
  lastSeenAt: Date | null;
  readPass: TestEvidence | null;
  writePass: TestEvidence | null;
}): ConnectivityLevel[] {
  const protocol = PROTOCOL_CATALOG[input.protocol];
  const simulated = (label: string, key: ConnectivityLevel["key"]): ConnectivityLevel => ({
    key,
    label,
    state: "SIMULATED",
    detail: "Passerelle de simulation : ses échanges ne prouvent aucune communication avec un équipement physique.",
    evidenceAt: null,
  });
  return [
    {
      key: "protocol",
      label: "Protocole supporté",
      state: "YES",
      detail: `${protocol.label} modélisé : points référencés par ${protocol.addressing}.`,
      evidenceAt: null,
    },
    protocol.nativeConnector
      ? { key: "connector", label: "Connecteur développé", state: "YES", detail: "API d'ingestion développée et couverte par les tests automatisés (lectures, rejeu, consignes).", evidenceAt: null }
      : {
          key: "connector",
          label: "Connecteur développé",
          state: "NO",
          detail: `Aucun pilote ${protocol.label} natif : intégration uniquement via une passerelle de terrain qui pousse vers l'API d'ingestion.`,
          evidenceAt: null,
        },
    input.simulated
      ? simulated("Passerelle joignable", "network")
      : input.lastSeenAt
        ? {
            key: "network",
            label: "Passerelle joignable",
            state: "YES",
            detail: "La passerelle a joint la plateforme avec son jeton — n'atteste pas à elle seule l'accès aux équipements terrain.",
            evidenceAt: input.lastSeenAt.toISOString(),
          }
        : { key: "network", label: "Passerelle joignable", state: "NOT_TESTED", detail: "Aucun contact reçu de cette passerelle.", evidenceAt: null },
    input.simulated
      ? simulated("Lecture réelle testée", "read")
      : input.readPass
        ? {
            key: "read",
            label: "Lecture réelle testée",
            state: "YES",
            detail: `Essai point-à-point réussi : valeur relevée comparée à une mesure de référence, attesté par ${input.readPass.by}.`,
            evidenceAt: input.readPass.at.toISOString(),
          }
        : { key: "read", label: "Lecture réelle testée", state: "NOT_TESTED", detail: "Aucun essai de lecture attesté contre l'équipement physique.", evidenceAt: null },
    input.simulated
      ? simulated("Écriture réelle testée", "write")
      : input.writePass
        ? {
            key: "write",
            label: "Écriture réelle testée",
            state: "YES",
            detail: `Consigne confirmée par relecture et constatée sur l'équipement, attesté par ${input.writePass.by}.`,
            evidenceAt: input.writePass.at.toISOString(),
          }
        : { key: "write", label: "Écriture réelle testée", state: "NOT_TESTED", detail: "Aucune consigne confirmée par relecture et constat sur site.", evidenceAt: null },
  ];
}
