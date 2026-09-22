import { BadRequestException } from "@nestjs/common";

export class CreateQuoteDto {
  companyId?: string;
  dqeId!: string;
  code!: string;
  title!: string;
}

export class SubmitQuoteDto {
  companyId?: string;
}

export class AcceptQuoteDto {
  companyId?: string;
}

export class RejectQuoteDto {
  companyId?: string;
  reason!: string;
}

export class CreateContractDto {
  companyId?: string;
  quoteId!: string;
  code!: string;
  title!: string;
}

export function requiredText(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new BadRequestException(`${field} exceeds ${maxLength} characters`);
  }
  return trimmed;
}
