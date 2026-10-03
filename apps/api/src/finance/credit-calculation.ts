import { BadRequestException } from "@nestjs/common";
import { Prisma } from "@axora24/database";

/** Cumulative deltas preserve the original monetary and tax rounding exactly. */
export function creditAllocation(source: { quantity: Prisma.Decimal; lineTotal: Prisma.Decimal; lineTax: Prisma.Decimal },
  already: { quantity: Prisma.Decimal; lineTotal: Prisma.Decimal; lineTax: Prisma.Decimal }, quantity: Prisma.Decimal) {
  if (!quantity.greaterThan(0) || !source.quantity.greaterThan(0)) throw new BadRequestException("A credit quantity must be positive");
  const cumulative = already.quantity.plus(quantity);
  if (cumulative.greaterThan(source.quantity)) throw new BadRequestException("Cumulative credited quantity exceeds the source invoice line");
  const target = (amount: Prisma.Decimal) => amount.mul(cumulative).div(source.quantity).toDecimalPlaces(2);
  const lineTotal = target(source.lineTotal).minus(already.lineTotal);
  const lineTax = target(source.lineTax).minus(already.lineTax);
  if (lineTotal.isNegative() || lineTax.isNegative()) throw new BadRequestException("The source credit allocation is inconsistent");
  return { lineTotal, lineTax };
}
