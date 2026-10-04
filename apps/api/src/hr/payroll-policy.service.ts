import { BadRequestException, ConflictException, Injectable } from "@nestjs/common";
import type { PayrollPolicyView } from "@axora24/contracts";
import type { Prisma } from "@axora24/database";
import { PrismaService } from "../core/prisma.service.js";
import type { CompanyScope } from "../common/company-scope.service.js";
import { writeAudit } from "../common/audit.js";
import { assertBody, optionalDecimal, optionalText, requiredDecimal, requiredEnum, requiredInt } from "../common/validation.js";

type PayrollPolicyRecord = {
  version: number;
  mode: "MONTHLY_BASE" | "VALIDATED_HOURS";
  standardMonthlyHours: Prisma.Decimal | null;
  overtimeCoefficient: Prisma.Decimal | null;
  countryCode?: string | null;
  employeeSocialRate?: Prisma.Decimal | null;
  employeeHealthRate?: Prisma.Decimal | null;
  incomeTaxRate?: Prisma.Decimal | null;
  taxFreeAllowance?: Prisma.Decimal | null;
};

export function payrollPolicyView(policy: PayrollPolicyRecord | null): PayrollPolicyView {
  const statutoryConfigured = Boolean(
    policy?.countryCode &&
      policy.employeeSocialRate !== null && policy.employeeSocialRate !== undefined &&
      policy.employeeHealthRate !== null && policy.employeeHealthRate !== undefined &&
      policy.incomeTaxRate !== null && policy.incomeTaxRate !== undefined &&
      policy.taxFreeAllowance !== null && policy.taxFreeAllowance !== undefined,
  );
  return {
    version: policy?.version ?? 0,
    mode: policy?.mode ?? "MONTHLY_BASE",
    standardMonthlyHours: policy?.standardMonthlyHours?.toFixed(2) ?? null,
    overtimeCoefficient: policy?.overtimeCoefficient?.toFixed(2) ?? null,
    countryCode: policy?.countryCode ?? null,
    employeeSocialRate: policy?.employeeSocialRate?.toFixed(2) ?? null,
    employeeHealthRate: policy?.employeeHealthRate?.toFixed(2) ?? null,
    incomeTaxRate: policy?.incomeTaxRate?.toFixed(2) ?? null,
    taxFreeAllowance: policy?.taxFreeAllowance?.toFixed(2) ?? null,
    statutoryConfigured,
    configured: policy !== null,
  };
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
    const statutoryKeys = ["countryCode", "employeeSocialRate", "employeeHealthRate", "incomeTaxRate", "taxFreeAllowance"] as const;
    const hasStatutoryInput = statutoryKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
    const submittedCountry = hasStatutoryInput ? optionalText(input.countryCode, "countryCode", 2)?.toUpperCase() ?? null : undefined;
    if (submittedCountry && !/^[A-Z]{2}$/.test(submittedCountry)) throw new BadRequestException("countryCode must contain two uppercase letters");
    const submittedSocial = hasStatutoryInput ? optionalDecimal(input.employeeSocialRate, "employeeSocialRate") : undefined;
    const submittedHealth = hasStatutoryInput ? optionalDecimal(input.employeeHealthRate, "employeeHealthRate") : undefined;
    const submittedTax = hasStatutoryInput ? optionalDecimal(input.incomeTaxRate, "incomeTaxRate") : undefined;
    const submittedAllowance = hasStatutoryInput ? optionalDecimal(input.taxFreeAllowance, "taxFreeAllowance") : undefined;
    for (const [label, rate] of [["employeeSocialRate", submittedSocial], ["employeeHealthRate", submittedHealth], ["incomeTaxRate", submittedTax]] as const) {
      if (rate && (rate.isNegative() || rate.greaterThan(100) || rate.decimalPlaces() > 2)) throw new BadRequestException(`${label} must be between 0 and 100 with at most two decimals`);
    }
    if (submittedAllowance && (submittedAllowance.isNegative() || submittedAllowance.decimalPlaces() > 2)) throw new BadRequestException("taxFreeAllowance must be non-negative with at most two decimals");
    const policy = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "companies" WHERE "id" = ${scope.companyId} AND "organizationId" = ${scope.organizationId} FOR UPDATE`;
      const current = await tx.companyPayrollPolicy.findFirst({ where: scope });
      if ((current?.version ?? 0) !== expectedVersion) throw new ConflictException("The payroll policy changed; reload its current version");
      const data = {
        mode,
        standardMonthlyHours,
        overtimeCoefficient,
        ...(hasStatutoryInput ? { countryCode: submittedCountry, employeeSocialRate: submittedSocial, employeeHealthRate: submittedHealth, incomeTaxRate: submittedTax, taxFreeAllowance: submittedAllowance } : {}),
        updatedByUserId: actorUserId,
      };
      const candidate = {
        countryCode: hasStatutoryInput ? submittedCountry : current?.countryCode ?? null,
        employeeSocialRate: hasStatutoryInput ? submittedSocial : current?.employeeSocialRate ?? null,
        employeeHealthRate: hasStatutoryInput ? submittedHealth : current?.employeeHealthRate ?? null,
        incomeTaxRate: hasStatutoryInput ? submittedTax : current?.incomeTaxRate ?? null,
        taxFreeAllowance: hasStatutoryInput ? submittedAllowance : current?.taxFreeAllowance ?? null,
      };
      const supplied = [candidate.countryCode, candidate.employeeSocialRate, candidate.employeeHealthRate, candidate.incomeTaxRate, candidate.taxFreeAllowance];
      if (supplied.some((value) => value !== null && value !== undefined) && supplied.some((value) => value === null || value === undefined)) throw new BadRequestException("Configurez le pays, les trois taux et l'abattement avant d'activer les retenues légales");
      const result = current ? await tx.companyPayrollPolicy.update({ where: { id: current.id }, data: { ...data, version: current.version + 1 } }) : await tx.companyPayrollPolicy.create({ data: { ...scope, ...data } });
      await writeAudit(tx, scope, actorUserId, "hr.payroll.policy.updated", "CompanyPayrollPolicy", result.id, { version: result.version, mode, statutoryConfigured: Boolean(candidate.countryCode), countryCode: candidate.countryCode });
      return result;
    });
    return payrollPolicyView(policy);
  }
}
