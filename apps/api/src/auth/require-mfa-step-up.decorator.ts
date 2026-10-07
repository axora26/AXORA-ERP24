import { applyDecorators, SetMetadata, UseGuards } from "@nestjs/common";
import { MfaStepUpGuard } from "./mfa-step-up.guard.js";

export const MFA_STEP_UP_KEY = "axora:mfa-step-up";
export interface MfaStepUpOptions { always?: boolean }

/** Exige une preuve MFA récente en plus de la session et du RBAC. */
export function RequireMfaStepUp(options: MfaStepUpOptions = {}) {
  return applyDecorators(SetMetadata(MFA_STEP_UP_KEY, options), UseGuards(MfaStepUpGuard));
}
