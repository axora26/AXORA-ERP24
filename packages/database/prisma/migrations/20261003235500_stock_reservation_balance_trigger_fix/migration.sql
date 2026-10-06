CREATE OR REPLACE FUNCTION axora_stock_balance_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reserved numeric;
BEGIN
  -- INSERT ... ON CONFLICT DO NOTHING in the ledger fires this trigger before
  -- conflict resolution. Keep the existing balance as the source of truth.
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM "stock_balances"
    WHERE "itemId" = NEW."itemId" AND "warehouseId" = NEW."warehouseId"
      AND "organizationId" = NEW."organizationId" AND "companyId" = NEW."companyId"
  ) THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM("remainingQuantity"), 0) INTO reserved FROM "stock_reservations"
    WHERE "itemId" = NEW."itemId" AND "warehouseId" = NEW."warehouseId"
      AND "organizationId" = NEW."organizationId" AND "companyId" = NEW."companyId"
      AND "status" = 'ACTIVE';
  IF NEW."quantity" < reserved THEN
    RAISE EXCEPTION 'Physical stock cannot fall below active reservations';
  END IF;
  RETURN NEW;
END $$;
