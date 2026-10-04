import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createUserWith } from "./support/fixtures.js";

describe("Employee advances: approval, repayment and audit", () => {
  let harness: Harness;
  let owner: Tenant;
  let approver: Tenant;
  let employeeId: string;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "hr-advances");
    approver = await createUserWith(
      harness,
      owner,
      ["hr.advance.read", "hr.advance.approve", "hr.advance.repay"],
      "hr-advance-approver",
    );
    const employee = await as(harness, owner).post("/hr/employees", {
      firstName: "Employé",
      lastName: "Avance",
      jobTitle: "Technicien",
      hireDate: "2026-01-01",
      contractType: "PERMANENT",
      userId: owner.userId,
      baseSalary: "3000.00",
      hourlyCost: "25.00",
    });
    expect(employee.status).toBe(201);
    employeeId = employee.body.id;
  }, 60_000);

  afterAll(async () => {
    await harness?.close();
  });

  it("keeps requester and approver distinct and caps repayments", async () => {
    const requester = as(harness, owner);
    const reviewer = as(harness, approver);
    const created = await requester.post("/hr/advances", {
      employeeId,
      amount: "1000.00",
      reason: "Équipement de chantier",
    });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe("REQUESTED");

    expect((await requester.post(`/hr/advances/${created.body.id}/approve`, {})).status).toBe(403);
    const approved = await reviewer.post(`/hr/advances/${created.body.id}/approve`, { note: "Contrôle effectué" });
    expect(approved.status).toBe(201);
    expect(approved.body.status).toBe("APPROVED");

    const overpayment = await reviewer.post(`/hr/advances/${created.body.id}/repayments`, {
      amount: "1000.01",
      method: "PAYROLL",
      repaymentDate: "2026-09-30",
    });
    expect(overpayment.status).toBe(400);

    const settled = await reviewer.post(`/hr/advances/${created.body.id}/repayments`, {
      amount: "1000.00",
      method: "PAYROLL",
      repaymentDate: "2026-09-30",
    });
    expect(settled.status).toBe(201);
    expect(settled.body.status).toBe("SETTLED");
    expect(settled.body.remainingAmount).toBe("0.00");

    const audit = await harness.prisma.auditLog.findMany({
      where: { organizationId: owner.organizationId, resourceType: "EmployeeAdvance", resourceId: created.body.id },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    expect(audit.map((row) => row.action)).toEqual([
      "hr.advance.requested",
      "hr.advance.approved",
      "hr.advance.repaid",
    ]);
  });
});
