/**
 * INC-22 — Planification d'une question du copilote (pur, sans E/S).
 *
 * Le copilote ne « devine » rien : il reconnait des intentions a partir de
 * mots-cles explicites et de references de pieces (DA-2026-0007...), puis
 * n'interroge que les outils correspondants. Une question hors perimetre
 * recoit la liste de ce que l'utilisateur peut demander — jamais une
 * reponse inventee.
 */

export type PlanMode = "BRIEFING" | "TOOLS" | "LOOKUP" | "HELP";

export interface ToolDescriptor {
  id: string;
  keywords: string[];
}

export interface Plan {
  mode: PlanMode;
  tools: string[];
  references: string[];
}

const BRIEFING = ["synthese", "resume", "situation", "briefing", "vue d ensemble", "tableau de bord", "indicateurs", "kpi", "point general", "etat general", "quoi de neuf", "bilan"];

export function normalize(text: string): string {
  return ` ${text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/** References de pieces du type PREFIXE-AAAA-NNNN, en majuscules, sans doublon. */
export function extractReferences(question: string): string[] {
  const found = question.toUpperCase().match(/\b[A-Z]{2,5}-\d{4}-\d{3,6}\b/g) ?? [];
  return [...new Set(found)].slice(0, 5);
}

function mentions(text: string, keyword: string): boolean {
  return text.includes(` ${normalize(keyword).trim()} `);
}

export function planQuestion(question: string, tools: ToolDescriptor[]): Plan {
  const text = normalize(question);
  const references = extractReferences(question);
  const matched = tools
    .map((tool) => ({ id: tool.id, score: tool.keywords.filter((keyword) => mentions(text, keyword)).length }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((entry) => entry.id);
  if (references.length > 0) return { mode: "LOOKUP", tools: matched, references };
  if (matched.length > 0) return { mode: "TOOLS", tools: matched.slice(0, 4), references };
  if (BRIEFING.some((keyword) => mentions(text, keyword))) return { mode: "BRIEFING", tools: [], references };
  return { mode: "HELP", tools: [], references };
}

export function formatAmount(value: string, currency?: string | null): string {
  const [integer, fraction = "00"] = value.replace(/^-/, "").split(".");
  const grouped = integer!.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${value.startsWith("-") ? "-" : ""}${grouped},${fraction.padEnd(2, "0").slice(0, 2)}${currency ? ` ${currency.trim()}` : ""}`;
}

export function formatDay(date: Date | null | undefined): string {
  if (!date) return "—";
  const iso = date.toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/** Rendu texte d'une reponse structuree (c'est ce texte qui est empreinte en base). */
export function renderAnswer(blocks: Array<{ title: string; lines: Array<{ text: string; cites: number[] }> }>): string {
  return blocks
    .map((block) => [block.title, ...block.lines.map((line) => `• ${line.text}${line.cites.length ? ` ${line.cites.map((cite) => `[${cite}]`).join("")}` : ""}`)].join("\n"))
    .join("\n\n");
}
