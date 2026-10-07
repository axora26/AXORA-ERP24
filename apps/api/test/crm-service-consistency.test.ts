import { describe, expect, it, vi } from "vitest";
import { CrmService, nextActionDateWindow } from "../src/crm/crm.service.js";

describe("CRM consistency boundaries", () => {
  it("uses the current instant for overdue while retaining UTC calendar windows", () => {
    const now = new Date("2026-10-07T15:30:00.000Z");
    expect(nextActionDateWindow("overdue", now)).toEqual({ status: "OPEN", dueAt: { lt: now } });
    expect(nextActionDateWindow("today", now)).toEqual({ status: "OPEN", dueAt: { gte: new Date("2026-10-07T00:00:00.000Z"), lt: new Date("2026-10-08T00:00:00.000Z") } });
  });

  it("loads account timeline relations and activities in the same repeatable-read transaction", async () => {
    const tx = {
      crmAccount: { findFirst: vi.fn().mockResolvedValue({ id: "account-1" }) },
      crmContact: { findMany: vi.fn().mockResolvedValue([{ id: "contact-1" }]) },
      crmOpportunity: { findMany: vi.fn().mockResolvedValue([]) },
      crmLead: { findMany: vi.fn().mockResolvedValue([]) },
      crmActivity: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const prisma = {
      $transaction: vi.fn(async (work: ((client: typeof tx) => unknown) | Promise<unknown>[]) => Array.isArray(work) ? Promise.all(work) : work(tx)),
      crmAccount: { findFirst: vi.fn().mockResolvedValue({ id: "account-1" }) },
      crmContact: { findMany: vi.fn().mockResolvedValue([{ id: "contact-1" }]) },
      crmOpportunity: { findMany: vi.fn().mockResolvedValue([]) },
      crmLead: { findMany: vi.fn().mockResolvedValue([]) },
      crmActivity: { findMany: vi.fn(() => { throw new Error("activity read escaped transaction"); }) },
    };
    const service = new CrmService(prisma as never);
    await expect(service.getAccountTimeline({ organizationId: "org-1", companyId: "company-1" }, "account-1")).resolves.toEqual([]);
    expect(tx.crmActivity.findMany).toHaveBeenCalledOnce();
    expect(prisma.crmActivity.findMany).not.toHaveBeenCalled();
  });
});