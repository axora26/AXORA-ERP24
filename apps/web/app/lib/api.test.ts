import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

it("preserves the draft version when deleting a row and sends the selected company", async () => {
  await api.delete("/estimation/dqes/dqe-1/lines/line-1", { expectedVersion: 4 });
  expect(fetch).toHaveBeenLastCalledWith("/api/v1/estimation/dqes/dqe-1/lines/line-1?companyId=company-selected", expect.objectContaining({ method: "DELETE", body: JSON.stringify({ expectedVersion: 4, companyId: "company-selected" }) }));
});
it("does not turn a failed download into a success", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ message: "Export indisponible" }), { status: 503, headers: { "Content-Type": "application/json" } }));
  await expect(api.download("/estimation/dqes/dqe-1/export.xlsx")).rejects.toThrow("Export indisponible");
});
import { api, setActiveCompanyId } from "./api";

beforeEach(() => {
  setActiveCompanyId("company-selected");
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, text: async () => "{}" })));
});
afterEach(() => { setActiveCompanyId(null); vi.unstubAllGlobals(); });

describe("company context in the HTTP client", () => {
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
  });
});
