-- CreateTable
CREATE TABLE "ai_copilot_sessions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_copilot_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_inference_evidence" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "permissionChecks" JSONB NOT NULL,
    "sources" JSONB NOT NULL,
    "blocks" JSONB NOT NULL,
    "answer" TEXT NOT NULL,
    "answerSha256" CHAR(64) NOT NULL,
    "engine" TEXT NOT NULL,
    "modelProvider" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_inference_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_copilot_sessions_userId_companyId_lastActivityAt_idx" ON "ai_copilot_sessions"("userId", "companyId", "lastActivityAt");

-- CreateIndex
CREATE INDEX "ai_inference_evidence_organizationId_companyId_createdAt_idx" ON "ai_inference_evidence"("organizationId", "companyId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_inference_evidence_sessionId_createdAt_idx" ON "ai_inference_evidence"("sessionId", "createdAt");

-- AddForeignKey
ALTER TABLE "ai_inference_evidence" ADD CONSTRAINT "ai_inference_evidence_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ai_copilot_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Garanties INC-22 (copilote IA)
-- ---------------------------------------------------------------------------

-- Session : appartient a un utilisateur, une societe et une organisation, pour toujours.
CREATE OR REPLACE FUNCTION axora_ai_session_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."organizationId" <> OLD."organizationId" OR NEW."companyId" <> OLD."companyId" OR NEW."userId" <> OLD."userId" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'A copilot session owner is immutable' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_copilot_sessions_guard" BEFORE UPDATE ON "ai_copilot_sessions" FOR EACH ROW EXECUTE FUNCTION axora_ai_session_guard();
CREATE TRIGGER "ai_copilot_sessions_no_delete" BEFORE DELETE ON "ai_copilot_sessions" FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();

-- Preuve d'inference : empreinte de la reponse verifiee par la base, append-only.
ALTER TABLE "ai_inference_evidence" ADD CONSTRAINT "ai_inference_evidence_answer_sha256" CHECK ("answerSha256" = encode(sha256(convert_to("answer", 'UTF8')), 'hex'));
ALTER TABLE "ai_inference_evidence" ADD CONSTRAINT "ai_inference_evidence_mode" CHECK ("mode" IN ('BRIEFING', 'TOOLS', 'LOOKUP', 'HELP'));
ALTER TABLE "ai_inference_evidence" ADD CONSTRAINT "ai_inference_evidence_latency" CHECK ("latencyMs" >= 0);
CREATE TRIGGER "ai_inference_evidence_append_only" BEFORE UPDATE OR DELETE ON "ai_inference_evidence" FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

-- Une preuve appartient au meme utilisateur / societe / organisation que sa session.
CREATE OR REPLACE FUNCTION axora_ai_evidence_session_match() RETURNS trigger AS $$
DECLARE
  owner RECORD;
BEGIN
  SELECT "organizationId", "companyId", "userId" INTO owner FROM "ai_copilot_sessions" WHERE "id" = NEW."sessionId";
  IF owner."organizationId" <> NEW."organizationId" OR owner."companyId" <> NEW."companyId" OR owner."userId" <> NEW."userId" THEN
    RAISE EXCEPTION 'Evidence must belong to the owner of its session' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ai_inference_evidence_session_match" BEFORE INSERT ON "ai_inference_evidence" FOR EACH ROW EXECUTE FUNCTION axora_ai_evidence_session_match();
