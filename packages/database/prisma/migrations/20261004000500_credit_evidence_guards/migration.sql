ALTER TABLE "customer_credit_notes" ADD CONSTRAINT "customer_credit_totals" CHECK ("version" > 0 AND length(btrim("reason")) > 0 AND "subtotal" >= 0 AND "taxTotal" >= 0 AND "total" = "subtotal" + "taxTotal" AND "total" <> 'NaN'::numeric);
ALTER TABLE "supplier_credit_notes" ADD CONSTRAINT "supplier_credit_totals" CHECK ("version" > 0 AND length(btrim("reason")) > 0 AND "subtotal" >= 0 AND "taxTotal" >= 0 AND "total" = "subtotal" + "taxTotal" AND "total" <> 'NaN'::numeric);
ALTER TABLE "customer_credit_note_lines" ADD CONSTRAINT "customer_credit_line_values" CHECK ("quantity" > 0 AND "quantity" <> 'NaN'::numeric AND "unitPrice" >= 0 AND "lineTotal" >= 0 AND "lineTax" >= 0 AND "lineTotal" <> 'NaN'::numeric AND "lineTax" <> 'NaN'::numeric);
ALTER TABLE "supplier_credit_note_lines" ADD CONSTRAINT "supplier_credit_line_values" CHECK ("quantity" > 0 AND "quantity" <> 'NaN'::numeric AND "unitPrice" >= 0 AND "lineTotal" >= 0 AND "lineTax" >= 0 AND "lineTotal" <> 'NaN'::numeric AND "lineTax" <> 'NaN'::numeric);
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refund_target" CHECK (
  ("customerCreditNoteId" IS NOT NULL AND "supplierCreditNoteId" IS NULL AND "direction" = 'OUT') OR
  ("supplierCreditNoteId" IS NOT NULL AND "customerCreditNoteId" IS NULL AND "direction" = 'IN'));
ALTER TABLE "credit_refunds" ADD CONSTRAINT "credit_refund_positive" CHECK ("amount" > 0 AND "amount" <> 'NaN'::numeric);

CREATE FUNCTION "enforce_credit_note_evidence"() RETURNS trigger AS $$
DECLARE
  prefix TEXT;
  source_row RECORD;
  line_row RECORD;
  previous_quantity NUMERIC;
  previous_total NUMERIC;
  previous_tax NUMERIC;
  sum_total NUMERIC := 0;
  sum_tax NUMERIC := 0;
  line_count INTEGER := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Credit notes must be retained'; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" <> 'DRAFT' THEN RAISE EXCEPTION 'Issued or cancelled credit notes are immutable'; END IF;
    IF (NEW."sourceInvoiceId", NEW."organizationId", NEW."companyId") IS DISTINCT FROM
      (OLD."sourceInvoiceId", OLD."organizationId", OLD."companyId") THEN RAISE EXCEPTION 'Credit note source and scope are immutable'; END IF;
  ELSIF NEW."status" <> 'DRAFT' THEN RAISE EXCEPTION 'A credit note must start as a draft';
  END IF;
  prefix := CASE WHEN TG_TABLE_NAME = 'customer_credit_notes' THEN 'customer' ELSE 'supplier' END;
  EXECUTE format('SELECT * FROM %I WHERE "id"=$1 AND "organizationId"=$2 AND "companyId"=$3 FOR UPDATE', prefix || '_invoices')
    INTO source_row USING NEW."sourceInvoiceId", NEW."organizationId", NEW."companyId";
  IF source_row."id" IS NULL OR source_row."currency" <> NEW."currency" OR
    (prefix = 'customer' AND source_row."status"::TEXT NOT IN ('ISSUED','PARTIALLY_PAID','PAID')) OR
    (prefix = 'supplier' AND source_row."status"::TEXT NOT IN ('APPROVED','PARTIALLY_PAID','PAID')) THEN
    RAISE EXCEPTION 'Credit note source state or currency mismatch';
  END IF;
  IF NEW."status" = 'ISSUED' THEN
    IF NEW."issueDate" IS NULL OR NEW."code" IS NULL OR NEW."issuedByUserId" IS NULL THEN RAISE EXCEPTION 'Issued credit note requires date, code and actor'; END IF;
    FOR line_row IN EXECUTE format('SELECT c.*, s."quantity" AS source_quantity, s."unitPrice" AS source_price, s."taxRate" AS source_rate, s."lineTotal" AS source_total, s."lineTax" AS source_tax FROM %I c JOIN %I s ON s."id"=c."sourceInvoiceLineId" WHERE c."creditNoteId"=$1', prefix || '_credit_note_lines', prefix || '_invoice_lines') USING NEW."id" LOOP
      line_count := line_count + 1;
      EXECUTE format('SELECT COALESCE(sum(c."quantity"),0), COALESCE(sum(c."lineTotal"),0), COALESCE(sum(c."lineTax"),0) FROM %I c JOIN %I n ON n."id"=c."creditNoteId" WHERE c."sourceInvoiceLineId"=$1 AND n."status"=''ISSUED''', prefix || '_credit_note_lines', prefix || '_credit_notes')
        INTO previous_quantity, previous_total, previous_tax USING line_row."sourceInvoiceLineId";
      IF previous_quantity + line_row."quantity" > line_row.source_quantity OR
        line_row."unitPrice" <> line_row.source_price OR line_row."taxRate" <> line_row.source_rate OR
        line_row."lineTotal" <> round(line_row.source_total * (previous_quantity + line_row."quantity") / line_row.source_quantity, 2) - previous_total OR
        line_row."lineTax" <> round(line_row.source_tax * (previous_quantity + line_row."quantity") / line_row.source_quantity, 2) - previous_tax THEN
        RAISE EXCEPTION 'Credit quantity or cumulative rounding does not match source evidence';
      END IF;
      sum_total := sum_total + line_row."lineTotal";
      sum_tax := sum_tax + line_row."lineTax";
    END LOOP;
    IF line_count = 0 OR sum_total <> NEW."subtotal" OR sum_tax <> NEW."taxTotal" THEN RAISE EXCEPTION 'Credit note totals do not match its lines'; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "customer_credit_evidence_guard" BEFORE INSERT OR UPDATE OR DELETE ON "customer_credit_notes" FOR EACH ROW EXECUTE FUNCTION "enforce_credit_note_evidence"();
CREATE TRIGGER "supplier_credit_evidence_guard" BEFORE INSERT OR UPDATE OR DELETE ON "supplier_credit_notes" FOR EACH ROW EXECUTE FUNCTION "enforce_credit_note_evidence"();

CREATE FUNCTION "enforce_credit_line_draft"() RETURNS trigger AS $$
DECLARE
  prefix TEXT;
  parent_status TEXT;
  parent_id TEXT;
BEGIN
  prefix := CASE WHEN TG_TABLE_NAME = 'customer_credit_note_lines' THEN 'customer' ELSE 'supplier' END;
  IF TG_OP = 'UPDATE' AND (NEW."creditNoteId", NEW."sourceInvoiceId", NEW."sourceInvoiceLineId", NEW."organizationId", NEW."companyId") IS DISTINCT FROM
    (OLD."creditNoteId", OLD."sourceInvoiceId", OLD."sourceInvoiceLineId", OLD."organizationId", OLD."companyId") THEN RAISE EXCEPTION 'Credit line source and scope are immutable'; END IF;
  parent_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."creditNoteId" ELSE NEW."creditNoteId" END;
  EXECUTE format('SELECT "status"::TEXT FROM %I WHERE "id"=$1 FOR UPDATE', prefix || '_credit_notes') INTO parent_status USING parent_id;
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'Only draft credit lines can change'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "customer_credit_line_draft_guard" BEFORE INSERT OR UPDATE OR DELETE ON "customer_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "enforce_credit_line_draft"();
CREATE TRIGGER "supplier_credit_line_draft_guard" BEFORE INSERT OR UPDATE OR DELETE ON "supplier_credit_note_lines" FOR EACH ROW EXECUTE FUNCTION "enforce_credit_line_draft"();

CREATE FUNCTION "enforce_credit_refund_evidence"() RETURNS trigger AS $$
DECLARE
  prefix TEXT;
  target_id TEXT;
  note_row RECORD;
  invoice_row RECORD;
  bank_row RECORD;
  credited NUMERIC;
  refunded NUMERIC;
  note_refunded NUMERIC;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Credit refunds are append-only'; END IF;
  prefix := CASE WHEN NEW."customerCreditNoteId" IS NOT NULL THEN 'customer' ELSE 'supplier' END;
  target_id := COALESCE(NEW."customerCreditNoteId", NEW."supplierCreditNoteId");
  EXECUTE format('SELECT * FROM %I WHERE "id"=$1 AND "organizationId"=$2 AND "companyId"=$3', prefix || '_credit_notes') INTO note_row USING target_id, NEW."organizationId", NEW."companyId";
  IF note_row."id" IS NULL OR note_row."status" <> 'ISSUED' OR note_row."currency" <> NEW."currency" OR NEW."refundedAt" < note_row."issueDate" THEN RAISE EXCEPTION 'Refund must reference an issued credit note in the same currency and period'; END IF;
  EXECUTE format('SELECT * FROM %I WHERE "id"=$1 FOR UPDATE', prefix || '_invoices') INTO invoice_row USING note_row."sourceInvoiceId";
  SELECT * INTO bank_row FROM "bank_accounts" WHERE "id"=NEW."bankAccountId" AND "organizationId"=NEW."organizationId" AND "companyId"=NEW."companyId" FOR UPDATE;
  IF bank_row."id" IS NULL OR NOT bank_row."isActive" OR bank_row."currency" <> NEW."currency" THEN RAISE EXCEPTION 'Refund bank account scope or currency mismatch'; END IF;
  EXECUTE format('SELECT COALESCE(sum("total"),0) FROM %I WHERE "sourceInvoiceId"=$1 AND "status"=''ISSUED''', prefix || '_credit_notes') INTO credited USING invoice_row."id";
  EXECUTE format('SELECT COALESCE(sum(r."amount"),0) FROM "credit_refunds" r JOIN %I n ON n."id"=r.%I WHERE n."sourceInvoiceId"=$1', prefix || '_credit_notes', prefix || 'CreditNoteId') INTO refunded USING invoice_row."id";
  EXECUTE format('SELECT COALESCE(sum("amount"),0) FROM "credit_refunds" WHERE %I=$1', prefix || 'CreditNoteId') INTO note_refunded USING target_id;
  IF NEW."amount" > greatest(invoice_row."paidAmount" - (invoice_row."total" - credited) - refunded,0) OR note_refunded + NEW."amount" > note_row."total" THEN RAISE EXCEPTION 'Refund exceeds the outstanding credit'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "credit_refund_evidence_guard" BEFORE INSERT OR UPDATE OR DELETE ON "credit_refunds" FOR EACH ROW EXECUTE FUNCTION "enforce_credit_refund_evidence"();
