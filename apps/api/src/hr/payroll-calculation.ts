import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@axora24/database";
import type { PayrollPolicyView } from "@axora24/contracts";

export function calculateAutomaticPay(baseSalary: Prisma.Decimal, validatedHours: Prisma.Decimal, policy: PayrollPolicyView): { regularHours: Prisma.Decimal; overtimeHours: Prisma.Decimal; hourlyRate: Prisma.Decimal; automaticAmount: Prisma.Decimal } {
  if (baseSalary.isNegative() || validatedHours.isNegative()) throw new BadRequestException("Payroll source amounts cannot be negative");
  if (policy.mode === "MONTHLY_BASE") return { regularHours: validatedHours, overtimeHours: new Prisma.Decimal(0), hourlyRate: new Prisma.Decimal(0), automaticAmount: baseSalary.toDecimalPlaces(2) };
  if (!policy.standardMonthlyHours || !policy.overtimeCoefficient) throw new BadRequestException("Hourly payroll requires explicit standard hours and overtime coefficient");
  const standardHours = new Prisma.Decimal(policy.standardMonthlyHours);
  const coefficient = new Prisma.Decimal(policy.overtimeCoefficient);
  if (!standardHours.greaterThan(0) || coefficient.lessThan(1)) throw new BadRequestException("Invalid hourly payroll policy");
  const regularHours = Prisma.Decimal.min(validatedHours, standardHours);
  const overtimeHours = Prisma.Decimal.max(validatedHours.minus(standardHours), 0);
  const rate = baseSalary.dividedBy(standardHours);
  return { regularHours, overtimeHours, hourlyRate: rate.toDecimalPlaces(6), automaticAmount: regularHours.times(rate).plus(overtimeHours.times(rate).times(coefficient)).toDecimalPlaces(2) };
}

/**
 * Calcule les retenues salariales uniquement quand l'administrateur a fourni
 * une photographie complète de politique. Les pourcentages sont des taux
 * salariés ; aucune règle nationale n'est inventée par défaut.
 */
export function calculateStatutoryDeductions(grossAmount: Prisma.Decimal, policy: PayrollPolicyView): {
  incomeTax: Prisma.Decimal;
  socialContribution: Prisma.Decimal;
  healthContribution: Prisma.Decimal;
  totalDeductions: Prisma.Decimal;
  netAmount: Prisma.Decimal;
} | null {
  if (!policy.statutoryConfigured || !policy.employeeSocialRate || !policy.employeeHealthRate || !policy.incomeTaxRate || policy.taxFreeAllowance === null) return null;
  if (grossAmount.isNegative()) throw new BadRequestException("Gross amount cannot be negative");
  const socialContribution = grossAmount.times(new Prisma.Decimal(policy.employeeSocialRate)).dividedBy(100).toDecimalPlaces(2);
  const healthContribution = grossAmount.times(new Prisma.Decimal(policy.employeeHealthRate)).dividedBy(100).toDecimalPlaces(2);
  const taxable = Prisma.Decimal.max(grossAmount.minus(new Prisma.Decimal(policy.taxFreeAllowance)), 0);
  const incomeTax = taxable.times(new Prisma.Decimal(policy.incomeTaxRate)).dividedBy(100).toDecimalPlaces(2);
  const totalDeductions = socialContribution.plus(healthContribution).plus(incomeTax).toDecimalPlaces(2);
  const netAmount = Prisma.Decimal.max(grossAmount.minus(totalDeductions), 0).toDecimalPlaces(2);
  return { incomeTax, socialContribution, healthContribution, totalDeductions, netAmount };
}
