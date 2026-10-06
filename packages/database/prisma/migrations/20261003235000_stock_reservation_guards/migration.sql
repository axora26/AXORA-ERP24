ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_quantity_check" CHECK ("quantity" > 0 AND "remainingQuantity" >= 0 AND "remainingQuantity" <= "quantity");
ALTER TABLE "stock_reservation_events"
  ADD CONSTRAINT "stock_reservation_events_quantity_check" CHECK ("quantity" > 0);

CREATE OR REPLACE FUNCTION axora_stock_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  on_hand numeric;
  reserved numeric;
BEGIN
  IF NEW."quantity" <= 0 OR NEW."remainingQuantity" < 0 OR NEW."remainingQuantity" > NEW."quantity" THEN
    RAISE EXCEPTION 'Invalid stock reservation quantity';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - ARRAY['remainingQuantity','status','releasedByUserId','releasedAt','version','updatedAt']) IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['remainingQuantity','status','releasedByUserId','releasedAt','version','updatedAt']) THEN
      RAISE EXCEPTION 'Stock reservation source is immutable';
    END IF;
    IF current_setting('axora.stock_reservation_mutation', true) <> '1' THEN
      RAISE EXCEPTION 'Stock reservation state changes must use the reservation service';
    END IF;
  END IF;
  IF NEW."status" = 'ACTIVE' AND NEW."remainingQuantity" <= 0 THEN
    RAISE EXCEPTION 'An active reservation must have a remaining quantity';
  END IF;
  IF NEW."status" IN ('FULFILLED','RELEASED') AND NEW."remainingQuantity" <> 0 THEN
    RAISE EXCEPTION 'A closed reservation must have no remaining quantity';
  END IF;
  SELECT "quantity" INTO on_hand FROM "stock_balances"
    WHERE "itemId" = NEW."itemId" AND "warehouseId" = NEW."warehouseId"
      AND "organizationId" = NEW."organizationId" AND "companyId" = NEW."companyId"
    FOR UPDATE;
  IF on_hand IS NULL THEN RAISE EXCEPTION 'A stock balance is required before reserving'; END IF;
  SELECT COALESCE(SUM("remainingQuantity"), 0) INTO reserved FROM "stock_reservations"
    WHERE "itemId" = NEW."itemId" AND "warehouseId" = NEW."warehouseId"
      AND "organizationId" = NEW."organizationId" AND "companyId" = NEW."companyId"
      AND "status" = 'ACTIVE' AND (TG_OP = 'INSERT' OR "id" <> NEW."id");
  IF NEW."status" = 'ACTIVE' AND reserved + NEW."remainingQuantity" > on_hand THEN
    RAISE EXCEPTION 'Reserved quantity exceeds physical stock';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "stock_reservations_guard" BEFORE INSERT OR UPDATE ON "stock_reservations"
  FOR EACH ROW EXECUTE FUNCTION axora_stock_reservation_guard();
CREATE TRIGGER "stock_reservations_no_delete" BEFORE DELETE ON "stock_reservations"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_delete();
CREATE TRIGGER "stock_reservation_events_append_only" BEFORE UPDATE OR DELETE ON "stock_reservation_events"
  FOR EACH ROW EXECUTE FUNCTION axora_forbid_mutation();

CREATE OR REPLACE FUNCTION axora_stock_balance_reservation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reserved numeric;
BEGIN
  SELECT COALESCE(SUM("remainingQuantity"), 0) INTO reserved FROM "stock_reservations"
    WHERE "itemId" = NEW."itemId" AND "warehouseId" = NEW."warehouseId"
      AND "organizationId" = NEW."organizationId" AND "companyId" = NEW."companyId"
      AND "status" = 'ACTIVE';
  IF NEW."quantity" < reserved THEN
    RAISE EXCEPTION 'Physical stock cannot fall below active reservations';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "stock_balances_reservation_guard" BEFORE INSERT OR UPDATE ON "stock_balances"
  FOR EACH ROW EXECUTE FUNCTION axora_stock_balance_reservation_guard();
