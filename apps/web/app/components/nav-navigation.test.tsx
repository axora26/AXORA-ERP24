import { describe, expect, it } from "vitest";
import { NAV_GROUPS, visibleGroups } from "../lib/navigation";

describe("navigation premium", () => {
  it("range toutes les entrées dans l’ordre métier attendu", () => {
    expect(NAV_GROUPS.map((group) => group.label)).toEqual([
      "Accueil",
      "Gestion commerciale",
      "Chantiers",
      "Achats & stock",
      "Finance & comptabilité",
      "Personnel",
      "Ingénierie & exploitation",
      "Pilotage",
      "Administration",
    ]);
    expect(NAV_GROUPS.flatMap((group) => group.items)).toHaveLength(37);
    const commercial = NAV_GROUPS.find((group) => group.label === "Gestion commerciale");
    expect(commercial?.items.map((item) => item.href)).toEqual(["/commercial", "/crm", "/estimation", "/sales"]);
    expect(commercial?.items[0]?.permission).toEqual([
      "crm.account.read",
      "estimation.dqe.read",
      "sales.quote.read",
      "sales.contract.read",
      "procurement.request.read",
      "procurement.order.read",
      "procurement.supplier.read",
      "inventory.item.read",
      "finance.invoice.read",
      "finance.payable.read",
      "finance.credit.read",
    ]);
    expect(commercial?.items.find((item) => item.href === "/sales")?.permission).toEqual(["sales.quote.read", "sales.contract.read"]);
    const security = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === "/admin/security");
    expect(security?.permission).toBe("core.organization.manage");
  });

  it("conserve le filtrage par permission, y compris lorsqu’une permission parmi plusieurs suffit", () => {
    const denied = visibleGroups(() => false).flatMap((group) => group.items);
    expect(denied.map((item) => item.href)).toEqual(["/", "/account"]);

    const granted = visibleGroups((permission) => permission === "crm.contact.read").flatMap((group) => group.items);
    expect(granted.some((item) => item.href === "/crm")).toBe(true);
    expect(granted.some((item) => item.href === "/admin/users")).toBe(false);

    for (const [permission, expected] of [
      ["sales.contract.read", ["/commercial", "/sales"]],
      ["procurement.order.read", ["/commercial", "/procurement"]],
      ["procurement.supplier.read", ["/commercial", "/procurement"]],
      ["finance.payable.read", ["/commercial", "/finance"]],
      ["finance.credit.read", ["/commercial", "/finance"]],
    ] as const) {
      const hrefs = visibleGroups((candidate) => candidate === permission).flatMap((group) => group.items.map((item) => item.href));
      expected.forEach((href) => expect(hrefs).toContain(href));
    }
  });
});
