import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { as, createHarness, registerTenant, type Harness, type Tenant } from "./support/harness.js";
import { createActiveContract, createStartedProject, createUserWith } from "./support/fixtures.js";
import { pdf, upload } from "./support/files.js";

/**
 * INC-20 — Portails Client & Fournisseur (BC-20). Plan d'identite externe
 * separe (session et cookie dedies, aucune interoperabilite avec les
 * sessions internes), exposition uniquement par autorisation explicite
 * sur des ressources appartenant a l'enregistrement racine.
 */
describe("Portails externes (e2e)", () => {
  let harness: Harness;
  let owner: Tenant;
  let other: Tenant;
  let reader: Tenant;
  let approver: Tenant;
  let projectId = "";
  let foreignProjectId = "";
  let accountId = "";
  let clientId = "";
  let clientCookie: string[] = [];
  let invoiceId = "";
  let documentId = "";
  let supplierId = "";
  let orderId = "";
  let otherOrderId = "";
  let supplierCookie: string[] = [];

  const portal = (cookie: string[]) => ({
    get: (path: string) => harness.http().get(`/api/v1/portal${path}`).set("Cookie", cookie),
    post: (path: string, body: object = {}) => harness.http().post(`/api/v1/portal${path}`).set("Cookie", cookie).send(body),
  });
  const activate = async (token: string, password: string) => harness.http().post("/api/v1/portal/auth/activate").send({ token, password });
  const tokenOf = (path: string) => path.split("#")[1]!;

  beforeAll(async () => {
    harness = await createHarness();
    owner = await registerTenant(harness, "portail-a");
    other = await registerTenant(harness, "portail-b");
    reader = await createUserWith(harness, owner, ["portal.principal.read"], "lecteur-portail");
    approver = await createUserWith(harness, owner, ["documents.document.read", "documents.document.approve", "procurement.request.read", "procurement.request.approve"], "valideur");
    const api = as(harness, owner);
    ({ projectId } = await createStartedProject(harness, owner));
    const project = await harness.prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const contract = await harness.prisma.contract.findUniqueOrThrow({ where: { id: project.contractId! } });
    accountId = (await harness.prisma.crmOpportunity.findUniqueOrThrow({ where: { id: contract.opportunityId } })).accountId!;
    // Projet d'un autre client de la meme societe : jamais exposable a ce principal.
    const foreign = await createActiveContract(harness, owner);
    foreignProjectId = (await api.post("/projects", { contractId: foreign.contractId, name: "Projet autre client" })).body.id;

    const draft = await api.post("/finance/invoices", { contractId: project.contractId, percent: "20" });
    invoiceId = draft.body.id;
    expect((await api.post(`/finance/invoices/${invoiceId}/issue`, {})).status).toBe(201);
    const file = await upload(harness, owner, pdf(`plan-${Date.now()}`), "PLAN-EXE-01.pdf");
    documentId = (await api.post("/documents", { title: "Plan d'exécution RDC", category: "PLAN", projectId, fileId: file.body.id })).body.id;
    await api.post(`/documents/${documentId}/submit`);
    expect((await as(harness, approver).post(`/documents/${documentId}/approve`, { note: "BPE" })).status).toBe(201);

    supplierId = (await api.post("/procurement/suppliers", { name: "Quincaillerie du Cuivre" })).body.id;
    const makeOrder = async (description: string) => {
      const request = await api.post("/procurement/requests", { title: description, projectId, lines: [{ description, unitCode: "u", quantity: "10", estimatedUnitPrice: "25.00" }] });
      await api.post(`/procurement/requests/${request.body.id}/submit`);
      await as(harness, approver).post(`/procurement/requests/${request.body.id}/approve`, { note: "ok" });
      await api.post(`/procurement/requests/${request.body.id}/quotes`, { supplierId, lines: [{ requestLineId: request.body.lines[0].id, unitPrice: "24.00" }] });
      const quotes = (await api.get(`/procurement/requests/${request.body.id}`)).body.quotes;
      const created = (await api.post("/procurement/orders", { requestId: request.body.id, quoteId: quotes[0].id })).body.id;
      await api.post(`/procurement/orders/${created}/issue`);
      return created as string;
    };
    orderId = await makeOrder("Tube cuivre 22 mm");
    otherOrderId = await makeOrder("Raccords laiton");
  });

  afterAll(async () => {
    await harness.close();
  });

  const api = () => as(harness, owner);

  it("invitation : identite externe rattachee a un compte CRM de la societe, jeton montre une fois", async () => {
    expect((await as(harness, reader).post("/portal-admin/principals", { kind: "CLIENT", email: "x@client.test", fullName: "X", crmAccountId: accountId })).status).toBe(403);
    const foreignAccount = await as(harness, other).post("/crm/accounts", { name: "Compte d'un autre tenant" });
    expect(foreignAccount.status).toBe(201);
    expect((await api().post("/portal-admin/principals", { kind: "CLIENT", email: "y@client.test", fullName: "Y", crmAccountId: foreignAccount.body.id })).status).toBe(404);
    const invited = await api().post("/portal-admin/principals", { kind: "CLIENT", email: "Maitre.Ouvrage@Client.test", fullName: "Maître d'ouvrage", crmAccountId: accountId });
    expect(invited.status).toBe(201);
    clientId = invited.body.principal.id;
    expect(invited.body.principal).toMatchObject({ status: "INVITED", email: "maitre.ouvrage@client.test", pendingInvitation: true, activeGrants: 0 });
    expect(invited.body.activationPath).toMatch(/^\/portal\/activate\?c=.+#.+/);
    const stored = await harness.prisma.portalInvitation.findFirstOrThrow({ where: { principalId: clientId } });
    expect(stored.tokenHash).not.toBe(invited.body.token);
    expect((await api().post("/portal-admin/principals", { kind: "CLIENT", email: "maitre.ouvrage@client.test", fullName: "Doublon", crmAccountId: accountId })).status).toBe(409);
    await expect(harness.prisma.portalPrincipal.update({ where: { id: clientId }, data: { supplierId } })).rejects.toThrow(/root record|portal_principals_root_record/);

    expect((await activate(tokenOf(invited.body.activationPath), "court")).status).toBe(400);
    const activated = await activate(tokenOf(invited.body.activationPath), "Portail-Client-2026!");
    expect(activated.status).toBe(200);
    expect(activated.body).toMatchObject({ kind: "CLIENT", rootName: expect.any(String) });
    clientCookie = activated.headers["set-cookie"] as unknown as string[];
    expect(clientCookie.join(";")).toMatch(/axora_portal_session=/);
    expect((await activate(tokenOf(invited.body.activationPath), "Portail-Client-2026!")).status).toBe(401);
  });

  it("deny-by-default : rien n'est visible sans autorisation ; aucune autorisation hors du compte racine", async () => {
    const empty = await portal(clientCookie).get("/home");
    expect(empty.status).toBe(200);
    expect(empty.body).toMatchObject({ projects: [], customerInvoices: [], documents: [], orders: [], supplierInvoices: [] });
    expect((await api().post(`/portal-admin/principals/${clientId}/grants`, { resourceType: "PROJECT", resourceId: foreignProjectId })).body.message).toMatch(/does not belong/);
    expect((await api().post(`/portal-admin/principals/${clientId}/grants`, { resourceType: "PURCHASE_ORDER", resourceId: orderId })).body.message).toMatch(/cannot expose/);
    const candidates = await api().get(`/portal-admin/principals/${clientId}/candidates`);
    expect(candidates.body.map((row: { resourceType: string }) => row.resourceType).sort()).toEqual(["CUSTOMER_INVOICE", "DOCUMENT", "PROJECT"]);
    for (const row of candidates.body) expect((await api().post(`/portal-admin/principals/${clientId}/grants`, { resourceType: row.resourceType, resourceId: row.resourceId })).status).toBe(201);
    expect((await api().post(`/portal-admin/principals/${clientId}/grants`, { resourceType: "PROJECT", resourceId: projectId })).status).toBe(409);

    const home = await portal(clientCookie).get("/home");
    expect(home.body.projects).toHaveLength(1);
    expect(home.body.projects[0]).toMatchObject({ id: projectId, progressPercent: expect.any(String) });
    expect(JSON.stringify(home.body)).not.toMatch(/budget|consumed|committed|margin/i);
    expect(home.body.customerInvoices[0]).toMatchObject({ id: invoiceId, status: "ISSUED" });
    expect(home.body.documents[0]).toMatchObject({ id: documentId, revision: expect.any(String) });
    const download = await portal(clientCookie).get(`/documents/${documentId}/content`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("application/pdf");
  });

  it("plans d'identite etanches : cookie interne refuse cote portail, cookie portail refuse cote interne", async () => {
    expect((await harness.http().get("/api/v1/portal/home").set("Cookie", owner.cookie)).status).toBe(401);
    expect((await harness.http().get(`/api/v1/projects/${projectId}`).set("Cookie", clientCookie)).status).toBe(401);
    expect((await harness.http().get("/api/v1/portal-admin/principals").set("Cookie", clientCookie)).status).toBe(401);
    const fileId = (await harness.prisma.documentVersion.findFirstOrThrow({ where: { documentId } })).fileId;
    expect((await harness.http().get(`/api/v1/files/${fileId}/content`).set("Cookie", clientCookie)).status).toBe(401);
  });

  it("fournisseur : ses seules commandes exposees, accuse de reception trace ; commande non exposee invisible", async () => {
    const invited = await api().post("/portal-admin/principals", { kind: "SUPPLIER", email: "adv@cuivre.test", fullName: "ADV Quincaillerie", supplierId });
    expect((await api().post(`/portal-admin/principals/${invited.body.principal.id}/grants`, { resourceType: "PROJECT", resourceId: projectId })).status).toBe(400);
    await api().post(`/portal-admin/principals/${invited.body.principal.id}/grants`, { resourceType: "PURCHASE_ORDER", resourceId: orderId });
    const activated = await activate(tokenOf(invited.body.activationPath), "Portail-Fournisseur-2026!");
    supplierCookie = activated.headers["set-cookie"] as unknown as string[];
    const home = await portal(supplierCookie).get("/home");
    expect(home.body.orders.map((order: { id: string }) => order.id)).toEqual([orderId]);
    expect(home.body.projects).toEqual([]);
    expect((await portal(supplierCookie).post(`/orders/${otherOrderId}/acknowledge`, { confirmedDate: "2026-10-15" })).status).toBe(404);
    expect((await portal(clientCookie).post(`/orders/${orderId}/acknowledge`, { confirmedDate: "2026-10-15" })).status).toBe(404);
    const acknowledged = await portal(supplierCookie).post(`/orders/${orderId}/acknowledge`, { confirmedDate: "2026-10-15", note: "Livraison sur chantier le matin" });
    expect(acknowledged.body.orders[0].acknowledgement).toMatchObject({ confirmedDate: "2026-10-15", note: "Livraison sur chantier le matin" });
  });

  it("connexion, limitation, deconnexion ; retrait d'autorisation immediat", async () => {
    await portal(clientCookie).post("/auth/logout");
    expect((await portal(clientCookie).get("/home")).status).toBe(401);
    expect((await harness.http().post("/api/v1/portal/auth/login").send({ companyId: owner.companyId, email: "maitre.ouvrage@client.test", password: "mauvais-mot-de-passe" })).status).toBe(401);
    expect((await harness.http().post("/api/v1/portal/auth/login").send({ companyId: other.companyId, email: "maitre.ouvrage@client.test", password: "Portail-Client-2026!" })).status).toBe(401);
    const login = await harness.http().post("/api/v1/portal/auth/login").send({ companyId: owner.companyId, email: "Maitre.Ouvrage@client.test", password: "Portail-Client-2026!" });
    expect(login.status).toBe(200);
    clientCookie = login.headers["set-cookie"] as unknown as string[];
    const principal = await api().get(`/portal-admin/principals/${clientId}`);
    const documentGrant = principal.body.grants.find((grant: { resourceType: string }) => grant.resourceType === "DOCUMENT");
    await api().post(`/portal-admin/grants/${documentGrant.id}/revoke`);
    expect((await portal(clientCookie).get("/home")).body.documents).toEqual([]);
    expect((await portal(clientCookie).get(`/documents/${documentId}/content`)).status).toBe(404);
  });

  it("suspension : sessions invalidees sur-le-champ (base) ; revocation definitive ; isolation et audit", async () => {
    expect((await api().post(`/portal-admin/principals/${clientId}/status`, { status: "SUSPENDED" })).status).toBe(400);
    const suspended = await api().post(`/portal-admin/principals/${clientId}/status`, { status: "SUSPENDED", reason: "Fin de mission du maître d'ouvrage délégué" });
    expect(suspended.body.status).toBe("SUSPENDED");
    expect((await portal(clientCookie).get("/home")).status).toBe(401);
    expect(await harness.prisma.portalSession.count({ where: { principalId: clientId, revokedAt: null } })).toBe(0);
    expect((await harness.http().post("/api/v1/portal/auth/login").send({ companyId: owner.companyId, email: "maitre.ouvrage@client.test", password: "Portail-Client-2026!" })).status).toBe(401);
    expect((await api().post(`/portal-admin/principals/${clientId}/status`, { status: "REVOKED", reason: "Contrat clos" })).body.status).toBe("REVOKED");
    expect((await api().post(`/portal-admin/principals/${clientId}/status`, { status: "ACTIVE", reason: "x" })).status).toBe(400);
    await expect(harness.prisma.portalPrincipal.update({ where: { id: clientId }, data: { status: "ACTIVE" } })).rejects.toThrow(/stays revoked/);

    expect((await as(harness, other).get(`/portal-admin/principals/${clientId}`)).status).toBe(404);
    expect((await as(harness, other).get("/portal-admin/principals")).body).toHaveLength(0);
    const audit = await harness.prisma.auditLog.findMany({ where: { organizationId: owner.organizationId, action: { startsWith: "portal." } } });
    const actions = new Set(audit.map((entry) => entry.action));
    for (const action of ["portal.principal.invited", "portal.principal.activated", "portal.grant.created", "portal.grant.revoked", "portal.session.opened", "portal.document.downloaded", "portal.order.acknowledged", "portal.principal.suspended", "portal.principal.revoked"]) {
      expect(actions.has(action)).toBe(true);
    }
    const external = audit.find((entry) => entry.action === "portal.order.acknowledged")!;
    expect(external.actorUserId).toBeNull();
    expect(JSON.stringify(external.metadata)).toMatch(/portalPrincipalId/);
  });
});
