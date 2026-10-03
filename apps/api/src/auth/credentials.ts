import { BadRequestException } from "@nestjs/common";
import { assertBody, requiredEmail, requiredText } from "../common/validation.js";
import type { LoginDto, RegisterOrganizationDto } from "./auth.dto.js";

function keys(input: Record<string, unknown>, allowed: string[]): void {
  for (const field of Object.keys(input)) if (!allowed.includes(field)) throw new BadRequestException(`${field} is not allowed`);
}
export function credentialPassword(value: unknown, field: string, minimum = 1): string {
  // Preserve spaces: trimming passwords changes the credential being checked.
  if (typeof value !== "string" || value.length < minimum || value.length > 256 || value.includes("\0")) throw new BadRequestException(`${field} must contain ${minimum} to 256 characters`);
  return value;
}
function organizationSlug(value: unknown): string {
  const result = requiredText(value, "organizationSlug", 80);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result)) throw new BadRequestException("organizationSlug is invalid");
  return result;
}
export function parseLogin(body: unknown): LoginDto {
  const input = assertBody(body); keys(input, ["email", "password", "organizationSlug"]);
  return { email: requiredEmail(input.email, "email"), password: credentialPassword(input.password, "password"), ...(input.organizationSlug === undefined ? {} : { organizationSlug: organizationSlug(input.organizationSlug) }) };
}
export function parseRegistration(body: unknown): RegisterOrganizationDto {
  const input = assertBody(body); keys(input, ["organizationName", "organizationSlug", "companyName", "ownerEmail", "ownerPassword", "ownerFullName"]);
  return { organizationName: requiredText(input.organizationName, "organizationName", 120), organizationSlug: organizationSlug(input.organizationSlug), companyName: requiredText(input.companyName, "companyName", 120), ownerEmail: requiredEmail(input.ownerEmail, "ownerEmail"), ownerPassword: credentialPassword(input.ownerPassword, "ownerPassword", 12), ownerFullName: requiredText(input.ownerFullName, "ownerFullName", 120) };
}
