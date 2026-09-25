import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extractReferences, formatAmount, formatDay, normalize, planQuestion, renderAnswer } from "../src/copilot/planner.js";

const TOOLS = [
  { id: "finance.receivables", keywords: ["impaye", "impayes", "creance", "creances", "facture client", "factures clients", "encaissement"] },
  { id: "hr.people", keywords: ["effectif", "employe", "employes", "conge", "conges"] },
  { id: "smart.alarms", keywords: ["alarme", "alarmes", "gtb"] },
];

describe("Copilote — planification", () => {
  it("normalise accents, casse et ponctuation", () => {
    expect(normalize("Créances   IMPAYÉES ?")).toBe(" creances impayees ");
  });

  it("reconnait les intentions par mots entiers (jamais par fragment)", () => {
    expect(planQuestion("Quelles sont les factures clients impayées ?", TOOLS)).toEqual({ mode: "TOOLS", tools: ["finance.receivables"], references: [] });
    expect(planQuestion("Combien d'employés et de congés en attente ?", TOOLS).tools).toEqual(["hr.people"]);
    // « alarmes » ne doit pas matcher « alarmement » ni un mot contenant « gtb ».
    expect(planQuestion("Etat du désalarmement", TOOLS).mode).toBe("HELP");
  });

  it("références de pièces : mode consultation, sans doublon", () => {
    expect(extractReferences("où en est da-2026-0007 et DA-2026-0007 / FF-2026-0012 ?")).toEqual(["DA-2026-0007", "FF-2026-0012"]);
    expect(planQuestion("statut de BC-2026-0003", TOOLS)).toEqual({ mode: "LOOKUP", tools: [], references: ["BC-2026-0003"] });
  });

  it("synthèse générale ou question hors périmètre : jamais de réponse inventée", () => {
    expect(planQuestion("Fais-moi une synthèse", TOOLS).mode).toBe("BRIEFING");
    expect(planQuestion("Quelle est la capitale du Congo ?", TOOLS)).toEqual({ mode: "HELP", tools: [], references: [] });
  });

  it("formats français déterministes et rendu empreint", () => {
    expect(formatAmount("1234567.5", "USD")).toBe("1 234 567,50 USD");
    expect(formatAmount("-12.00")).toBe("-12,00");
    expect(formatDay(new Date("2026-09-25T10:00:00Z"))).toBe("25/09/2026");
    const text = renderAnswer([{ title: "Finance", lines: [{ text: "2 factures échues", cites: [1, 2] }, { text: "Aucune autre", cites: [] }] }]);
    expect(text).toBe("Finance\n• 2 factures échues [1][2]\n• Aucune autre");
    expect(createHash("sha256").update(text, "utf8").digest("hex")).toHaveLength(64);
  });
});
