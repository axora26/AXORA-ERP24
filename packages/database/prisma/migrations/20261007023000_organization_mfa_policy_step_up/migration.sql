ALTER TABLE "organizations"
  ADD COLUMN "mfaRequired" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sessions"
  ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);

COMMENT ON COLUMN "organizations"."mfaRequired" IS
  'Exige une MFA active pour tous les utilisateurs de l''organisation.';

COMMENT ON COLUMN "sessions"."mfaVerifiedAt" IS
  'Derniere preuve MFA fraiche de cette session uniquement.';
