import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

/**
 * INC-09 — RH : capture -> identification -> presence -> validation -> paie.
 * Les heures ne sont valorisees (projet, paie) qu'apres validation par un tiers.
 */
describe("Ressources humaines (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let worker: Tenant;
  let manager: Tenant;
  let project: { projectId: string; leafId: string; parentId: string };
  let employeeA = "";
  let employeeB = "";
  let sheetA = "";
  let sheetB = "";
  let payrollId = "";
  let leaveA = "";

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "hr-a");
    other = await registerTenant(harness, "hr-b");
    project = await createStartedProject(harness, owner);
    worker = await createUserWith(
      harness,
      owner,
      ["hr.employee.read", "hr.timesheet.manage", "hr.leave.request", "hr.attendance.create"],
      "ouvrier",
    );
    manager = await createUserWith(harness, owner, ["hr.employee.read", "hr.timesheet.validate", "hr.leave.approve"], "chef");
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("employes : numerotation, badge unique, montants exacts, donnees salariales masquees sans hr.payroll.read", async () => {
    const departments = await api().post("/hr/departments", { code: "trv", name: "Travaux" });
    expect(departments.status).toBe(201);
    const departmentId = departments.body.find((department: { code: string }) => department.code === "TRV").id;
    expect((await api().post("/hr/departments", { code: "TRV", name: "Doublon" })).status).toBe(409);

    const base = { jobTitle: "Electricien", hireDate: "2026-01-05", contractType: "PERMANENT", departmentId };
    expect((await api().post("/hr/employees", { ...base, firstName: "A", lastName: "B", hourlyCost: 25 })).status).toBe(400);
    const a = await api().post("/hr/employees", {
      ...base,
      firstName: "Amani",
      lastName: "Kabila",
      userId: worker.userId,
      badgeCode: "BADGE-001",
      hourlyCost: "25.00",
      baseSalary: "3000.00",
    });
    expect(a.status).toBe(201);
    expect(a.body.code).toMatch(/^EMP-\d{4}-\d{4}$/);
    expect(a.body.hourlyCost).toBe("25.00");
    expect(a.body.currency).toBe("USD");
    employeeA = a.body.id;
    expect((await api().post("/hr/employees", { ...base, firstName: "X", lastName: "Y", badgeCode: "BADGE-001" })).status).toBe(409);

    const b = await api().post("/hr/employees", { ...base, firstName: "Bea", lastName: "Mulumba", jobTitle: "Soudeuse", baseSalary: "2400.00" });
    expect(b.status).toBe(201);
    employeeB = b.body.id;

    const skill = await api().post(`/hr/employees/${employeeA}/skills`, { name: "Habilitation electrique B2V", level: 4, certifiedUntil: "2026-03-31" });
    expect(skill.status).toBe(201);
    expect(skill.body.skills[0]).toMatchObject({ level: 4, expired: true });
    expect((await api().post(`/hr/employees/${employeeA}/skills`, { name: "Hauteur", level: 9 })).status).toBe(400);

    const seenByManager = await as(harness, manager).get("/hr/employees");
    expect(seenByManager.status).toBe(200);
    const masked = seenByManager.body.find((employee: { id: string }) => employee.id === employeeA);
    expect(masked.hourlyCost).toBeNull();
    expect(masked.baseSalary).toBeNull();
    expect((await as(harness, worker).post("/hr/employees", { ...base, firstName: "No", lastName: "Right" })).status).toBe(403);
  });

  it("isolation : aucune donnee RH visible ni pointable depuis un autre tenant", async () => {
    const list = await as(harness, other).get("/hr/employees");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(0);
    expect((await as(harness, other).post("/hr/attendance/scan", { badgeCode: "BADGE-001", type: "IN" })).status).toBe(404);
    expect((await as(harness, other).post("/hr/timesheets", { employeeId: employeeA, weekStart: "2026-09-14" })).status).toBe(404);
  });

  it("presence : identification par badge, sequence entree/sortie coherente, evenements append-only", async () => {
    expect((await as(harness, worker).post("/hr/attendance/scan", { badgeCode: "INCONNU", type: "IN" })).status).toBe(404);
    const clockIn = await as(harness, worker).post("/hr/attendance/scan", {
      badgeCode: "BADGE-001",
      type: "IN",
      occurredAt: "2026-09-14T07:00:00Z",
      projectId: project.projectId,
    });
    expect(clockIn.status).toBe(201);
    expect(clockIn.body.source).toBe("BADGE");
    expect((await as(harness, worker).post("/hr/attendance/scan", { badgeCode: "BADGE-001", type: "IN", occurredAt: "2026-09-14T08:00:00Z" })).status).toBe(400);
    const clockOut = await as(harness, worker).post("/hr/attendance/scan", { badgeCode: "BADGE-001", type: "OUT", occurredAt: "2026-09-14T15:30:00Z" });
    expect(clockOut.status).toBe(201);
    expect((await api().post("/hr/attendance", { employeeId: employeeB, type: "OUT", occurredAt: "2026-09-14T15:30:00Z" })).status).toBe(400);
    expect((await api().post("/hr/attendance", { employeeId: employeeB, type: "IN", occurredAt: "2099-01-01T08:00:00Z" })).status).toBe(400);
    expect((await as(harness, manager).post("/hr/attendance", { employeeId: employeeB, type: "IN" })).status).toBe(403);

    await expect(
      harness.prisma.attendanceEvent.update({ where: { id: clockIn.body.id }, data: { occurredAt: new Date("2026-09-14T06:00:00Z") } }),
    ).rejects.toThrow(/append-only/);
    await expect(harness.prisma.attendanceEvent.delete({ where: { id: clockOut.body.id } })).rejects.toThrow(/append-only/);
    expect((await api().patch(`/hr/attendance/${clockIn.body.id}`, { type: "OUT" })).status).toBe(404);
  });

  it("feuille de temps : semaine normalisee au lundi, saisie controlee, heures de pointage en regard", async () => {
    const created = await as(harness, worker).post("/hr/timesheets", { employeeId: employeeA, weekStart: "2026-09-16" });
    expect(created.status).toBe(201);
    expect(created.body.weekStart.slice(0, 10)).toBe("2026-09-14");
    sheetA = created.body.id;
    expect((await as(harness, worker).post("/hr/timesheets", { employeeId: employeeA, weekStart: "2026-09-18" })).status).toBe(409);

    const put = (entries: unknown[]) => as(harness, worker).put(`/hr/timesheets/${sheetA}/entries`, { entries });
    expect((await put([{ workDate: "2026-09-21", hours: "8" }])).status).toBe(400);
    expect((await put([{ workDate: "2026-09-14", hours: 8 }])).status).toBe(400);
    expect((await put([{ workDate: "2026-09-14", hours: "14" }, { workDate: "2026-09-14", hours: "11" }])).status).toBe(400);
    expect((await put([{ workDate: "2026-09-14", hours: "8", projectId: project.projectId, wbsItemId: project.parentId }])).status).toBe(400);

    const saved = await put([
      { workDate: "2026-09-14", hours: "8", projectId: project.projectId, wbsItemId: project.leafId, description: "Tirage de cables" },
      { workDate: "2026-09-15", hours: "7.5", projectId: project.projectId, description: "Raccordements" },
    ]);
    expect(saved.status).toBe(200);
    expect(saved.body.totalHours).toBe("15.50");
    expect(saved.body.attendanceHours).toBe("8.50");
    expect(saved.body.entries.every((entry: { costAmount: string | null }) => entry.costAmount === null)).toBe(true);

    const submitted = await as(harness, worker).post(`/hr/timesheets/${sheetA}/submit`);
    expect(submitted.status).toBe(201);
    expect(submitted.body.status).toBe("SUBMITTED");
    expect((await put([{ workDate: "2026-09-14", hours: "1" }])).status).toBe(400);
  });

  it("separation des devoirs : ni l'employe ni l'auteur de la soumission ne valident", async () => {
    expect((await as(harness, worker).post(`/hr/timesheets/${sheetA}/validate`)).status).toBe(403);

    const created = await api().post("/hr/timesheets", { employeeId: employeeB, weekStart: "2026-09-14" });
    sheetB = created.body.id;
    await api().put(`/hr/timesheets/${sheetB}/entries`, { entries: [{ workDate: "2026-09-16", hours: "4" }] });
    expect((await api().post(`/hr/timesheets/${sheetB}/submit`)).status).toBe(201);
    // Le proprietaire a toutes les permissions mais a soumis la feuille : refuse.
    expect((await api().post(`/hr/timesheets/${sheetB}/validate`)).status).toBe(403);
    expect((await as(harness, manager).post(`/hr/timesheets/${sheetB}/reject`, {})).status).toBe(400);
    const rejected = await as(harness, manager).post(`/hr/timesheets/${sheetB}/reject`, { note: "Chantier manquant" });
    expect(rejected.body.status).toBe("REJECTED");
  });

  it("validation : cout fige (heures x cout horaire) et impute au consomme du projet", async () => {
    const before = (await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed;
    expect(before.amount).toBe("0.00");
    const validated = await as(harness, manager).post(`/hr/timesheets/${sheetA}/validate`, { note: "OK" });
    expect(validated.status).toBe(201);
    expect(validated.body.status).toBe("VALIDATED");
    expect(validated.body.entries.map((entry: { costAmount: string }) => entry.costAmount)).toEqual(["200.00", "187.50"]);
    const after = (await api().get(`/projects/${project.projectId}`)).body.cockpit.consumed;
    expect(after.amount).toBe("387.50");
    expect(after.source).toContain("temps passés validés");
    expect((await as(harness, manager).post(`/hr/timesheets/${sheetA}/validate`)).status).toBe(400);
  });

  it("conges : jours ouvres calcules par le serveur, chevauchement refuse, decision par un tiers", async () => {
    const requested = await as(harness, worker).post("/hr/leaves", { employeeId: employeeA, type: "PAID", startDate: "2026-10-01", endDate: "2026-10-07" });
    expect(requested.status).toBe(201);
    const leave = requested.body.find((item: { employeeId: string }) => item.employeeId === employeeA);
    leaveA = leave.id;
    expect(leave.days).toBe("5.0");
    expect((await as(harness, worker).post("/hr/leaves", { employeeId: employeeA, type: "PAID", startDate: "2026-10-06", endDate: "2026-10-09" })).status).toBe(409);
    expect((await as(harness, worker).post("/hr/leaves", { employeeId: employeeA, type: "PAID", startDate: "2026-10-03", endDate: "2026-10-04" })).status).toBe(400);
    expect((await as(harness, worker).post(`/hr/leaves/${leaveA}/approve`)).status).toBe(403);

    const ownLeave = await api().post("/hr/leaves", { employeeId: employeeB, type: "TRAINING", startDate: "2026-10-12", endDate: "2026-10-12" });
    const ownId = ownLeave.body.find((item: { employeeId: string }) => item.employeeId === employeeB).id;
    expect((await api().post(`/hr/leaves/${ownId}/approve`)).status).toBe(403);

    const approved = await as(harness, manager).post(`/hr/leaves/${leaveA}/approve`);
    expect(approved.status).toBe(201);
    expect(approved.body.find((item: { id: string }) => item.id === leaveA).status).toBe("APPROVED");
    expect((await as(harness, manager).post(`/hr/leaves/${leaveA}/approve`)).status).toBe(400);
  });

  it("paie : refusee tant qu'une feuille de la periode n'est pas validee, aucune retenue legale presumee", async () => {
    const blocked = await api().post("/hr/payroll", { period: "2026-09" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toContain("not validated");
    expect((await api().post("/hr/payroll", { period: "2026-13" })).status).toBe(400);

    await api().put(`/hr/timesheets/${sheetB}/entries`, { entries: [{ workDate: "2026-09-16", hours: "4", projectId: project.projectId }] });
    await api().post(`/hr/timesheets/${sheetB}/submit`);
    expect((await as(harness, manager).post(`/hr/timesheets/${sheetB}/validate`)).status).toBe(201);

    const run = await api().post("/hr/payroll", { period: "2026-09" });
    expect(run.status).toBe(201);
    payrollId = run.body.id;
    expect(run.body.statutoryDeductions).toBe("NOT_CONFIGURED");
    expect(run.body.currency).toBe("USD");
    const lineA = run.body.lines.find((line: { employeeId: string }) => line.employeeId === employeeA);
    expect(lineA).toMatchObject({ baseSalary: "3000.00", validatedHours: "15.50", grossAmount: "3000.00" });
    expect(run.body.totalGross).toBe("5400.00");
    expect((await api().post("/hr/payroll", { period: "2026-09" })).status).toBe(409);
    expect((await as(harness, manager).get("/hr/payroll")).status).toBe(403);
  });

  it("paie : elements variables explicites, brut jamais negatif, cloture definitive", async () => {
    expect((await api().post(`/hr/payroll/${payrollId}/adjustments`, { employeeId: employeeA, amount: 150, label: "Prime" })).status).toBe(400);
    const adjusted = await api().post(`/hr/payroll/${payrollId}/adjustments`, { employeeId: employeeA, amount: "150.00", label: "Prime chantier" });
    expect(adjusted.status).toBe(201);
    const lineA = adjusted.body.lines.find((line: { employeeId: string }) => line.employeeId === employeeA);
    expect(lineA.grossAmount).toBe("3150.00");
    expect(lineA.adjustmentNotes).toContain("Prime chantier");
    expect((await api().post(`/hr/payroll/${payrollId}/adjustments`, { employeeId: employeeA, amount: "-5000.00", label: "Retenue" })).status).toBe(400);

    const closed = await api().post(`/hr/payroll/${payrollId}/close`);
    expect(closed.body.status).toBe("CLOSED");
    expect(closed.body.totalGross).toBe("5550.00");
    expect((await api().post(`/hr/payroll/${payrollId}/adjustments`, { employeeId: employeeA, amount: "10.00", label: "Tardif" })).status).toBe(400);

    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "hr." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["hr.employee.created", "hr.attendance.recorded", "hr.timesheet.validated", "hr.leave.approved", "hr.payroll.closed"]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
