import { PROJECT_PERMISSIONS } from "@axora24/contracts";
import { Prisma } from "@axora24/database";
import { amountsByCurrency, countKpi, moneyKpi, type DashboardSection } from "../section.js";
import { percent, sumDecimals } from "../../common/decimal.js";

export const projectsSection: DashboardSection = {
  key: "projects",
  permission: PROJECT_PERMISSIONS.PROJECT_READ,
  async build(prisma, scope) {
    const active = await prisma.project.findMany({
      where: { ...scope, status: { in: ["PLANNED", "IN_PROGRESS", "ON_HOLD"] } },
      select: {
        id: true,
        currency: true,
        status: true,
        budgetLines: { select: { amount: true } },
        changeOrders: { where: { status: "APPROVED" }, select: { amount: true } },
        tasks: { select: { status: true, weight: true } },
      },
    });
    const byCurrency = new Map<string, Prisma.Decimal>();
    let totalWeight = new Prisma.Decimal(0);
    let doneWeight = new Prisma.Decimal(0);
    for (const project of active) {
      const revised = sumDecimals(project.budgetLines.map((line) => line.amount)).plus(
        sumDecimals(project.changeOrders.map((order) => order.amount)),
      );
      const currency = project.currency.trim();
      byCurrency.set(currency, (byCurrency.get(currency) ?? new Prisma.Decimal(0)).plus(revised));
      totalWeight = totalWeight.plus(sumDecimals(project.tasks.map((task) => task.weight)));
      doneWeight = doneWeight.plus(sumDecimals(project.tasks.filter((task) => task.status === "DONE").map((task) => task.weight)));
    }
    const inProgress = active.filter((project) => project.status === "IN_PROGRESS").length;
    return [
      countKpi({
        key: "projects.active",
        label: "Projets en cours",
        href: "/projects",
        tone: "violet",
        value: String(inProgress),
        detail: `${active.length} projet(s) actif(s) · avancement physique ${percent(doneWeight, totalWeight)} %`,
      }),
      moneyKpi({
        key: "projects.budget",
        label: "Budget révisé des projets actifs",
        href: "/projects",
        tone: "blue",
        amounts: amountsByCurrency(
          [...byCurrency.entries()].map(([currency, amount]) => ({ currency, _sum: { amount } })),
          "amount",
        ),
        detail: "Budget initial + avenants approuvés",
      }),
    ];
  },
};
