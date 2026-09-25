import { INVENTORY_PERMISSIONS } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { countKpi, moneyKpi, type DashboardSection } from "../section.js";

export const inventorySection: DashboardSection = {
  key: "inventory",
  permission: INVENTORY_PERMISSIONS.ITEM_READ,
  async build(prisma, scope) {
    const [value, items, company] = await Promise.all([
      prisma.stockBalance.aggregate({ where: scope, _sum: { value: true } }),
      prisma.inventoryItem.findMany({
        where: { ...scope, isActive: true, minStock: { gt: 0 } },
        select: { minStock: true, balances: { select: { quantity: true } } },
      }),
      prisma.company.findUniqueOrThrow({ where: { id: scope.companyId }, select: { currency: true } }),
    ]);
    const below = items.filter((item) =>
      item.balances.reduce((sum, balance) => sum.plus(balance.quantity), new Prisma.Decimal(0)).lessThan(item.minStock),
    ).length;
    return [
      moneyKpi({
        key: "inventory.value",
        label: "Valeur du stock (coût moyen)",
        href: "/inventory",
        tone: "blue",
        // Le stock est valorise dans la devise de reference de l'entreprise.
        amounts: [{ currency: company.currency.trim(), amount: new Prisma.Decimal(value._sum.value ?? 0).toFixed(2) }],
        detail: "Tous magasins et chantiers",
      }),
      countKpi({
        key: "inventory.belowMinimum",
        label: "Articles sous le seuil",
        href: "/inventory",
        tone: below > 0 ? "red" : "green",
        value: String(below),
        detail: "Réapprovisionnement à prévoir",
      }),
    ];
  },
};
