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

export class CreateContractVariationDto {
  companyId?: string;
  code!: string;
  title!: string;
  reason!: string;
  lines!: Array<{
    sourceContractLotId?: string;
    position: number;
    reference?: string;
    designation: string;
    unitCode: string;
    quantity: string;
    unitPrice: string;
  }>;
}

export class ContractVariationTransitionDto {
  companyId?: string;
  expectedVersion!: number;
  note?: string;
}

export function parseCreateContractVariationDto(
  body: unknown,
): CreateContractVariationDto {
  const input = strictObject(body, "Request body");
  rejectUnknownFields(
    input,
    ["companyId", "code", "title", "reason", "lines"],
    "Request body",
  );
  if (
    "companyId" in input &&
    input.companyId !== undefined &&
    typeof input.companyId !== "string"
  ) {
    throw new BadRequestException("companyId must be a string");
  }
  if (!Array.isArray(input.lines)) {
    throw new BadRequestException("lines must be an array");
  }
  input.lines.forEach((rawLine, index) => {
    const line = strictObject(rawLine, `lines[${index}]`);
    rejectUnknownFields(
      line,
      [
        "sourceContractLotId",
        "position",
        "reference",
        "designation",
        "unitCode",
        "quantity",
        "unitPrice",
      ],
      `lines[${index}]`,
    );
  });
  return input as unknown as CreateContractVariationDto;
}

export function parseContractVariationTransitionDto(
  body: unknown,
): ContractVariationTransitionDto {
  const input = strictObject(body, "Request body");
  rejectUnknownFields(
    input,
    ["companyId", "expectedVersion", "note"],
    "Request body",
  );
  if (
    "companyId" in input &&
    input.companyId !== undefined &&
    typeof input.companyId !== "string"
  ) {
    throw new BadRequestException("companyId must be a string");
  }
  if (
    !Number.isSafeInteger(input.expectedVersion) ||
    (input.expectedVersion as number) < 1 ||
    (input.expectedVersion as number) > 2147483647
  ) {
    throw new BadRequestException(
      "expectedVersion must be a positive 32-bit integer",
    );
  }
  if (
    "note" in input &&
    input.note !== undefined &&
    input.note !== null &&
    typeof input.note !== "string"
  ) {
    throw new BadRequestException("note must be a string");
  }
  return input as unknown as ContractVariationTransitionDto;
}

function strictObject(value: unknown, field: string): Record<string, unknown> {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new BadRequestException(`${field} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(
  input: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const unknown = Object.keys(input).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new BadRequestException(
      `${field} contains unknown field: ${unknown[0]}`,
    );
  }
}

export function requiredText(
  value: unknown,
  field: string,
  maxLength = 500,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException(`${field} is required`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new BadRequestException(`${field} exceeds ${maxLength} characters`);
  }
  return trimmed;
}
