import { SetMetadata } from "@nestjs/common";

export const ALLOW_MFA_ENROLLMENT_KEY = "axora:allow-mfa-enrollment";

/** Autorise une route minimale pendant l'enrôlement imposé par l'organisation. */
export const AllowMfaEnrollment = () => SetMetadata(ALLOW_MFA_ENROLLMENT_KEY, true);
