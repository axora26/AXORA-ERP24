/**
 * ANALYTIQUE DEMO : la Direction et la DAF recoivent la lecture analytique
 * (chaque indicateur reste filtre par leurs droits de lecture existants) ;
 * deux mois figes et un tableau de bord partage « Pilotage direction ».
 */
export const analyticsStep = {
  name: "Analyses & BI (instantanés, tableau de bord partagé)",
  async isDone(api) {
    return (await api.get("/analytics/dashboards")).length > 0;
  },
  async run(api) {
    const roles = await api.get("/admin/roles");
    for (const name of ["Direction (lecture)", "Contrôle de gestion (DAF)"]) {
      const role = roles.find((candidate) => candidate.name === name);
      if (role && !role.permissions.includes("analytics.report.read")) {
        await api.put(`/admin/roles/${role.id}/permissions`, { permissions: [...role.permissions, "analytics.report.read"] });
      }
    }
    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    await api.post("/analytics/snapshots", { period: previous });
    await api.post("/analytics/snapshots", { period: now.toISOString().slice(0, 7) });
    await api.post("/analytics/dashboards", {
      name: "Pilotage direction",
      metrics: ["finance.invoiced", "finance.collected", "finance.disbursed", "procurement.ordered", "qhse.findings", "assets.workorders", "energy.balance"],
      shared: true,
    });
  },
};
