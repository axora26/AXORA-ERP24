/**
 * Pipeline commercial par defaut cree au bootstrap d'une entreprise (INC-02).
 *
 * Ces etapes ne sont pas une norme externe : ce sont des valeurs de depart
 * reconfigurables par le tenant via la permission crm.pipeline.manage. Les
 * probabilites servent uniquement a calculer une valeur ponderee de pipeline
 * affichee comme telle — jamais presentee comme une prevision certifiee.
 */
export interface PipelineStageSeed {
  name: string;
  position: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export const DEFAULT_PIPELINE_STAGES: readonly PipelineStageSeed[] = [
  { name: "Qualification", position: 1, probability: 10, isWon: false, isLost: false },
  { name: "Analyse du besoin", position: 2, probability: 25, isWon: false, isLost: false },
  { name: "Proposition", position: 3, probability: 50, isWon: false, isLost: false },
  { name: "Negociation", position: 4, probability: 75, isWon: false, isLost: false },
  { name: "Gagnee", position: 5, probability: 100, isWon: true, isLost: false },
  { name: "Perdue", position: 6, probability: 0, isWon: false, isLost: true },
] as const;
