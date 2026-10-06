import { describe, expect, it } from "vitest";
import { NAV_GROUPS, visibleGroups } from "../lib/navigation";

describe("navigation premium", () => {
  it("range toutes les entrées dans l’ordre métier attendu", () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      "Accueil",
      "Commercial",
      "Chantiers",
      "Achats & stock",
      "Finance & comptabilité",
      "Personnel",
      "Ingénierie & exploitation",
      "Pilotage",
      "Administration",
    ]);
    expect(NAV_GROUPS.flatMap((group) => group.items)).toHaveLength(35);
  });

  it("conserve le filtrage par permission, y compris lorsqu’une permission parmi plusieurs suffit", () => {
    const denied = visibleGroups(() => false).flatMap((group) => group.items);
    expect(denied.map((item) => item.href)).toEqual(["/", "/account"]);

    const granted = visibleGroups((permission) => permission === "crm.contact.read").flatMap((group) => group.items);
    expect(granted.some((item) => item.href === "/crm")).toBe(true);
    expect(granted.some((item) => item.href === "/admin/users")).toBe(false);
  });
});
