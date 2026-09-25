/**
 * INC-22 — Copilote IA. Moteur de reponse ANCRE et deterministe : chaque
 * affirmation provient d'un outil de lecture borne par la permission de
 * l'utilisateur ; chaque interaction laisse une preuve d'inference
 * append-only (question, controles d'acces, sources, reponse, empreinte).
 */

export interface CopilotSourceRef {
  /** Numero de citation [n] dans la reponse. */
  index: number;
  tool: string;
  resourceType: string;
  resourceId: string;
  label: string;
  link: string | null;
}

export interface CopilotPermissionCheck {
  tool: string;
  label: string;
  permission: string;
  granted: boolean;
}

export interface CopilotAnswerLine {
  text: string;
  /** Citations (index de `sources`). */
  cites: number[];
}

export interface CopilotAnswerBlock {
  title: string;
  tool: string;
  lines: CopilotAnswerLine[];
}

export interface CopilotEvidenceView {
  id: string;
  sessionId: string;
  userName: string;
  question: string;
  mode: "BRIEFING" | "TOOLS" | "LOOKUP" | "HELP";
  answer: string;
  blocks: CopilotAnswerBlock[];
  sources: CopilotSourceRef[];
  permissionChecks: CopilotPermissionCheck[];
  engine: string;
  modelProvider: string | null;
  answerSha256: string;
  latencyMs: number;
  createdAt: string;
}

export interface CopilotSessionView {
  id: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  exchanges: number;
}

export interface CopilotSessionDetail extends CopilotSessionView {
  exchangesDetail: CopilotEvidenceView[];
}

export interface CopilotCapabilityView {
  tool: string;
  label: string;
  permission: string;
  granted: boolean;
  example: string;
}

export interface CopilotAskResult {
  sessionId: string;
  evidence: CopilotEvidenceView;
}
