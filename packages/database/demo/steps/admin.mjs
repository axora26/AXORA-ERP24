/** Administration DEMO : roles metier et comptes supplementaires (tous marques DEMO par l'organisation). */

export const DEMO_USERS = [
  { email: "commercial@axora-erp24.local", fullName: "Clarisse Mukendi", password: "Commercial2026!", role: "Commercial" },
  { email: "direction@axora-erp24.local", fullName: "Jean-Pierre Lukusa", password: "Direction2026!", role: "Direction (lecture)" },
];

export const adminStep = {
  name: "Administration (rôles et comptes)",
  async isDone(api) {
    const roles = await api.get("/admin/roles");
    return roles.some((role) => role.name === "Commercial");
  },
  async run(api) {
    const catalog = await api.get("/admin/permissions");
    const allKeys = catalog.flatMap((group) => group.permissions.map((permission) => permission.key));
    const readKeys = allKeys.filter((key) => key.endsWith(".read"));
    const commercialKeys = allKeys.filter(
      (key) => key.startsWith("crm.") || key.startsWith("estimation.") || key.startsWith("sales.") || key === "dashboard.overview.read",
    );

    const commercial = await api.post("/admin/roles", { name: "Commercial", permissions: commercialKeys });
    const direction = await api.post("/admin/roles", { name: "Direction (lecture)", permissions: readKeys });
    const roleIds = { Commercial: commercial.id, "Direction (lecture)": direction.id };

    const companies = await api.get("/admin/companies");
    for (const user of DEMO_USERS) {
      await api.post("/admin/users", {
        email: user.email,
        fullName: user.fullName,
        password: user.password,
        roleIds: [roleIds[user.role]],
        companyIds: [companies[0].id],
      });
    }
  },
};
