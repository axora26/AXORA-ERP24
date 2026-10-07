import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { crmDirectoryApi } from "./crm";

vi.mock("../api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

beforeEach(() => vi.clearAllMocks());

describe("API CRM Account 360", () => {
  it("charge la vue 360, la timeline, les actions et les assignés sur leurs routes dédiées", async () => {
    vi.mocked(api.get).mockResolvedValue({});

    await crmDirectoryApi.account360("account-1");
    await crmDirectoryApi.accountTimeline("account-1");
    await crmDirectoryApi.nextActions("account-1");
    await crmDirectoryApi.assignees();

    expect(api.get).toHaveBeenNthCalledWith(1, "/crm/accounts/account-1/360");
    expect(api.get).toHaveBeenNthCalledWith(2, "/crm/accounts/account-1/timeline");
    expect(api.get).toHaveBeenNthCalledWith(3, "/crm/next-actions?accountId=account-1");
    expect(api.get).toHaveBeenNthCalledWith(4, "/crm/assignees");
  });

  it("transmet expectedVersion pour replanifier, terminer et annuler", async () => {
    vi.mocked(api.patch).mockResolvedValue({});
    vi.mocked(api.post).mockResolvedValue({});

    await crmDirectoryApi.updateNextAction("action-1", { dueAt: "2026-10-09T08:30:00.000Z", expectedVersion: 4 });
    await crmDirectoryApi.completeNextAction("action-1", 4);
    await crmDirectoryApi.cancelNextAction("action-1", 5);

    expect(api.patch).toHaveBeenCalledWith("/crm/next-actions/action-1", { dueAt: "2026-10-09T08:30:00.000Z", expectedVersion: 4 });
    expect(api.post).toHaveBeenCalledWith("/crm/next-actions/action-1/complete", { expectedVersion: 4 });
    expect(api.post).toHaveBeenCalledWith("/crm/next-actions/action-1/cancel", { expectedVersion: 5 });
  });
});
