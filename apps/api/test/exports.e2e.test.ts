import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrintableDocument } from "../src/common/printable-document.js";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

function binary(response: IncomingMessage, done: (error: Error | null, value: Buffer) => void): void {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => done(null, Buffer.concat(chunks)));
  response.on("error", (error) => done(error, Buffer.alloc(0)));
}

describe("Protected document exports (real AppModule)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let denied: Tenant;
  let allReader: Tenant;
  let companyB: string;
  let dqeId: string;
  let employeeId: string;
  let excludedEmployeeId: string;
  let payrollId: string;
  let customerCreditId: string;
  let supplierCreditId: string;
  let projectId: string;
  let qrPayload: string;
  const readers = new Map<string, Tenant>();
  const previousKey = process.env.SERVICE_CARD_ENCRYPTION_KEY;
  const today = new Date().toISOString().slice(0, 10);
  const grants = ["estimation.dqe.read", "hr.card.manage", "hr.payroll.read", "finance.credit.read", "finance.payable.read", "projects.project.read"];
  const routes = () => [
    { name: "DQE PDF", path: `/estimation/dqes/${dqeId}/export.pdf`, grant: "estimation.dqe.read" },
    { name: "Service card", path: `/hr/employees/${employeeId}/service-card/export.pdf`, grant: "hr.card.manage" },
    { name: "Payroll slip", path: `/hr/payroll/${payrollId}/employees/${employeeId}/export.pdf`, grant: "hr.payroll.read" },
    { name: "Customer credit", path: `/finance/customer-credit-notes/${customerCreditId}/export.pdf`, grant: "finance.credit.read" },
    { name: "Supplier credit", path: `/finance/supplier-credit-notes/${supplierCreditId}/export.pdf`, grant: "supplier" },
    { name: "Project operations", path: `/projects/${projectId}/operations/export.pdf?from=2026-09-01&to=2026-09-30`, grant: "projects.project.read" },
  ];
  const scoped = (path: string, companyId: string) => `${path}${path.includes("?") ? "&" : "?"}companyId=${companyId}`;

  beforeAll(async () => {
    process.env.SERVICE_CARD_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    harness = await createHarness();
    owner = await registerTenant(harness, "document-exports");
    other = await registerTenant(harness, "document-exports-other");
    denied = await createUserWith(harness, owner, ["crm.lead.read"], "exports-denied");
    allReader = await createUserWith(harness, owner, grants, "exports-reader");
    for (const grant of grants) readers.set(grant, await createUserWith(harness, owner, [grant], `export-${grant.replaceAll(".", "-")}`));
    readers.set("supplier", await createUserWith(harness, owner, ["finance.credit.read", "finance.payable.read"], "export-supplier"));
    const api = as(harness, owner);
    projectId = (await createStartedProject(harness, owner)).projectId;
    const lead = await api.post("/crm/leads", { contactName: "Exact export", companyName: "Exact export client" });
    expect(lead.status).toBe(201);
    const opportunity = await api.post(`/crm/leads/${lead.body.id}/convert`, { amount: "1000000.00" });
    expect(opportunity.status).toBe(201);
    const study = await api.post("/estimation/studies", { opportunityId: opportunity.body.id, code: "ST-EXPORT", title: "Exact export", objective: "Verify exact decimals" });
    expect(study.status).toBe(201);
    expect((await api.post(`/estimation/studies/${study.body.id}/requirements`, { position: 1, category: "FACT", statement: "Exact source quantity" })).status).toBe(201);
    expect((await api.post(`/estimation/studies/${study.body.id}/ready`)).status).toBe(201);
    const dqe = await api.post("/estimation/dqes", { studyId: study.body.id, code: "DQE-EXPORT", title: "Exact source decimals", currency: "USD" });
    expect(dqe.status).toBe(201);
    dqeId = dqe.body.id;
    expect((await api.post(`/estimation/dqes/${dqeId}/lines`, { position: 1, designation: "Quantity beyond Excel numeric precision", unitCode: "u", quantity: "123456789012.123456", unitPrice: "0.000001" })).status).toBe(201);

    const employee = await api.post("/hr/employees", { firstName: "Alice", lastName: "Printable", jobTitle: "Technicienne", hireDate: "2026-01-01", contractType: "PERMANENT", baseSalary: "3000.00", hourlyCost: "25.00" });
    expect(employee.status).toBe(201);
    employeeId = employee.body.id;
    const card = await api.post(`/hr/employees/${employeeId}/service-card`, {});
    expect(card.status).toBe(201);
    qrPayload = card.body.qrPayload;
    const future = await api.post("/hr/employees", { firstName: "Future", lastName: "Excluded", jobTitle: "Technicien", hireDate: "2027-01-01", contractType: "PERMANENT", baseSalary: "1000.00", hourlyCost: "10.00" });
    expect(future.status).toBe(201);
    excludedEmployeeId = future.body.id;
    const payroll = await api.post("/hr/payroll", { period: "2026-09" });
    expect(payroll.status).toBe(201);
    payrollId = payroll.body.id;

    const invoice = await api.post("/finance/invoices", { customerName: "Export customer", currency: "USD", lines: [{ description: "Source line", quantity: "2", unitPrice: "100.00" }] });
    expect(invoice.status).toBe(201);
    expect((await api.post(`/finance/invoices/${invoice.body.id}/issue`, { issueDate: today })).status).toBe(201);
    const customer = await api.post("/finance/customer-credit-notes", { invoiceId: invoice.body.id, reason: "Export credit", lines: [{ sourceInvoiceLineId: invoice.body.lines[0].id, quantity: "1" }] });
    expect(customer.status).toBe(201);
    customerCreditId = customer.body.id;
    expect((await api.post(`/finance/customer-credit-notes/${customerCreditId}/issue`, { expectedVersion: customer.body.version, issueDate: today })).status).toBe(201);
    const scope = { organizationId: owner.organizationId, companyId: owner.companyId };
    const supplier = await harness.prisma.supplier.create({ data: { ...scope, code: "SUP-EXPORT", name: "Export supplier" } });
    const supplierInvoice = await harness.prisma.supplierInvoice.create({ data: { ...scope, code: "FRA-EXPORT", supplierId: supplier.id, supplierReference: "REF-EXPORT", currency: "USD", invoiceDate: new Date(today), dueDate: new Date(today), matchStatus: "NO_ORDER", subtotal: "100", taxTotal: "20", total: "120", recordedByUserId: owner.userId } });
    const supplierLine = await harness.prisma.supplierInvoiceLine.create({ data: { ...scope, invoiceId: supplierInvoice.id, position: 1, description: "Supplier source", quantity: "2", unitPrice: "50", taxRate: "20", lineTotal: "100", lineTax: "20" } });
    await harness.prisma.supplierInvoice.update({ where: { id: supplierInvoice.id }, data: { status: "APPROVED" } });
    const supplierNote = await api.post("/finance/supplier-credit-notes", { invoiceId: supplierInvoice.id, reason: "Supplier export credit", lines: [{ sourceInvoiceLineId: supplierLine.id, quantity: "1" }] });
    expect(supplierNote.status).toBe(201);
    supplierCreditId = supplierNote.body.id;
    expect((await api.post(`/finance/supplier-credit-notes/${supplierCreditId}/issue`, { expectedVersion: supplierNote.body.version, issueDate: today })).status).toBe(201);
    companyB = (await harness.prisma.company.create({ data: { organizationId: owner.organizationId, name: "Other export company" } })).id;
    await harness.prisma.companyMembership.create({ data: { userId: allReader.userId, companyId: companyB } });
  }, 60_000);
  afterAll(async () => {
    await harness?.close();
    if (previousKey === undefined) delete process.env.SERVICE_CARD_ENCRYPTION_KEY;
    else process.env.SERVICE_CARD_ENCRYPTION_KEY = previousKey;
  });

  it("rejects anonymous, inadequate grants, other tenants and other companies for every PDF", async () => {
    for (const route of routes()) {
      expect((await harness.http().get(`/api/v1${route.path}`)).status, `${route.name}: anonymous`).toBe(401);
      expect((await as(harness, denied).get(route.path)).status, `${route.name}: grant`).toBe(403);
      expect((await as(harness, other).get(route.path)).status, `${route.name}: tenant`).toBe(404);
      expect((await as(harness, allReader).get(scoped(route.path, companyB))).status, `${route.name}: company`).toBe(404);
      expect((await as(harness, readers.get(route.grant)!).get(scoped(route.path, companyB))).status, `${route.name}: membership`).toBe(403);
    }
  });

  it("allows each least-privilege PDF grant, validates the binary signature and disables caching", async () => {
    for (const route of routes()) {
      const response = await as(harness, readers.get(route.grant)!).get(route.path).buffer(true).parse(binary);
      expect(response.status, route.name).toBe(200);
      expect(response.headers["content-type"], route.name).toContain("application/pdf");
      expect(response.headers["cache-control"], route.name).toBe("private, no-store");
      expect(response.headers["content-disposition"], route.name).toMatch(/^attachment; filename=".+\.pdf"$/);
      expect(Buffer.isBuffer(response.body), route.name).toBe(true);
      expect(response.body.subarray(0, 4).toString("ascii"), route.name).toBe("%PDF");
    }
  });

  it("never exposes card credentials to employee readers or payroll readers", async () => {
    const employeeReader = await createUserWith(harness, owner, ["hr.employee.read"], "export-safe-hr");
    const metadata = await as(harness, employeeReader).get(`/hr/employees/${employeeId}/service-cards`);
    expect(metadata.status).toBe(200);
    expect(JSON.stringify(metadata.body)).not.toContain(qrPayload.slice("AXORA-CARD:v1:".length));
    for (const reader of [employeeReader, readers.get("hr.payroll.read")!]) {
      const response = await as(harness, reader).get(`/hr/employees/${employeeId}/service-card/export.pdf`);
      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain(qrPayload);
    }
  });

  it("requires both supplier-credit and payable reading, and a payroll employee belonging to the run", async () => {
    const path = `/finance/supplier-credit-notes/${supplierCreditId}/export.pdf`;
    for (const grant of ["finance.credit.read", "finance.payable.read"]) expect((await as(harness, readers.get(grant)!).get(path)).status).toBe(403);
    const payrollReader = readers.get("hr.payroll.read")!;
    expect((await as(harness, payrollReader).get(`/hr/payroll/${payrollId}/employees/${excludedEmployeeId}/export.pdf`)).status).toBe(404);
    expect((await as(harness, payrollReader).get(`/hr/payroll/${payrollId}/employees/${other.userId}/export.pdf`)).status).toBe(404);
    expect((await as(harness, payrollReader).get(`/hr/payroll/${other.userId}/employees/${employeeId}/export.pdf`)).status).toBe(404);
  });

  it("prints real default-policy snapshots at version zero while retaining historical absence", async () => {
    const tenant = await registerTenant(harness, "export-default-payroll");
    const api = as(harness, tenant);
    const validator = await createUserWith(harness, tenant, ["hr.timesheet.validate"], "export-payroll-validator");
    const employee = await api.post("/hr/employees", { firstName: "Default", lastName: "Snapshot", jobTitle: "Technicien", hireDate: "2026-01-01", contractType: "PERMANENT", baseSalary: "3000.00", hourlyCost: "25.00" });
    expect(employee.status).toBe(201);
    const id = employee.body.id;
    for (const [type, occurredAt] of [["IN", "2026-09-07T08:00:00Z"], ["OUT", "2026-09-07T16:00:00Z"]]) {
      expect((await api.post("/hr/attendance", { employeeId: id, type, occurredAt })).status).toBe(201);
    }
    const sheet = await api.post("/hr/timesheets", { employeeId: id, weekStart: "2026-09-07" });
    expect(sheet.status).toBe(201);
    expect((await api.post(`/hr/timesheets/${sheet.body.id}/from-attendance`, {})).status).toBe(201);
    expect((await api.post(`/hr/timesheets/${sheet.body.id}/submit`)).status).toBe(201);
    expect((await as(harness, validator).post(`/hr/timesheets/${sheet.body.id}/validate`, {})).status).toBe(201);
    const prepared = await api.post("/hr/payroll", { period: "2026-09" });
    expect(prepared.status).toBe(201);
    expect(prepared.body.policy).toMatchObject({ mode: "MONTHLY_BASE", version: 0, configured: false });
    expect(prepared.body.lines[0]).toMatchObject({ attendanceHours: "8.00", validatedHours: "8.00", automaticAmount: "3000.00" });
    expect((await harness.prisma.payrollRun.findUniqueOrThrow({ where: { id: prepared.body.id } })).policySnapshot).not.toBeNull();

    // Observe the actual renderer without replacing it: the endpoint still emits a real PDF.
    const paragraphs = vi.spyOn(PrintableDocument.prototype, "paragraph");
    try {
      const response = await api.get(`/hr/payroll/${prepared.body.id}/employees/${id}/export.pdf`).buffer(true).parse(binary);
      expect(response.status).toBe(200);
      expect(response.body.subarray(0, 4).toString("ascii")).toBe("%PDF");
      const rendered = paragraphs.mock.calls.map(([value]) => value).join("\n");
      expect(rendered).toContain("Paramètres par défaut (version 0)");
      expect(rendered).toContain("Heures de présence : 8.00 · Heures validées : 8.00");
      expect(rendered).not.toContain("historique");
      expect(rendered).toContain("Le net à payer n’est pas calculé");

      const scope = { organizationId: tenant.organizationId, companyId: tenant.companyId };
      const historical = await harness.prisma.payrollRun.create({ data: { ...scope, period: "2026-08", currency: "USD", createdByUserId: tenant.userId } });
      await harness.prisma.payrollLine.create({ data: { ...scope, runId: historical.id, employeeId: id, baseSalary: "3000.00", validatedHours: "8.00", automaticAmount: "3000.00", grossAmount: "3000.00" } });
      paragraphs.mockClear();
      const oldResponse = await api.get(`/hr/payroll/${historical.id}/employees/${id}/export.pdf`).buffer(true).parse(binary);
      expect(oldResponse.status).toBe(200);
      expect(oldResponse.body.subarray(0, 4).toString("ascii")).toBe("%PDF");
      const oldRendered = paragraphs.mock.calls.map(([value]) => value).join("\n");
      expect(oldRendered).toContain("Paramètres historiques");
      expect(oldRendered).toContain("Heures de présence : Non disponibles (historique) · Heures validées : 8.00");
      expect(oldRendered).not.toContain("Paramètres par défaut");
    } finally { paragraphs.mockRestore(); }
  });

  it("protects XLSX and keeps high-precision quantity, unit price, line and total as source strings", async () => {
    const path = `/estimation/dqes/${dqeId}/export.xlsx`;
    expect((await harness.http().get(`/api/v1${path}`)).status).toBe(401);
    expect((await as(harness, denied).get(path)).status).toBe(403);
    expect((await as(harness, other).get(path)).status).toBe(404);
    expect((await as(harness, allReader).get(scoped(path, companyB))).status).toBe(404);
    const source = (await as(harness, owner).get(`/estimation/dqes/${dqeId}`)).body;
    const response = await as(harness, readers.get("estimation.dqe.read")!).get(path).buffer(true).parse(binary);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const sheet = workbook.getWorksheet("DQE")!;
    for (const [cell, expected] of [["D9", source.lines[0].quantity], ["E9", source.lines[0].unitPrice], ["F9", source.lines[0].lineTotal], ["F10", source.subtotal]]) {
      expect(sheet.getCell(cell).value).toBe(expected);
      expect(typeof sheet.getCell(cell).value).toBe("string");
      expect(sheet.getCell(cell).numFmt).toBe("@");
    }
    expect(sheet.getCell("D9").value).toBe("123456789012.123456");
  });
});
