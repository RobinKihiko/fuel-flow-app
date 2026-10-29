
-- 1. Harden deduct_fuel_sale RPC (both overloads) with branch access check
CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(_branch_fuel_type_id uuid, _litres numeric, _idempotency_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock numeric;
  v_remaining numeric := _litres;
  r RECORD;
  v_take numeric;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _litres IS NULL OR _litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be positive';
  END IF;

  SELECT branch_id INTO v_branch_id FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Fuel product not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.is_assigned_to_branch(auth.uid(), v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to deduct fuel for this branch';
  END IF;

  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    BEGIN
      INSERT INTO public.sale_deduction_log(idempotency_key, branch_fuel_type_id, litres, processed_by)
      VALUES (_idempotency_key, _branch_fuel_type_id, _litres, auth.uid());
    EXCEPTION WHEN unique_violation THEN
      RETURN;
    END;
  END IF;

  SELECT stock_level INTO v_stock
    FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id FOR UPDATE;

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

CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(_branch_fuel_type_id uuid, _litres numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.deduct_fuel_sale(_branch_fuel_type_id, _litres, NULL);
END;
$function$;

-- 2. Tighten sales INSERT policy to require branch membership
DROP POLICY IF EXISTS "Attendants can create sales" ON public.sales;
CREATE POLICY "Users create sales for their branch"
  ON public.sales FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = attendant_id
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.is_assigned_to_branch(auth.uid(), branch_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.branch_fuel_types bft
      WHERE bft.id = sales.fuel_type_id AND bft.branch_id = sales.branch_id
    )
  );

-- Block non-admins from backdating created_at via client
CREATE OR REPLACE FUNCTION public.enforce_sales_created_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sales_created_at ON public.sales;
CREATE TRIGGER trg_enforce_sales_created_at
  BEFORE INSERT OR UPDATE OF created_at ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_created_at();

-- 3. Scope mpesa_transactions INSERT to sale ownership/role
DROP POLICY IF EXISTS "Authenticated can create mpesa" ON public.mpesa_transactions;
CREATE POLICY "Attendants create mpesa for own sale"
  ON public.mpesa_transactions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = mpesa_transactions.sale_id
        AND (s.attendant_id = auth.uid() OR public.is_assigned_to_branch(auth.uid(), s.branch_id))
    )
  );

-- 4. Restrict sale_deduction_log to admins (SECURITY DEFINER RPC writes bypass RLS)
DROP POLICY IF EXISTS "Authenticated can insert deduction log" ON public.sale_deduction_log;
DROP POLICY IF EXISTS "Authenticated can read deduction log" ON public.sale_deduction_log;
CREATE POLICY "Admins read deduction log"
  ON public.sale_deduction_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert deduction log"
  ON public.sale_deduction_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Ensure new attendants must rotate password (defaults + backfill for accounts flagged)
ALTER TABLE public.profiles ALTER COLUMN must_change_password SET DEFAULT true;
