import { describe, expect, it } from "vitest";
import { PrintableDocument } from "../src/common/printable-document.js";

describe("PrintableDocument premium", () => {
  it("produit un PDF A4 ouvrable avec les blocs métier premium", async () => {
    const document = new PrintableDocument("DEVIS", "DEV-DEMO-001", "AXORA GROUP", true);
    document.parties(
      { name: "AXORA GROUP", address: "945, Boulevard du 30 Juin, Gombe, Kinshasa", details: ["NIF : [à renseigner]"] },
      { name: "CLIENT DÉMONSTRATION", address: "Kinshasa, RDC" },
    );
    document.metaGrid([
      ["Date", "06/10/2026"],
      ["Chantier", "Immeuble Démonstration"],
    ]);
    document.notice("DÉMONSTRATION — données fictives", "warning");
    document.table(
      [
        { label: "Désignation", width: 343 },
        { label: "Montant", width: 180, align: "right" },
      ],
      [["Installation de chantier", "1 000,00 USD"]],
    );
    document.totals([
      ["Sous-total", "1 000,00 USD"],
      ["Net à payer", "1 000,00 USD", true],
    ]);
    document.signatures(["Émetteur", "Client"]);

    const buffer = await document.finish();

    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.byteLength).toBeGreaterThan(4_000);
    expect((buffer.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
  });
});
