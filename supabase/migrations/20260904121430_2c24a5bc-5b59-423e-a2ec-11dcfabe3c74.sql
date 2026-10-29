-- Helper: recompute a daily_fuel_stock row from live data
CREATE OR REPLACE FUNCTION public.recalc_daily_fuel_stock(_bft_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  b RECORD;
  v_closing numeric;
  v_topups numeric;
  v_sold numeric;
  v_revenue numeric;
  d_start timestamptz := (_date::timestamp AT TIME ZONE 'Africa/Nairobi');
  d_end   timestamptz := ((_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');
BEGIN
  IF _bft_id IS NULL OR _date IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_fuel_stock WHERE branch_fuel_type_id = _bft_id AND stock_date = _date) THEN
    RETURN;
  END IF;

  SELECT id, branch_id, name, stock_level INTO b
    FROM public.branch_fuel_types WHERE id = _bft_id;
  IF b IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(tk.current_level_litres), b.stock_level) INTO v_closing
    FROM public.branch_fuel_type_tanks lnk
    JOIN public.tanks tk ON tk.id = lnk.tank_id
   WHERE lnk.branch_fuel_type_id = b.id;
  v_closing := GREATEST(0, COALESCE(v_closing, b.stock_level));

  SELECT COALESCE(SUM(litres), 0) INTO v_topups
    FROM public.fuel_topups
   WHERE branch_fuel_type_id = b.id
     AND created_at >= d_start AND created_at < d_end;

  SELECT COALESCE(SUM(sa.litres), 0), COALESCE(SUM(sa.total_amount), 0)
    INTO v_sold, v_revenue
    FROM public.sales sa
    JOIN public.fuel_types ft ON ft.id = sa.fuel_type_id
   WHERE sa.branch_id = b.branch_id AND ft.name = b.name
     AND sa.reversed_at IS NULL
     AND sa.created_at >= d_start AND sa.created_at < d_end;

  UPDATE public.daily_fuel_stock
     SET opening_stock = GREATEST(0, ROUND(v_closing + v_sold - v_topups, 2)),
         closing_stock = ROUND(v_closing, 2),
         topups_litres = ROUND(v_topups, 2),
         sold_litres   = ROUND(v_sold, 2),
         revenue       = ROUND(v_revenue, 2),
         updated_at    = now()
   WHERE branch_fuel_type_id = b.id AND stock_date = _date;
END;
$$;

-- Safer revert on delete: block instead of silently clamping
CREATE OR REPLACE FUNCTION public.revert_fuel_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tank numeric;
  v_stock numeric;
BEGIN
  IF OLD.tank_id IS NOT NULL THEN
    SELECT current_level_litres INTO v_tank FROM public.tanks WHERE id = OLD.tank_id FOR UPDATE;
    IF v_tank IS NOT NULL AND v_tank < OLD.litres THEN
      RAISE EXCEPTION 'Cannot remove this top-up: the tank only holds % L now, less than the % L being reversed. Record a dip reading first.', ROUND(v_tank,2), ROUND(OLD.litres,2);
    END IF;
    UPDATE public.tanks
       SET current_level_litres = GREATEST(0, current_level_litres - OLD.litres),
           updated_at = now()
     WHERE id = OLD.tank_id;
  END IF;

  IF OLD.branch_fuel_type_id IS NOT NULL THEN
    SELECT stock_level INTO v_stock FROM public.branch_fuel_types WHERE id = OLD.branch_fuel_type_id FOR UPDATE;
    IF v_stock IS NOT NULL AND v_stock < OLD.litres THEN
      RAISE EXCEPTION 'Cannot remove this top-up: product stock is % L, less than the % L being reversed.', ROUND(v_stock,2), ROUND(OLD.litres,2);
    END IF;
    UPDATE public.branch_fuel_types
       SET stock_level = GREATEST(0, stock_level - OLD.litres),
           updated_at = now()
     WHERE id = OLD.branch_fuel_type_id;
  END IF;

  RETURN OLD;
END;
$$;

-- Apply edits to a top-up (admin only) as deltas, never going negative
CREATE OR REPLACE FUNCTION public.apply_fuel_topup_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delta numeric := NEW.litres - OLD.litres;
  v_cap numeric;
  v_cur numeric;
  v_stock numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can edit top-up records';
  END IF;
  IF NEW.litres IS NULL OR NEW.litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be greater than zero';
  END IF;
  IF NEW.tank_id IS DISTINCT FROM OLD.tank_id OR NEW.branch_fuel_type_id IS DISTINCT FROM OLD.branch_fuel_type_id THEN
    RAISE EXCEPTION 'Tank and fuel product cannot be changed. Delete the record and create a new one.';
  END IF;

  IF v_delta <> 0 AND NEW.tank_id IS NOT NULL THEN
    SELECT capacity_litres, current_level_litres INTO v_cap, v_cur
      FROM public.tanks WHERE id = NEW.tank_id FOR UPDATE;
    IF v_cur + v_delta < 0 THEN
      RAISE EXCEPTION 'Edit rejected: tank would drop below zero (currently % L).', ROUND(v_cur,2);
    END IF;
    IF v_cur + v_delta > v_cap THEN
      RAISE EXCEPTION 'Edit rejected: exceeds tank capacity by % L.', ROUND(v_cur + v_delta - v_cap, 2);
    END IF;
    UPDATE public.tanks
       SET current_level_litres = v_cur + v_delta, updated_at = now()
     WHERE id = NEW.tank_id;
  END IF;

  IF NEW.branch_fuel_type_id IS NOT NULL THEN
    SELECT stock_level INTO v_stock FROM public.branch_fuel_types WHERE id = NEW.branch_fuel_type_id FOR UPDATE;
    IF v_stock + v_delta < 0 THEN
      RAISE EXCEPTION 'Edit rejected: product stock would drop below zero (currently % L).', ROUND(v_stock,2);
    END IF;
    UPDATE public.branch_fuel_types
       SET stock_level = v_stock + v_delta,
           buying_price = COALESCE(NEW.cost_per_litre, buying_price),
           updated_at = now()
     WHERE id = NEW.branch_fuel_type_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_fuel_topup_update_trg ON public.fuel_topups;
CREATE TRIGGER apply_fuel_topup_update_trg
BEFORE UPDATE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.apply_fuel_topup_update();

-- Audit inserts, updates and deletes of top-ups
CREATE OR REPLACE FUNCTION public.audit_fuel_topups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_topups', NEW.id, 'INSERT',
      jsonb_build_object('tank_id', NEW.tank_id, 'litres', NEW.litres,
                         'supplier', NEW.supplier, 'cost_per_litre', NEW.cost_per_litre,
                         'topup_date', NEW.topup_date),
      auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.litres IS DISTINCT FROM NEW.litres THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'litres', OLD.litres::text, NEW.litres::text, auth.uid());
    END IF;
    IF COALESCE(OLD.cost_per_litre::text,'') IS DISTINCT FROM COALESCE(NEW.cost_per_litre::text,'') THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'cost_per_litre', OLD.cost_per_litre::text, NEW.cost_per_litre::text, auth.uid());
    END IF;
    IF COALESCE(OLD.supplier,'') IS DISTINCT FROM COALESCE(NEW.supplier,'') THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'supplier', OLD.supplier, NEW.supplier, auth.uid());
    END IF;
    IF COALESCE(OLD.expected_litres::text,'') IS DISTINCT FROM COALESCE(NEW.expected_litres::text,'') THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'expected_litres', OLD.expected_litres::text, NEW.expected_litres::text, auth.uid());
    END IF;
    IF OLD.topup_date IS DISTINCT FROM NEW.topup_date THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'topup_date', OLD.topup_date::text, NEW.topup_date::text, auth.uid());
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_topups', OLD.id, 'DELETE',
      jsonb_build_object('tank_id', OLD.tank_id, 'litres', OLD.litres,
                         'supplier', OLD.supplier, 'cost_per_litre', OLD.cost_per_litre,
                         'topup_date', OLD.topup_date),
      auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_fuel_topups_trg ON public.fuel_topups;
CREATE TRIGGER audit_fuel_topups_trg
AFTER INSERT OR UPDATE OR DELETE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.audit_fuel_topups();

-- Recalculate the affected daily stock row after any top-up change
CREATE OR REPLACE FUNCTION public.sync_daily_stock_after_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_daily_fuel_stock(OLD.branch_fuel_type_id, (OLD.created_at AT TIME ZONE 'Africa/Nairobi')::date);
    RETURN OLD;
  END IF;
  PERFORM public.recalc_daily_fuel_stock(NEW.branch_fuel_type_id, (NEW.created_at AT TIME ZONE 'Africa/Nairobi')::date);
  IF TG_OP = 'UPDATE' AND OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    PERFORM public.recalc_daily_fuel_stock(OLD.branch_fuel_type_id, (OLD.created_at AT TIME ZONE 'Africa/Nairobi')::date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_daily_stock_after_topup_trg ON public.fuel_topups;
CREATE TRIGGER sync_daily_stock_after_topup_trg
AFTER INSERT OR UPDATE OR DELETE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.sync_daily_stock_after_topup();

-- Admin-only edits
DROP POLICY IF EXISTS "Admins update topups" ON public.fuel_topups;
CREATE POLICY "Admins update topups" ON public.fuel_topups
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));