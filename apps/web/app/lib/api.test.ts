import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

it("preserves the draft version when deleting a row and sends the selected company", async () => {
  await api.delete("/estimation/dqes/dqe-1/lines/line-1", { expectedVersion: 4 });
  expect(fetch).toHaveBeenLastCalledWith("/api/v1/estimation/dqes/dqe-1/lines/line-1?companyId=company-selected", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ expectedVersion: 4, companyId: "company-selected" }) }));
});
it("does not turn a failed download into a success", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: "Export indisponible" }), { status: 503, headers: { "Content-Type": "application/json" } }));
  await expect(api.download("/estimation/dqes/dqe-1/export.xlsx")).rejects.toThrow("Export indisponible");
});
import { api, setActiveCompanyId, setMfaStepUpHandler, StepUpCancelledError } from "./api";
import { adminApi } from "./modules/admin";

beforeEach(() => {
  setActiveCompanyId("company-selected");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" })));
});
afterEach(() => { setActiveCompanyId(null); setMfaStepUpHandler(null); vi.unstubAllGlobals(); });

describe("company context in the HTTP client", () => {
  it("rejoue exactement une fois une action après un step-up MFA réussi", async () => {
    const stepUp = vi.fn(async () => true);
    setMfaStepUpHandler(stepUp);
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: "MFA_STEP_UP_REQUIRED", message: "Vérification requise" }), { status: 403, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "role-1" }), { status: 201, headers: { "Content-Type": "application/json" } }));

    await expect(api.post<{ id: string }>("/admin/roles", { name: "Finance", permissions: [] })).resolves.toEqual({ id: "role-1" });
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[1]).toEqual(vi.mocked(fetch).mock.calls[0]);
  });

  it("annule le step-up sans rejouer ni convertir l'annulation en refus RBAC", async () => {
    setMfaStepUpHandler(async () => false);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ code: "MFA_STEP_UP_REQUIRED", message: "Vérification requise" }), { status: 403, headers: { "Content-Type": "application/json" } }));

    await expect(api.delete("/admin/roles/role-1")).rejects.toBeInstanceOf(StepUpCancelledError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("conserve le code machine et n'entre pas dans une boucle de rejeu", async () => {
    setMfaStepUpHandler(async () => true);
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ code: "MFA_STEP_UP_REQUIRED", message: "Vérification requise" }), { status: 403, headers: { "Content-Type": "application/json" } }));

    await expect(api.post("/admin/roles", { name: "Finance", permissions: [] })).rejects.toMatchObject({
      status: 403,
      code: "MFA_STEP_UP_REQUIRED",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("adds the selected company to business requests while preserving an explicit scope", async () => {
    await api.post("/projects", { name: "Projet" });
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/projects?companyId=company-selected", expect.objectContaining({ credentials: "include", body: JSON.stringify({ name: "Projet", companyId: "company-selected" }) }));
    await api.post("/projects?companyId=company-explicit", { companyId: "company-explicit" });
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/projects?companyId=company-explicit", expect.objectContaining({ body: JSON.stringify({ companyId: "company-explicit" }) }));
  });
  it("keeps authentication preferences and organization-wide administration unscoped", async () => {
    await api.patch("/auth/preferences", { theme: "dark" });
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/auth/preferences", expect.objectContaining({ body: JSON.stringify({ theme: "dark" }) }));
    await api.get("/auth/context");
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/auth/context", expect.any(Object));
    await api.post("/admin/users", { email: "membre@example.com" });
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/admin/users", expect.objectContaining({ body: JSON.stringify({ email: "membre@example.com" }) }));
    await adminApi.organization();
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/organizations/me", expect.anything());
    await adminApi.updateSecurityPolicy(true);
    expect(fetch).toHaveBeenLastCalledWith("/api/v1/organizations/me/security-policy", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ mfaRequired: true }) }));
  });
});
