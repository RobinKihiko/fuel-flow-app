
-- Idempotency log for fuel sale deductions
CREATE TABLE IF NOT EXISTS public.sale_deduction_log (
  idempotency_key text PRIMARY KEY,
  branch_fuel_type_id uuid NOT NULL,
  litres numeric NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  processed_by uuid
);

GRANT SELECT, INSERT ON public.sale_deduction_log TO authenticated;
GRANT ALL ON public.sale_deduction_log TO service_role;

ALTER TABLE public.sale_deduction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read deduction log"
  ON public.sale_deduction_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert deduction log"
  ON public.sale_deduction_log FOR INSERT TO authenticated WITH CHECK (true);

-- Replace deduct_fuel_sale with idempotent version
CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(
  _branch_fuel_type_id uuid,
  _litres numeric,
  _idempotency_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stock numeric;
  v_remaining numeric := _litres;
  r RECORD;
  v_take numeric;
  v_inserted boolean := false;
BEGIN
  IF _litres IS NULL OR _litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be positive';
  END IF;

  -- Idempotency guard: if key was already processed, exit without deducting.
  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    BEGIN
      INSERT INTO public.sale_deduction_log(idempotency_key, branch_fuel_type_id, litres, processed_by)
      VALUES (_idempotency_key, _branch_fuel_type_id, _litres, auth.uid());
      v_inserted := true;
    EXCEPTION WHEN unique_violation THEN
      -- Already processed; no-op.
      RETURN;
    END;
  END IF;

  -- Lock branch_fuel_types row
  SELECT stock_level INTO v_stock
    FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id FOR UPDATE;

  IF v_stock IS NULL THEN
    RAISE EXCEPTION 'Fuel product not found';
  END IF;

  IF v_stock < _litres THEN
    RAISE EXCEPTION 'Insufficient stock: % L requested, % L available', _litres, v_stock;
  END IF;

  UPDATE public.branch_fuel_types
     SET stock_level = stock_level - _litres,
         updated_at = now()
   WHERE id = _branch_fuel_type_id;

  FOR r IN
    SELECT t.id, t.current_level_litres
      FROM public.branch_fuel_type_tanks lnk
      JOIN public.tanks t ON t.id = lnk.tank_id
     WHERE lnk.branch_fuel_type_id = _branch_fuel_type_id
     ORDER BY lnk.created_at ASC
     FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF r.current_level_litres <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(r.current_level_litres, v_remaining);
    UPDATE public.tanks
       SET current_level_litres = current_level_litres - v_take,
           updated_at = now()
     WHERE id = r.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$function$;
