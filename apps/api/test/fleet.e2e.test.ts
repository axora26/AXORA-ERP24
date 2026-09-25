import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

/**
 * INC-18 — Gestion de parc (BC-18). Affectation = chauffeur actif et
 * habilite + vehicule en regle ; compteurs et carburant append-only et
 * monotones ; maintenance et pannes via la GMAO.
 */
describe("Gestion de parc (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let reader: Tenant;
  let projectId = "";
  let driver = "";
  let unlicensed = "";
  let expired = "";
  let truck = "";
  let truckAsset = "";
  let excavator = "";
  let assignmentId = "";
  let incidentId = "";

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "parc-a");
    other = await registerTenant(harness, "parc-b");
    reader = await createUserWith(harness, owner, ["fleet.vehicle.read"], "lecteur-parc");
    projectId = (await createStartedProject(harness, owner)).projectId;
    const api = as(harness, owner);
    const employee = async (firstName: string, skill?: { name: string; certifiedUntil: string }) => {
      const created = await api.post("/hr/employees", { firstName, lastName: "Test", jobTitle: "Chauffeur", hireDate: "2024-01-15", contractType: "PERMANENT", hourlyCost: "12.00" });
      if (skill) await api.post(`/hr/employees/${created.body.id}/skills`, { name: skill.name, level: 3, certifiedUntil: skill.certifiedUntil });
      return created.body.id as string;
    };
    driver = await employee("Didier", { name: "Permis C", certifiedUntil: iso(400) });
    unlicensed = await employee("Aline");
    expired = await employee("Paul", { name: "Permis C", certifiedUntil: iso(-10) });
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("mise au parc : passeport GMAO cree avec une origine justifiee, immatriculation unique", async () => {
    const base = { kind: "VEHICLE", category: "Porteur 19 t", make: "Mercedes", model: "Actros 1845", fuelType: "DIESEL", usageUnit: "KM", acquisitionDate: "2024-03-01", initialReading: "45210", homeBase: "Dépôt central", originJustification: "Facture VN-2024-118, carte grise du 01/03/2024" };
    expect((await api().post("/fleet/vehicles", base)).status).toBe(400);
    const created = await api().post("/fleet/vehicles", { ...base, registration: "4521 ab 07", requiredLicence: "Permis C", acquisitionCost: "96500.00", year: 2024 });
    expect(created.status).toBe(201);
    truck = created.body.id;
    truckAsset = created.body.assetId;
    expect(created.body).toMatchObject({ registration: "4521-AB-07", lastReading: "45210", status: "ACTIVE" });
    expect(created.body.code).toMatch(/^FLT-\d{4}-\d{4}$/);
    const asset = await api().get(`/assets/items/${truckAsset}`);
    expect(asset.body).toMatchObject({ origin: "MANUAL", status: "IN_SERVICE" });
    expect(asset.body.originJustification).toContain(created.body.code);
    expect((await api().post("/fleet/vehicles", { ...base, registration: "4521-AB-07" })).status).toBe(409);
    expect((await api().post("/fleet/vehicles", { ...base, registration: "9999-ZZ-01", initialReadingAt: "2023-01-01" })).body.message).toMatch(/initialReadingAt/);
    excavator = (await api().post("/fleet/vehicles", { ...base, kind: "ENGINE", category: "Pelle sur chenilles 20 t", make: "Caterpillar", model: "320", usageUnit: "HOURS", initialReading: "3120.5" })).body.id;
    expect((await as(harness, reader).post("/fleet/vehicles", base)).status).toBe(403);
  });

  it("affectation : vehicule en regle, chauffeur actif et habilite, releve coherent — sinon refus explicite", async () => {
    const refused = await api().post("/fleet/assignments", { vehicleId: truck, employeeId: driver, purpose: "Approvisionnement chantier", startReading: "45210" });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toMatch(/not compliant: assurance absente, carte grise absente/);
    for (const kind of ["INSURANCE", "REGISTRATION", "INSPECTION"]) {
      await api().post(`/fleet/vehicles/${truck}/documents`, { kind, reference: `${kind}-1`, issuer: "SONAS", validFrom: iso(-30), validUntil: iso(kind === "INSPECTION" ? 20 : 335), cost: kind === "INSURANCE" ? "2400.00" : undefined });
    }
    const vehicle = await api().get(`/fleet/vehicles/${truck}`);
    expect(vehicle.body.compliance.find((item: { kind: string }) => item.kind === "INSPECTION").state).toBe("EXPIRING");

    expect((await api().post("/fleet/assignments", { vehicleId: truck, employeeId: unlicensed, purpose: "x", startReading: "45210" })).body.message).toMatch(/does not hold the required licence « Permis C »/);
    expect((await api().post("/fleet/assignments", { vehicleId: truck, employeeId: expired, purpose: "x", startReading: "45210" })).body.message).toMatch(/expired/);
    expect((await api().post("/fleet/assignments", { vehicleId: truck, employeeId: driver, purpose: "x", startReading: "45100" })).body.message).toMatch(/never goes back/);
    expect((await as(harness, reader).post("/fleet/assignments", { vehicleId: truck, employeeId: driver, purpose: "x", startReading: "45210" })).status).toBe(403);

    const opened = await api().post("/fleet/assignments", { vehicleId: truck, employeeId: driver, projectId, purpose: "Approvisionnement chantier", startReading: "45215" });
    expect(opened.status).toBe(201);
    assignmentId = opened.body.id;
    expect(opened.body).toMatchObject({ employeeName: "Didier Test", startReading: "45215", endAt: null });
    expect((await api().post("/fleet/assignments", { vehicleId: truck, employeeId: expired, purpose: "x", startReading: "45215" })).status).toBe(409);
    await api().post(`/fleet/vehicles/${excavator}/documents`, { kind: "INSURANCE", reference: "RC-ENG", validFrom: iso(-10), validUntil: iso(300) });
    await api().post(`/fleet/vehicles/${excavator}/documents`, { kind: "INSPECTION", reference: "VGP-1", validFrom: iso(-10), validUntil: iso(170) });
    expect((await api().post("/fleet/assignments", { vehicleId: excavator, employeeId: driver, purpose: "Terrassement", startReading: "3121" })).status).toBe(409);
    await expect(
      harness.prisma.fleetAssignment.create({ data: { organizationId: owner.organizationId, companyId: owner.companyId, code: "AFF-X", vehicleId: truck, employeeId: unlicensed, purpose: "x", startAt: new Date(), startReading: "45215", createdByUserId: owner.userId } }),
    ).rejects.toThrow(/fleet_assignments_one_open_per_vehicle|Unique constraint/);
  });

  it("carburant : imputation au projet de l'affectation, compteur monotone (API et base), consommation plein a plein", async () => {
    // Pleins successifs pendant l'affectation (horodatage de saisie croissant).
    const now = () => new Date().toISOString();
    await api().post("/fleet/fuel", { vehicleId: truck, filledAt: now(), liters: "180", unitPrice: "1.52", reading: "45300", fullTank: true, station: "Engen Likasi" });
    await api().post("/fleet/fuel", { vehicleId: truck, filledAt: now(), liters: "60", unitPrice: "1.55", reading: "45520", fullTank: false });
    const logs = await api().post("/fleet/fuel", { vehicleId: truck, filledAt: now(), liters: "95.5", unitPrice: "1.55", reading: "45800", fullTank: true });
    expect(logs.status).toBe(201);
    expect(logs.body[0]).toMatchObject({ liters: "95.5", totalCost: "148.03", projectCode: expect.any(String) });
    expect((await api().post("/fleet/fuel", { vehicleId: truck, filledAt: now(), liters: "10", unitPrice: "1.55", reading: "45700", fullTank: false })).body.message).toMatch(/never goes back/);
    await expect(
      harness.prisma.fleetMeterReading.create({ data: { organizationId: owner.organizationId, companyId: owner.companyId, vehicleId: truck, readAt: new Date(), value: "45000", source: "MANUAL", recordedByUserId: owner.userId } }),
    ).rejects.toThrow(/never goes back/);
    const reading = await harness.prisma.fleetMeterReading.findFirstOrThrow({ where: { vehicleId: truck } });
    await expect(harness.prisma.fleetMeterReading.update({ where: { id: reading.id }, data: { value: "1" } })).rejects.toThrow(/append-only/);

    const detail = await api().get(`/fleet/vehicles/${truck}`);
    // (60 + 95.5) L / 500 km = 31.1 L/100 km
    expect(detail.body.consumption).toMatchObject({ value: "31.1", unit: "L/100 km", windows: 1 });
    const costs = await api().get("/fleet/project-costs");
    expect(costs.body).toEqual([expect.objectContaining({ projectId, fuelCost: "514.63", liters: "335.5", fills: 3 })]);
    expect((await as(harness, reader).post("/fleet/fuel", { vehicleId: truck, filledAt: now(), liters: "1", unitPrice: "1", reading: "45801", fullTank: false })).status).toBe(403);
  });

  it("incident : conducteur deduit de l'affectation, ticket GMAO a l'heure de la panne, immobilisation", async () => {
    const occurredAt = new Date().toISOString();
    expect((await api().post("/fleet/incidents", { vehicleId: truck, kind: "FINE", occurredAt, description: "Excès de vitesse", createTicket: true })).status).toBe(400);
    const incident = await api().post("/fleet/incidents", { vehicleId: truck, kind: "BREAKDOWN", occurredAt, description: "Perte de pression d'air freinage", location: "RN1 PK 42", createTicket: true, immobilize: true, cost: "350.00" });
    expect(incident.status).toBe(201);
    incidentId = incident.body.id;
    expect(incident.body).toMatchObject({ driverName: "Didier Test", status: "OPEN", maintenanceTicketCode: expect.stringMatching(/^TKT-/) });
    const tickets = await api().get("/assets/tickets");
    expect(tickets.body.find((ticket: { id: string }) => ticket.id === incident.body.maintenanceTicketId)).toMatchObject({ failureAt: occurredAt, priority: "URGENT" });
    const vehicle = await api().get(`/fleet/vehicles/${truck}`);
    expect(vehicle.body.status).toBe("IMMOBILIZED");
    expect((await api().get(`/assets/items/${truckAsset}`)).body.status).toBe("OUT_OF_SERVICE");
    await expect(harness.prisma.fleetIncident.update({ where: { id: incidentId }, data: { driverEmployeeId: unlicensed } })).rejects.toThrow(/immutable/);

    const closedAssignment = await api().post(`/fleet/assignments/${assignmentId}/close`, { endReading: "45830", note: "Retour sur plateau" });
    expect(closedAssignment.body).toMatchObject({ usage: "615", endReading: "45830" });
    expect((await api().post(`/fleet/assignments/${assignmentId}/close`, { endReading: "45900" })).status).toBe(400);
    expect((await api().post(`/fleet/incidents/${incidentId}/close`, {})).status).toBe(400);
    const closed = await api().post(`/fleet/incidents/${incidentId}/close`, { note: "Valve de frein remplacée (OT GMAO)", cost: "420.00" });
    expect(closed.body).toMatchObject({ status: "CLOSED", cost: "420.00" });
  });

  it("couts 12 mois : carburant + GMAO + documents + incidents, cout au km ; cession bloquee par un OT ouvert", async () => {
    const ticketId = (await api().get(`/fleet/incidents?vehicleId=${truck}&status=ALL`)).body[0].maintenanceTicketId;
    const order = await api().post(`/assets/tickets/${ticketId}/convert`, { dueDate: iso(1) });
    expect(order.status).toBe(201);
    const detail = await api().get(`/fleet/vehicles/${truck}`);
    expect(detail.body.openWorkOrders).toBe(1);
    expect(detail.body.costs12m).toMatchObject({ fuel: "514.63", documents: "2400.00", incidents: "420.00", maintenance: "0.00", total: "3334.63", usage: "620" });
    expect(detail.body.costs12m.perUnit).toBe("5.378");
    const disposal = await api().post(`/fleet/vehicles/${truck}/status`, { status: "DISPOSED", reason: "Revente" });
    expect(disposal.status).toBe(400);
    expect(disposal.body.message).toMatch(/work orders/);
    const active = await api().post(`/fleet/vehicles/${truck}/status`, { status: "ACTIVE", reason: "Réparé" });
    expect(active.body.status).toBe("ACTIVE");
  });

  it("isolation et audit", async () => {
    expect((await as(harness, other).get(`/fleet/vehicles/${truck}`)).status).toBe(404);
    expect((await as(harness, other).get("/fleet/vehicles")).body).toHaveLength(0);
    expect((await as(harness, other).post("/fleet/fuel", { vehicleId: truck, filledAt: new Date().toISOString(), liters: "1", unitPrice: "1", reading: "50000", fullTank: false })).status).toBe(404);
    expect((await as(harness, reader).get(`/fleet/vehicles/${truck}`)).status).toBe(200);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "fleet." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["fleet.vehicle.created", "fleet.document.recorded", "fleet.assignment.opened", "fleet.assignment.closed", "fleet.fuel.recorded", "fleet.incident.reported", "fleet.incident.closed", "fleet.vehicle.status"]) {
      expect(actions.has(action)).toBe(true);
    }
  });
});
