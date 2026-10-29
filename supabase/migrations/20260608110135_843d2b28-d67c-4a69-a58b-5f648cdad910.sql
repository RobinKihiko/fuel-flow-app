
-- Trigger: ensure global fuel_types row exists for any branch_fuel_types row
CREATE OR REPLACE FUNCTION public.ensure_global_fuel_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.fuel_types (name, price_per_litre, stock_level, vat_rate)
  VALUES (NEW.name, NEW.price_per_litre, 0, COALESCE(NEW.vat_rate, 16))
  ON CONFLICT (name) DO UPDATE
    SET price_per_litre = EXCLUDED.price_per_litre,
        vat_rate = EXCLUDED.vat_rate,
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_fuel_types ON public.branch_fuel_types;
CREATE TRIGGER trg_sync_fuel_types
AFTER INSERT OR UPDATE ON public.branch_fuel_types
FOR EACH ROW EXECUTE FUNCTION public.ensure_global_fuel_type();

-- Backfill existing branch fuels
INSERT INTO public.fuel_types (name, price_per_litre, stock_level, vat_rate)
SELECT DISTINCT bft.name, bft.price_per_litre, 0, COALESCE(bft.vat_rate, 16)
FROM public.branch_fuel_types bft
ON CONFLICT (name) DO NOTHING;

-- Let managers view all profiles
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
