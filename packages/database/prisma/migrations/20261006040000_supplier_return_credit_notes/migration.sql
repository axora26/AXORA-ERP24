-- INC-06 / INC-08 — Avoir fournisseur prepare depuis un retour.
-- Historique des liens retour -> avoir : immuable (trigger). Un avoir n'est
-- lie qu'a un seul retour ; l'unicite d'un avoir NON ANNULE par retour est
-- garantie par le service (verrou du retour), le statut vivant sur l'avoir.

-- CreateTable
CREATE TABLE "supplier_return_credit_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierReturnId" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_return_credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_return_credit_notes_organizationId_companyId_suppl_idx" ON "supplier_return_credit_notes"("organizationId", "companyId", "supplierReturnId");
CREATE UNIQUE INDEX "supplier_return_credit_notes_creditNoteId_organizationId_co_key" ON "supplier_return_credit_notes"("creditNoteId", "organizationId", "companyId");
CREATE UNIQUE INDEX "supplier_returns_id_organizationId_companyId_key" ON "supplier_returns"("id", "organizationId", "companyId");

-- AddForeignKey
ALTER TABLE "supplier_return_credit_notes" ADD CONSTRAINT "supplier_return_credit_notes_supplierReturnId_organization_fkey" FOREIGN KEY ("supplierReturnId", "organizationId", "companyId") REFERENCES "supplier_returns"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_return_credit_notes" ADD CONSTRAINT "supplier_return_credit_notes_creditNoteId_organizationId_c_fkey" FOREIGN KEY ("creditNoteId", "organizationId", "companyId") REFERENCES "supplier_credit_notes"("id", "organizationId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Le lien est une piece de tracabilite : jamais modifie ni supprime.
CREATE TRIGGER "supplier_return_credit_notes_append_only"
  BEFORE UPDATE OR DELETE ON "supplier_return_credit_notes"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();
