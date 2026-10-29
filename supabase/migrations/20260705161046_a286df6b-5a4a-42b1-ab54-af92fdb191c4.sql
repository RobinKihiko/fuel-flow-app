
-- =========================================================
-- 1. Extend fuel_topups to absorb fuel_deliveries semantics
-- =========================================================
ALTER TABLE public.fuel_topups
  ADD COLUMN IF NOT EXISTS tank_id uuid REFERENCES public.tanks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS cost_per_litre numeric,
  ADD COLUMN IF NOT EXISTS expected_litres numeric,
  ADD COLUMN IF NOT EXISTS topup_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamptz;

-- Migrate existing deliveries into fuel_topups (best-effort mapping via tank -> branch/fuel).
INSERT INTO public.fuel_topups
  (id, branch_id, fuel_type_id, branch_fuel_type_id, tank_id,
   litres, supplier, cost_per_litre, expected_litres, topup_date, notes,
   created_by, created_at)
SELECT
  d.id,
  t.branch_id,
  (SELECT ft.id FROM public.fuel_types ft WHERE ft.name = t.fuel_name LIMIT 1),
  (SELECT bft.id FROM public.branch_fuel_types bft
     WHERE bft.branch_id = t.branch_id AND bft.name = t.fuel_name LIMIT 1),
  d.tank_id,
  d.delivered_litres,
  d.supplier,
  d.cost_per_litre,
  d.expected_litres,
  d.delivery_date,
  d.notes,
  d.recorded_by,
  d.created_at
FROM public.fuel_deliveries d
JOIN public.tanks t ON t.id = d.tank_id
ON CONFLICT (id) DO NOTHING;

-- Drop old delivery triggers / audit / table
DROP TRIGGER IF EXISTS apply_fuel_delivery_trg ON public.fuel_deliveries;
DROP TRIGGER IF EXISTS audit_fuel_deliveries_trg ON public.fuel_deliveries;
DROP TABLE IF EXISTS public.fuel_deliveries CASCADE;

-- =========================================================
-- 2. Concurrency-safe apply-topup trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.apply_fuel_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_capacity numeric;
  v_current  numeric;
BEGIN
  IF NEW.tank_id IS NOT NULL THEN
    -- Lock the tank row to prevent concurrent over-fill
    SELECT capacity_litres, current_level_litres
      INTO v_capacity, v_current
      FROM public.tanks WHERE id = NEW.tank_id FOR UPDATE;

    IF v_current + NEW.litres > v_capacity THEN
      RAISE EXCEPTION 'Top-up of % L exceeds tank capacity (% L available)',
        NEW.litres, GREATEST(0, v_capacity - v_current);
    END IF;

    UPDATE public.tanks
       SET current_level_litres = current_level_litres + NEW.litres,
           updated_at = now()
     WHERE id = NEW.tank_id;
  END IF;

  IF NEW.branch_fuel_type_id IS NOT NULL THEN
    UPDATE public.branch_fuel_types
       SET stock_level = stock_level + NEW.litres,
           buying_price = COALESCE(NEW.cost_per_litre, buying_price),
           updated_at = now()
     WHERE id = NEW.branch_fuel_type_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_fuel_topup_trg ON public.fuel_topups;
CREATE TRIGGER apply_fuel_topup_trg
AFTER INSERT ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.apply_fuel_topup();

-- Audit changes to top-ups
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
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_topups', OLD.id, 'DELETE',
      jsonb_build_object('tank_id', OLD.tank_id, 'litres', OLD.litres),
      auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS audit_fuel_topups_trg ON public.fuel_topups;
CREATE TRIGGER audit_fuel_topups_trg
AFTER INSERT OR DELETE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.audit_fuel_topups();

-- Admins may delete a top-up (for audited corrections)
DROP POLICY IF EXISTS "Admins delete topups" ON public.fuel_topups;
CREATE POLICY "Admins delete topups" ON public.fuel_topups
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- =========================================================
-- 3. Concurrency-safe sale deduction RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(
  _branch_fuel_type_id uuid,
  _litres numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stock numeric;
  v_remaining numeric := _litres;
  r RECORD;
  v_take numeric;
BEGIN
  IF _litres IS NULL OR _litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be positive';
  END IF;

  -- Lock the branch_fuel_types row
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

  -- Deduct across linked tanks in creation order, locking each row
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
$$;

GRANT EXECUTE ON FUNCTION public.deduct_fuel_sale(uuid, numeric) TO authenticated;

-- =========================================================
-- 4. Audit daily_fuel_stock corrections
-- =========================================================
CREATE OR REPLACE FUNCTION public.audit_daily_fuel_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ctx jsonb := jsonb_build_object(
    'branch_id', NEW.branch_id,
    'fuel_name', NEW.fuel_name,
    'stock_date', NEW.stock_date
  );
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.opening_stock IS DISTINCT FROM NEW.opening_stock THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'opening_stock',
              OLD.opening_stock::text, NEW.opening_stock::text, ctx, auth.uid());
    END IF;
    IF OLD.closing_stock IS DISTINCT FROM NEW.closing_stock THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'closing_stock',
              OLD.closing_stock::text, NEW.closing_stock::text, ctx, auth.uid());
    END IF;
    IF OLD.topups_litres IS DISTINCT FROM NEW.topups_litres THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'topups_litres',
              OLD.topups_litres::text, NEW.topups_litres::text, ctx, auth.uid());
    END IF;
    IF OLD.sold_litres IS DISTINCT FROM NEW.sold_litres THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'sold_litres',
              OLD.sold_litres::text, NEW.sold_litres::text, ctx, auth.uid());
    END IF;
    IF OLD.revenue IS DISTINCT FROM NEW.revenue THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'revenue',
              OLD.revenue::text, NEW.revenue::text, ctx, auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS audit_daily_fuel_stock_trg ON public.daily_fuel_stock;
CREATE TRIGGER audit_daily_fuel_stock_trg
AFTER UPDATE ON public.daily_fuel_stock
FOR EACH ROW EXECUTE FUNCTION public.audit_daily_fuel_stock();

-- =========================================================
-- 5. Per-user page permissions
-- =========================================================
CREATE TABLE IF NOT EXISTS public.user_page_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_page_permissions TO authenticated;
GRANT ALL ON public.user_page_permissions TO service_role;

ALTER TABLE public.user_page_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own page permissions" ON public.user_page_permissions;
CREATE POLICY "Users can view own page permissions" ON public.user_page_permissions
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage page permissions" ON public.user_page_permissions;
CREATE POLICY "Admins manage page permissions" ON public.user_page_permissions
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.has_page_permission(_user_id uuid, _page text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_page_permissions
     WHERE user_id = _user_id AND page_key = _page
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_page_permission(uuid, text) TO authenticated;
