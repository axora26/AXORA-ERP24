import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createStartedProject, createUserWith } from "./support/fixtures.js";

/** INC-13 — MEP : equipements de reference, notes de calcul transparentes, revisions immuables, validation par un tiers. */
describe("MEP (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let reviewer: Tenant;
  let projectId = "";
  let hvacSystem = "";
  let equipmentId = "";
  let calculationId = "";

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "mep-a");
    other = await registerTenant(harness, "mep-b");
    projectId = (await createStartedProject(harness, owner)).projectId;
    reviewer = await createUserWith(harness, owner, ["mep.system.read", "mep.calculation.validate"], "ingenieur-verif");
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("catalogue : formules exposees et zones non couvertes declarees", async () => {
    const catalog = await as(harness, reviewer).get("/mep/calculation-types");
    expect(catalog.status).toBe(200);
    expect(catalog.body.types.map((type: { type: string }) => type.type)).toContain("hvac.air_flow_sensible");
    expect(catalog.body.types[0].formula).toBeTruthy();
    expect(catalog.body.notCovered.length).toBeGreaterThan(0);
  });

  it("systemes et equipements : repere unique par projet, discipline heritee du systeme", async () => {
    let systems = await api().post("/mep/systems", { projectId, code: "cvc-01", name: "Traitement d'air bloc opératoire", discipline: "HVAC" });
    expect(systems.status).toBe(201);
    hvacSystem = systems.body.find((system: { code: string }) => system.code === "CVC-01").id;
    systems = await api().post("/mep/systems", { projectId, code: "ELEC-01", name: "Distribution BT", discipline: "ELECTRICAL" });
    expect((await api().post("/mep/systems", { projectId, code: "CVC-01", name: "Doublon", discipline: "HVAC" })).status).toBe(409);

    const equipment = await api().post("/mep/equipment", {
      systemId: hvacSystem,
      tag: "cta-01",
      name: "Centrale de traitement d'air bloc",
      manufacturer: "Fabricant X",
      model: "CTA 12000",
      location: "Local technique toiture",
      specs: [
        { name: "Débit nominal", value: "12000", unit: "m³/h" },
        { name: "Puissance froid", value: "85", unit: "kW" },
      ],
    });
    expect(equipment.status).toBe(201);
    equipmentId = equipment.body.id;
    expect(equipment.body).toMatchObject({ tag: "CTA-01", discipline: "HVAC", status: "SPECIFIED", systemCode: "CVC-01" });
    expect((await api().post("/mep/equipment", { systemId: hvacSystem, tag: "CTA-01", name: "Doublon" })).status).toBe(409);
    expect((await api().patch(`/mep/equipment/${equipmentId}`, { status: "COMMISSIONED" })).status).toBe(400);
    expect((await api().patch(`/mep/equipment/${equipmentId}`, { status: "SELECTED" })).body.status).toBe("SELECTED");
    expect((await as(harness, reviewer).post("/mep/equipment", { systemId: hvacSystem, tag: "X", name: "X" })).status).toBe(403);
  });

  it("note de calcul : resultat produit par le serveur, entrees et formule substituee exposees", async () => {
    expect((await api().post("/mep/calculations", { projectId, calcType: "hvac.air_flow_sensible", title: "x", inputs: { power: 10000, density: "1.2", heatCapacity: "1006", deltaT: "10" } })).status).toBe(400);
    expect((await api().post("/mep/calculations", { projectId, calcType: "hvac.en12831", title: "x", inputs: {} })).status).toBe(400);
    const created = await api().post("/mep/calculations", {
      projectId,
      equipmentId,
      calcType: "hvac.air_flow_sensible",
      title: "Débit de soufflage salle 1",
      inputs: { power: "10000", density: "1.2", heatCapacity: "1006", deltaT: "10" },
      outputs: [{ name: "flow", value: "99999" }],
    });
    expect(created.status).toBe(201);
    calculationId = created.body.id;
    expect(created.body.code).toMatch(/^CALC-\d{4}-\d{4}$/);
    expect(created.body.current.outputs.find((output: { name: string }) => output.name === "flow").value).toBe("2982.1");
    expect(created.body.current.substitution).toBe("qv = 10000 × 3600 / (1.2 × 1006 × 10)");
    expect(created.body.current.inputs[0]).toMatchObject({ symbol: "P", unit: "W", value: "10000" });
    expect(created.body.equipmentTag).toBe("CTA-01");
  });

  it("validation : sources exigees, par un autre ingenieur ; toute hypothese modifiee = nouvelle revision", async () => {
    expect((await api().post(`/mep/calculations/${calculationId}/validate`)).status).toBe(403);
    expect((await as(harness, reviewer).post(`/mep/calculations/${calculationId}/validate`)).status).toBe(400);

    expect((await api().post(`/mep/calculations/${calculationId}/revise`, { inputs: { power: "12000", density: "1.2", heatCapacity: "1006", deltaT: "10" } })).status).toBe(400);
    const revised = await api().post(`/mep/calculations/${calculationId}/revise`, {
      inputs: { power: "12000", density: "1.2", heatCapacity: "1006", deltaT: "10" },
      sources: "Bilan d'apports salle 1 (note BET indice B) ; propriétés de l'air à 20 °C, niveau de la mer",
      notes: "Apports matériels revus à la hausse",
    });
    expect(revised.body.currentRevision).toBe(2);
    expect(revised.body.revisions.map((revision: { revision: number; status: string }) => `${revision.revision}:${revision.status}`)).toEqual(["2:DRAFT", "1:SUPERSEDED"]);
    expect(revised.body.current.outputs[0].value).toBe("3578.5");

    const validated = await as(harness, reviewer).post(`/mep/calculations/${calculationId}/validate`, { note: "Hypothèses cohérentes" });
    expect(validated.body).toMatchObject({ validatedRevision: 2 });
    expect(validated.body.current).toMatchObject({ status: "VALIDATED", validationNote: "Hypothèses cohérentes" });

    const third = await api().post(`/mep/calculations/${calculationId}/revise`, {
      inputs: { power: "12000", density: "1.2", heatCapacity: "1006", deltaT: "8" },
      sources: "Idem indice B",
      notes: "Soufflage plus chaud demandé par l'exploitant",
    });
    // La revision 2 validee reste applicable tant que la 3 n'est pas validee.
    expect(third.body).toMatchObject({ currentRevision: 3, validatedRevision: 2 });
    await as(harness, reviewer).post(`/mep/calculations/${calculationId}/validate`);
    const history = (await api().get(`/mep/calculations/${calculationId}`)).body.revisions.map((revision: { status: string }) => revision.status);
    expect(history).toEqual(["VALIDATED", "SUPERSEDED", "SUPERSEDED"]);
  });

  it("garanties en base : revision immuable, validee par un autre ingenieur", async () => {
    const revision = await harness.prisma.engineeringCalculationRevision.findFirstOrThrow({ where: { calculationId, revision: 1 } });
    await expect(harness.prisma.engineeringCalculationRevision.update({ where: { id: revision.id }, data: { inputs: [] } })).rejects.toThrow(/immutable/);
    await expect(harness.prisma.engineeringCalculationRevision.delete({ where: { id: revision.id } })).rejects.toThrow(/never deleted/);
    await expect(
      harness.prisma.engineeringCalculationRevision.update({ where: { id: revision.id }, data: { validatedByUserId: revision.authorUserId } }),
    ).rejects.toThrow(/calculation_validated_by_other_engineer/);
  });

  it("fiche equipement, quantitatif et isolation", async () => {
    const equipment = await as(harness, reviewer).get(`/mep/equipment/${equipmentId}`);
    expect(equipment.body.calculations).toHaveLength(1);
    const quantities = await api().get(`/mep/quantities?projectId=${projectId}`);
    expect(quantities.body).toEqual([expect.objectContaining({ systemCode: "CVC-01", discipline: "HVAC", references: 1, quantity: 1 })]);
    expect((await as(harness, other).get(`/mep/equipment/${equipmentId}`)).status).toBe(404);
    expect((await as(harness, other).get(`/mep/calculations/${calculationId}`)).status).toBe(404);
    expect((await as(harness, other).get("/mep/equipment")).body).toHaveLength(0);
    expect((await as(harness, other).post("/mep/calculations", { projectId, calcType: "elec.current_single_phase", title: "x", inputs: { power: "1", voltage: "230", powerFactor: "1" } })).status).toBe(404);
  });
});
