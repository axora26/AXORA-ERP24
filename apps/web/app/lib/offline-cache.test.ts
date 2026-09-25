import { beforeEach, describe, expect, it } from "vitest";
import { ApiError } from "./api";
import { cachedLoad, purgeOfflineData, readContext, saveContext, setOfflineScope } from "./offline-cache";

describe("cache hors ligne du chantier", () => {
  beforeEach(() => {
    window.localStorage.clear();
    setOfflineScope("user-1", "company-1");
  });

  it("sert la dernière consultation uniquement en l'absence de réseau", async () => {
    expect(await cachedLoad("projects", async () => ["P1"])).toEqual(["P1"]);
    expect(await cachedLoad("projects", async () => Promise.reject(new ApiError(0, "hors ligne")))).toEqual(["P1"]);
    await expect(cachedLoad("projects", async () => Promise.reject(new ApiError(401, "Session expirée")))).rejects.toThrow("Session expirée");
    await expect(cachedLoad("projects", async () => Promise.reject(new ApiError(403, "Refusé")))).rejects.toThrow("Refusé");
  });

  it("cloisonnement par utilisateur et entreprise", async () => {
    await cachedLoad("projects", async () => ["P1"]);
    setOfflineScope("user-2", "company-1");
    await expect(cachedLoad("projects", async () => Promise.reject(new ApiError(0, "hors ligne")))).rejects.toThrow("hors ligne");
  });

  it("purge complète à la déconnexion", async () => {
    await cachedLoad("projects", async () => ["P1"]);
    saveContext({ user: { id: "user-1" } });
    window.localStorage.setItem("axora.activeCompanyId", "company-1");
    purgeOfflineData();
    expect(readContext()).toBeNull();
    expect(Object.keys(window.localStorage)).toEqual(["axora.activeCompanyId"]);
  });
});
