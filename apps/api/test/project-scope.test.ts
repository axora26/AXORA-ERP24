import { describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { CompanyScopeService } from "../src/common/company-scope.service.js";

describe("CompanyScopeService — projet", () => {
  const user = { id: "user-1", organizationId: "org-1" } as never;

  it("resout un projet uniquement dans l'entreprise demandee", async () => {
    const prisma = {
      companyMembership: { findMany: vi.fn().mockResolvedValue([{ companyId: "company-1" }]) },
      project: { findFirst: vi.fn().mockResolvedValue({ id: "project-1" }) },
    };
    const service = new CompanyScopeService(prisma as never);

    const scope = await service.resolve(user, "company-1", "project-1");
    // projectId is deliberately non-enumerable so spreading the scope into
    // Prisma filters cannot inject a field into company-scoped models.
    expect(scope).toMatchObject({ organizationId: "org-1", companyId: "company-1" });
    expect(scope.projectId).toBe("project-1");
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: "project-1", organizationId: "org-1", companyId: "company-1" },
      select: { id: true },
    });
  });

  it("refuse un projet d'une autre entreprise sans divulguer son existence", async () => {
    const prisma = {
      companyMembership: { findMany: vi.fn().mockResolvedValue([{ companyId: "company-1" }]) },
      project: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const service = new CompanyScopeService(prisma as never);

    await expect(service.resolve(user, "company-1", "project-2")).rejects.toBeInstanceOf(ForbiddenException);
  });
});
