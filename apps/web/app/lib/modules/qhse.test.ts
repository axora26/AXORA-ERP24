import { describe, expect, it } from "vitest";
import { parseChecklist } from "./qhse";

describe("checklist QHSE", () => {
  it("une ligne par point, '!' marque un point critique, lignes vides ignorees", () => {
    expect(parseChecklist("Port des EPI\n\n! Garde-corps en place\n  Extincteurs  \n!")).toEqual([
      { label: "Port des EPI", critical: false },
      { label: "Garde-corps en place", critical: true },
      { label: "Extincteurs", critical: false },
    ]);
  });
});
