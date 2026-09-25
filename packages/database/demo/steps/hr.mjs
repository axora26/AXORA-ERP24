import { createClient } from "../client.mjs";
import { DEMO_USERS } from "./admin.mjs";

const DAY_MS = 86_400_000;

function mondayOf(date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  copy.setUTCDate(copy.getUTCDate() - ((copy.getUTCDay() + 6) % 7));
  return copy;
}

const iso = (date) => date.toISOString().slice(0, 10);

const EMPLOYEES = [
  { firstName: "Patrick", lastName: "Ilunga", jobTitle: "Chef de chantier", department: "TRV", badge: "B-1001", hourlyCost: "32.00", baseSalary: "4200.00", skills: [["Travail en hauteur", 4, "2027-03-31"]] },
  { firstName: "Grace", lastName: "Mbuyi", jobTitle: "Électricienne CFO/CFA", department: "TRV", badge: "B-1002", hourlyCost: "24.50", baseSalary: "2900.00", skills: [["Habilitation électrique BR", 4, "2026-06-30"]] },
  { firstName: "Didier", lastName: "Kasongo", jobTitle: "Frigoriste CVC", department: "TRV", badge: "B-1003", hourlyCost: "26.00", baseSalary: "3100.00", skills: [["Manipulation fluides frigorigènes", 3, "2027-11-15"]] },
  { firstName: "Esther", lastName: "Tshibanda", jobTitle: "Ingénieure études", department: "ETU", badge: "B-1004", hourlyCost: "38.00", baseSalary: "5200.00", skills: [["Revit MEP", 5, null]] },
  { firstName: "Joël", lastName: "Mutombo", jobTitle: "Magasinier", department: "LOG", badge: "B-1005", hourlyCost: "15.00", baseSalary: "1600.00", skills: [["CACES R489", 3, "2028-01-31"]] },
];

/**
 * RH DEMO : effectif, badges, pointages, feuilles de temps validees par la
 * direction (cout impute au projet), conges et une paie preparee sans
 * aucune retenue legale presumee.
 */
export const hrStep = {
  name: "Ressources humaines (effectif, temps, congés, paie)",
  async isDone(api) {
    const employees = await api.get("/hr/employees");
    return employees.length > 0;
  },
  async run(api) {
    const roles = await api.get("/admin/roles");
    const direction = roles.find((role) => role.name === "Direction (lecture)");
    const needed = ["hr.timesheet.validate", "hr.leave.approve"];
    if (direction && needed.some((key) => !direction.permissions.includes(key))) {
      await api.put(`/admin/roles/${direction.id}/permissions`, { permissions: [...new Set([...direction.permissions, ...needed])] });
    }
    const directionUser = DEMO_USERS.find((user) => user.role === "Direction (lecture)");
    const directionApi = createClient(api.baseUrl);
    await directionApi.post("/auth/login", { email: directionUser.email, password: directionUser.password });

    await api.post("/hr/departments", { code: "TRV", name: "Travaux" });
    await api.post("/hr/departments", { code: "ETU", name: "Bureau d'études" });
    const departments = await api.post("/hr/departments", { code: "LOG", name: "Logistique" });
    const departmentId = (code) => departments.find((department) => department.code === code).id;

    const ids = {};
    for (const person of EMPLOYEES) {
      const employee = await api.post("/hr/employees", {
        firstName: person.firstName,
        lastName: person.lastName,
        jobTitle: person.jobTitle,
        departmentId: departmentId(person.department),
        hireDate: "2025-02-03",
        contractType: "PERMANENT",
        badgeCode: person.badge,
        hourlyCost: person.hourlyCost,
        baseSalary: person.baseSalary,
      });
      ids[person.badge] = employee.id;
      for (const [name, level, certifiedUntil] of person.skills) {
        await api.post(`/hr/employees/${employee.id}/skills`, { name, level, ...(certifiedUntil ? { certifiedUntil } : {}) });
      }
    }

    const projects = await api.get("/projects");
    const project = projects.find((candidate) => candidate.status === "IN_PROGRESS") ?? projects[0];
    const detail = project ? await api.get(`/projects/${project.id}`) : null;
    const leaf = detail?.wbs.find((node) => node.isLeaf);

    // Semaine precedente : pointages badge + feuilles de temps validees par la direction.
    const lastMonday = new Date(mondayOf(new Date()).getTime() - 7 * DAY_MS);
    const day = (offset) => iso(new Date(lastMonday.getTime() + offset * DAY_MS));
    for (const offset of [0, 1, 2, 3, 4]) {
      await api.post("/hr/attendance/scan", { badgeCode: "B-1002", type: "IN", occurredAt: `${day(offset)}T06:30:00Z`, projectId: project?.id });
      await api.post("/hr/attendance/scan", { badgeCode: "B-1002", type: "OUT", occurredAt: `${day(offset)}T15:00:00Z` });
    }
    const booked = [
      ["B-1001", ["9", "9", "8.5", "9", "7"]],
      ["B-1002", ["8.5", "8.5", "8.5", "8.5", "8.5"]],
      ["B-1003", ["8", "8", "8", "8", "6"]],
    ];
    for (const [badge, hours] of booked) {
      const sheet = await api.post("/hr/timesheets", { employeeId: ids[badge], weekStart: iso(lastMonday) });
      await api.put(`/hr/timesheets/${sheet.id}/entries`, {
        entries: hours.map((value, offset) => ({
          workDate: day(offset),
          hours: value,
          projectId: project?.id,
          wbsItemId: leaf?.id,
          description: offset === 0 ? "Installation de chantier" : "Travaux lot techniques",
        })),
      });
      await api.post(`/hr/timesheets/${sheet.id}/submit`);
      await directionApi.post(`/hr/timesheets/${sheet.id}/validate`, { note: "Conforme aux pointages" });
    }

    // Paie du mois precedent : toutes les feuilles de la periode sont validees.
    const now = new Date();
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const period = `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
    const run = await api.post("/hr/payroll", { period });
    await api.post(`/hr/payroll/${run.id}/adjustments`, { employeeId: ids["B-1001"], amount: "250.00", label: "Prime de fin de phase" });
    await api.post(`/hr/payroll/${run.id}/close`);

    // En attente de validation : feuille soumise et demande de conge.
    const pending = await api.post("/hr/timesheets", { employeeId: ids["B-1004"], weekStart: iso(lastMonday) });
    await api.put(`/hr/timesheets/${pending.id}/entries`, {
      entries: [0, 1, 2, 3].map((offset) => ({ workDate: day(offset), hours: "7.5", projectId: project?.id, description: "Synthèse MEP et notes de calcul" })),
    });
    await api.post(`/hr/timesheets/${pending.id}/submit`);

    const nextMonday = new Date(mondayOf(new Date()).getTime() + 14 * DAY_MS);
    const approved = await api.post("/hr/leaves", {
      employeeId: ids["B-1003"],
      type: "PAID",
      startDate: iso(nextMonday),
      endDate: iso(new Date(nextMonday.getTime() + 4 * DAY_MS)),
      reason: "Congés annuels",
    });
    await directionApi.post(`/hr/leaves/${approved[0].id}/approve`, { note: "Remplacement assuré" });
    await api.post("/hr/leaves", {
      employeeId: ids["B-1005"],
      type: "TRAINING",
      startDate: iso(new Date(nextMonday.getTime() + 7 * DAY_MS)),
      endDate: iso(new Date(nextMonday.getTime() + 8 * DAY_MS)),
      reason: "Recyclage CACES",
    });

    // Presence du jour (maintenant) : equipe sur site.
    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    for (const badge of ["B-1001", "B-1002", "B-1003"]) {
      await api.post("/hr/attendance/scan", { badgeCode: badge, type: "IN", occurredAt, projectId: project?.id });
    }
  },
};
