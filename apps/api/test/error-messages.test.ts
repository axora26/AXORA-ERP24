import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MESSAGE_CATALOGUE, translateMessage } from "../src/common/i18n/translate.js";

const SRC = join(__dirname, "..", "src");
const START = /(?:NotFound|BadRequest|Forbidden|Conflict|Unauthorized|UnprocessableEntity|Http)Exception\(\s*(["`])/g;
/** Messages deja rediges en francais (ou sans mot anglais) : hors catalogue. */
const FRENCH = /[éèàêçùâîôûœÉÈÀ]|\b(introuvable|obligatoire|doit|refus|Aucun|aucun|impossible|inconnu|inconnue|seul|seule|valeur|attendu|attendue|indisponible|requis|requise|entre|jamais|indicateur)\b|\b(de|du|la|le|les|des|une|est|pas|ne|au|aux|sur|pour|par|avec|sans) /;
const NEUTRAL = new Set(["actions[{x}].url : {x}"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".ts") ? [path] : [];
  });
}

/** Litteral de message -> modele (`{x}` pour chaque interpolation, accolades imbriquees comprises). */
function templates(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(START)) {
    const quote = match[1]!;
    let index = match.index! + match[0].length;
    let result = "";
    while (index < text.length && text[index] !== quote) {
      if (text[index] === "\\") {
        result += text[index + 1];
        index += 2;
      } else if (quote === "`" && text.startsWith("${", index)) {
        index += 1; // « $ » ; la boucle consomme ensuite l'accolade ouvrante et son contenu.
        let depth = 0;
        do {
          if (text[index] === "{") depth += 1;
          if (text[index] === "}") depth -= 1;
          index += 1;
        } while (depth > 0 && index < text.length);
        result += "{x}";
      } else {
        result += text[index];
        index += 1;
      }
    }
    found.push(result);
  }
  return found;
}

const sourceTemplates = [...new Set(files(SRC).flatMap((path) => templates(readFileSync(path, "utf8"))))];
const english = sourceTemplates.filter((template) => !FRENCH.test(template) && !NEUTRAL.has(template));

describe("Messages d'erreur de l'API en français", () => {
  it("chaque message anglais du code a une traduction au catalogue", () => {
    expect(english.length).toBeGreaterThan(500);
    const missing = english.filter((template) => MESSAGE_CATALOGUE[template] === undefined);
    expect(missing).toEqual([]);
  });

  it("le catalogue ne contient aucune entrée orpheline et respecte ses emplacements", () => {
    const known = new Set(sourceTemplates);
    expect(Object.keys(MESSAGE_CATALOGUE).filter((key) => !known.has(key))).toEqual([]);
    for (const [key, value] of Object.entries(MESSAGE_CATALOGUE)) {
      const slots = key.split("{x}").length - 1;
      const used = [...value.matchAll(/\{(\d+)\}/g)].map((match) => Number(match[1]));
      expect(used.every((slot) => slot >= 1 && slot <= slots), key).toBe(true);
    }
  });

  it("traduction à l'exécution : exacte, avec valeurs, modèle le plus spécifique, inconnu intact", () => {
    expect(translateMessage("Project not found")).toBe("Projet introuvable");
    expect(translateMessage("contactName is required")).toBe("contactName est obligatoire");
    expect(translateMessage("measurements[2].measured is required")).toBe("measurements[2].measured est obligatoire");
    expect(translateMessage("Insufficient stock for CIM-42 in MAG-01: available 3 sac, requested 10")).toBe("Stock insuffisant pour CIM-42 dans MAG-01 : disponible 3 sac, demandé 10");
    expect(translateMessage("Lead not found")).toBe("Prospect introuvable");
    expect(translateMessage("Opportunity not found")).toBe("Opportunité introuvable");
    expect(translateMessage("Vehicle not compliant: assurance absente, carte grise absente")).toBe("Véhicule non conforme : assurance absente, carte grise absente");
    expect(translateMessage("Déjà en français")).toBeNull();
  });
});
