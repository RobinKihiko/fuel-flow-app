CREATE OR REPLACE FUNCTION public.revert_fuel_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.tank_id IS NOT NULL THEN
    UPDATE public.tanks
       SET current_level_litres = GREATEST(0, current_level_litres - OLD.litres),
           updated_at = now()
     WHERE id = OLD.tank_id;
  END IF;

  IF OLD.branch_fuel_type_id IS NOT NULL THEN
    UPDATE public.branch_fuel_types
       SET stock_level = GREATEST(0, stock_level - OLD.litres),
           updated_at = now()
     WHERE id = OLD.branch_fuel_type_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS revert_fuel_topup_trg ON public.fuel_topups;
CREATE TRIGGER revert_fuel_topup_trg
BEFORE DELETE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.revert_fuel_topup();