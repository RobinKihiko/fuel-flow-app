
-- Add locking columns to daily_fuel_stock so admins can "Finalize Day"
ALTER TABLE public.daily_fuel_stock
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid;

-- Prevent edits to a locked day unless the actor is an admin (who may unlock/correct)
CREATE OR REPLACE FUNCTION public.enforce_daily_fuel_stock_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.locked = true THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'This day has been finalized and is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_daily_fuel_stock_lock ON public.daily_fuel_stock;
CREATE TRIGGER trg_enforce_daily_fuel_stock_lock
  BEFORE UPDATE ON public.daily_fuel_stock
  FOR EACH ROW EXECUTE FUNCTION public.enforce_daily_fuel_stock_lock();
