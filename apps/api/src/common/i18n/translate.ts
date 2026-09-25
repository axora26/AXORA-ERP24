import { CORE_MESSAGES } from "./messages-core.fr.js";
import { DOMAIN_MESSAGES } from "./messages-domain.fr.js";
import { OPS_MESSAGES } from "./messages-ops.fr.js";

/** Catalogue complet : modele source (anglais, `{x}`) -> francais (`{1}`, `{2}`...). */
export const MESSAGE_CATALOGUE: Record<string, string> = { ...CORE_MESSAGES, ...OPS_MESSAGES, ...DOMAIN_MESSAGES };

/** Mots interpoles traduits lorsqu'ils constituent une valeur entiere (ex. « Lead » dans « {x} not found »). */
const VALUE_WORDS: Record<string, string> = { Lead: "Prospect", Account: "Compte", Contact: "Contact", Opportunity: "Opportunité" };

/** Libelles des erreurs HTTP standard. */
export const HTTP_ERROR_LABELS: Record<string, string> = {
  "Bad Request": "Requête invalide",
  Unauthorized: "Non authentifié",
  Forbidden: "Accès refusé",
  "Not Found": "Introuvable",
  Conflict: "Conflit",
  "Unprocessable Entity": "Contenu refusé",
  "Too Many Requests": "Trop de requêtes",
  "Payload Too Large": "Contenu trop volumineux",
  "Service Unavailable": "Service indisponible",
  "Internal Server Error": "Erreur interne",
};

interface Compiled {
  regex: RegExp;
  translation: string;
  specificity: number;
}

const exact = new Map<string, string>();
const patterns: Compiled[] = [];
for (const [template, translation] of Object.entries(MESSAGE_CATALOGUE)) {
  if (!template.includes("{x}")) {
    exact.set(template, translation);
    continue;
  }
  const source = template
    .split("{x}")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("([\\s\\S]+?)");
  patterns.push({ regex: new RegExp(`^${source}$`), translation, specificity: template.replace(/\{x\}/g, "").length });
}
// Le modele le plus specifique (plus de texte fixe) l'emporte.
patterns.sort((left, right) => right.specificity - left.specificity);

function fill(translation: string, values: string[]): string {
  return translation.replace(/\{(\d+)\}/g, (_match, index: string) => {
    const value = values[Number(index) - 1] ?? "";
    return VALUE_WORDS[value] ?? value;
  });
}

/** Traduction d'un message source ; null si le message n'est pas catalogue (deja francais, ou imprevu). */
export function translateMessage(message: string): string | null {
  const direct = exact.get(message);
  if (direct !== undefined) return direct;
  for (const pattern of patterns) {
    const match = pattern.regex.exec(message);
    if (match) return fill(pattern.translation, match.slice(1));
  }
  return null;
}
