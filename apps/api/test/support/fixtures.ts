import { expect } from "vitest";
import { as, type Harness, type Tenant } from "./harness.js";

let sequence = 0;

/**
 * Chaine commerciale complete via l'API reelle : prospect -> opportunite ->
 * etude -> DQE finalise -> devis accepte -> contrat ACTIF.
 */
export async function createActiveContract(
  harness: Harness,
  tenant: Tenant,
  lines: Array<{ reference?: string; designation: string; unitCode: string; quantity: string; unitPrice: string }> = [
    { reference: "GO-01", designation: "Gros oeuvre", unitCode: "m3", quantity: "100", unitPrice: "250.00" },
    { reference: "CVC-01", designation: "Centrale de traitement d'air", unitCode: "u", quantity: "2", unitPrice: "12500.00" },
  ],
): Promise<{ contractId: string; subtotal: string; opportunityId: string }> {
  sequence += 1;
  const tag = `${Date.now()}-${sequence}`;
  const api = as(harness, tenant);
  const lead = await api.post("/crm/leads", { contactName: `Contact ${tag}`, companyName: `Client ${tag}` });
  expect(lead.status).toBe(201);
  const opportunity = await api.post(`/crm/leads/${lead.body.id}/convert`, { amount: "100000.00" });
  expect(opportunity.status).toBe(201);
  const study = await api.post("/estimation/studies", {
    opportunityId: opportunity.body.id,
    code: `ST-${tag}`,
    title: "Etude",
    objective: "Hypotheses verifiables avant chiffrage.",
  });
  expect(study.status).toBe(201);
  await api.post(`/estimation/studies/${study.body.id}/requirements`, {
    position: 1,
    category: "FACT",
    statement: "Surface confirmee.",
  });
  expect((await api.post(`/estimation/studies/${study.body.id}/ready`)).status).toBe(201);
  const dqe = await api.post("/estimation/dqes", { studyId: study.body.id, code: `DQE-${tag}`, title: "DQE", currency: "USD" });
  expect(dqe.status).toBe(201);
  for (const [index, line] of lines.entries()) {
    expect((await api.post(`/estimation/dqes/${dqe.body.id}/lines`, { position: index + 1, ...line })).status).toBe(201);
  }
  expect((await api.post(`/estimation/dqes/${dqe.body.id}/finalize`)).status).toBe(201);
  const quote = await api.post("/sales/quotes", { dqeId: dqe.body.id, code: `DV-${tag}`, title: "Devis" });
  expect(quote.status).toBe(201);
  await api.post(`/sales/quotes/${quote.body.id}/submit`);
  await api.post(`/sales/quotes/${quote.body.id}/accept`);
  const contract = await api.post("/sales/contracts", { quoteId: quote.body.id, code: `CT-${tag}`, title: "Contrat" });
  expect(contract.status).toBe(201);
  return { contractId: contract.body.id, subtotal: contract.body.subtotal, opportunityId: opportunity.body.id };
}

/** Cree un utilisateur supplementaire du tenant avec les permissions donnees et retourne sa session. */
export async function createUserWith(
  harness: Harness,
  owner: Tenant,
  permissions: string[],
  label = "user",
): Promise<Tenant> {
  sequence += 1;
  const api = as(harness, owner);
  const role = await api.post("/admin/roles", { name: `${label}-${Date.now()}-${sequence}`, permissions });
  expect(role.status).toBe(201);
  const email = `${label}-${Date.now()}-${sequence}@test.com`;
  const password = "Collaborator2026!";
  const user = await api.post("/admin/users", {
    email,
    fullName: `${label} ${sequence}`,
    password,
    roleIds: [role.body.id],
    companyIds: [owner.companyId],
  });
  expect(user.status).toBe(201);
  const login = await harness.http().post("/api/v1/auth/login").send({ email, password });
  expect(login.status).toBe(201);
  return {
    ...owner,
    email,
    password,
    userId: user.body.id,
    cookie: login.headers["set-cookie"] as unknown as string[],
  };
}
