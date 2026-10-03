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
