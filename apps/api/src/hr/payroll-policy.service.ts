import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { PayrollPolicyView } from "@axora24/contracts";
import type { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, requiredDecimal, requiredEnum, requiredInt } from "../common/validation.js";

export function payrollPolicyView(policy: { version: number; mode: "MONTHLY_BASE" | "VALIDATED_HOURS"; standardMonthlyHours: Prisma.Decimal | null; overtimeCoefficient: Prisma.Decimal | null } | null): PayrollPolicyView {
  return { version: policy?.version ?? 0, mode: policy?.mode ?? "MONTHLY_BASE", standardMonthlyHours: policy?.standardMonthlyHours?.toFixed(2) ?? null, overtimeCoefficient: policy?.overtimeCoefficient?.toFixed(2) ?? null, configured: policy !== null };
}
@Injectable()
export class PayrollPolicyService {
  constructor(private readonly prisma: PrismaService) {}
  async get(scope: CompanyScope): Promise<PayrollPolicyView> { return payrollPolicyView(await this.prisma.companyPayrollPolicy.findFirst({ where: scope })); }
  async update(scope: CompanyScope, body: unknown, actorUserId: string): Promise<PayrollPolicyView> {
    const input = assertBody(body);
    const expectedVersion = requiredInt(input.expectedVersion, "expectedVersion", { min: 0 });
    const mode = requiredEnum(input.mode, "mode", ["MONTHLY_BASE", "VALIDATED_HOURS"] as const);
    const standardMonthlyHours = mode === "VALIDATED_HOURS" ? requiredDecimal(input.standardMonthlyHours, "standardMonthlyHours", { positive: true }) : null;
    const overtimeCoefficient = mode === "VALIDATED_HOURS" ? requiredDecimal(input.overtimeCoefficient, "overtimeCoefficient", { min: "1" }) : null;
    if (standardMonthlyHours && (standardMonthlyHours.greaterThan(744) || standardMonthlyHours.decimalPlaces() > 2)) throw new BadRequestException("Standard monthly hours must have at most two decimals and cannot exceed 744");
    if (overtimeCoefficient && (overtimeCoefficient.greaterThan(100) || overtimeCoefficient.decimalPlaces() > 2)) throw new BadRequestException("The overtime coefficient must have at most two decimals and cannot exceed 100");
    const policy = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "companies" WHERE "id" = ${scope.companyId} AND "organizationId" = ${scope.organizationId} FOR UPDATE`;
      const current = await tx.companyPayrollPolicy.findFirst({ where: scope });
      if ((current?.version ?? 0) !== expectedVersion) throw new ConflictException("The payroll policy changed; reload its current version");
      const data = { mode, standardMonthlyHours, overtimeCoefficient, updatedByUserId: actorUserId };
      const result = current ? await tx.companyPayrollPolicy.update({ where: { id: current.id }, data: { ...data, version: current.version + 1 } }) : await tx.companyPayrollPolicy.create({ data: { ...scope, ...data } });
      await writeAudit(tx, scope, actorUserId, "hr.payroll.policy.updated", "CompanyPayrollPolicy", result.id, { version: result.version, mode, standardMonthlyHours: standardMonthlyHours?.toFixed(2) ?? null, overtimeCoefficient: overtimeCoefficient?.toFixed(2) ?? null });
      return result;
    });
    return payrollPolicyView(policy);
  }
}
