-- Widen source operands; existing values and invoice totals stay exact.
ALTER TABLE "customer_invoice_lines"
  ALTER COLUMN "quantity" TYPE DECIMAL(24,6),
  ALTER COLUMN "unitPrice" TYPE DECIMAL(24,6);
