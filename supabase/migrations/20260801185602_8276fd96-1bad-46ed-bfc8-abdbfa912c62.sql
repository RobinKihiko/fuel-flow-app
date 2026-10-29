-- 1. Sale reversal tracking on sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid;

-- 2. Reversal requests
CREATE TABLE IF NOT EXISTS public.sale_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  branch_id uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sale_reversals_one_pending
  ON public.sale_reversals(sale_id) WHERE status = 'pending';

GRANT SELECT, INSERT ON public.sale_reversals TO authenticated;
GRANT UPDATE ON public.sale_reversals TO authenticated;
GRANT ALL ON public.sale_reversals TO service_role;

ALTER TABLE public.sale_reversals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View reversals for accessible branches"
  ON public.sale_reversals FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR requested_by = auth.uid()
    OR (branch_id IS NOT NULL AND public.can_access_branch(auth.uid(), branch_id))
  );

CREATE POLICY "Request reversal for accessible branches"
  ON public.sale_reversals FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND status = 'pending'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (branch_id IS NOT NULL AND public.can_access_branch(auth.uid(), branch_id))
    )
  );

CREATE POLICY "Admins review reversals"
  ON public.sale_reversals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER sale_reversals_updated_at
  BEFORE UPDATE ON public.sale_reversals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Approve / reject a reversal (admin only). Approving restores stock.
CREATE OR REPLACE FUNCTION public.review_sale_reversal(_reversal_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  s RECORD;
  v_bft_id uuid;
  v_tank_id uuid;
  v_remaining numeric;
  v_room numeric;
  t RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can review reversals';
  END IF;

  SELECT * INTO r FROM public.sale_reversals WHERE id = _reversal_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'Reversal request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been reviewed'; END IF;

  IF NOT _approve THEN
    UPDATE public.sale_reversals
       SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
     WHERE id = _reversal_id;
    RETURN;
  END IF;

  SELECT sa.*, ft.name AS fuel_name INTO s
    FROM public.sales sa
    LEFT JOIN public.fuel_types ft ON ft.id = sa.fuel_type_id
   WHERE sa.id = r.sale_id
   FOR UPDATE OF sa;
  IF s IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF s.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Sale already reversed'; END IF;

  -- Restore product stock
  SELECT id INTO v_bft_id FROM public.branch_fuel_types
   WHERE branch_id = s.branch_id AND name = s.fuel_name
   LIMIT 1;

  IF v_bft_id IS NOT NULL THEN
    UPDATE public.branch_fuel_types
       SET stock_level = stock_level + s.litres, updated_at = now()
     WHERE id = v_bft_id;

    -- Put litres back into linked tanks (respecting capacity)
    v_remaining := s.litres;
    FOR t IN
      SELECT tk.id, tk.capacity_litres, tk.current_level_litres
        FROM public.branch_fuel_type_tanks lnk
        JOIN public.tanks tk ON tk.id = lnk.tank_id
       WHERE lnk.branch_fuel_type_id = v_bft_id
       ORDER BY lnk.created_at ASC
       FOR UPDATE OF tk
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_room := GREATEST(0, t.capacity_litres - t.current_level_litres);
      IF v_room <= 0 THEN CONTINUE; END IF;
      UPDATE public.tanks
         SET current_level_litres = current_level_litres + LEAST(v_room, v_remaining),
             updated_at = now()
       WHERE id = t.id;
      v_remaining := v_remaining - LEAST(v_room, v_remaining);
    END LOOP;
  END IF;

  UPDATE public.sales
     SET reversed_at = now(), reversed_by = auth.uid()
   WHERE id = s.id;

  UPDATE public.sale_reversals
     SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
   WHERE id = _reversal_id;

  INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
  VALUES ('sales', s.id, 'UPDATE', 'reversed', 'active', 'reversed',
          jsonb_build_object('litres', s.litres, 'amount', s.total_amount, 'reason', r.reason),
          auth.uid());
END;
$$;

-- 4. Automatic daily finalization
CREATE OR REPLACE FUNCTION public.finalize_fuel_day(_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_closing numeric;
  v_topups numeric;
  v_sold numeric;
  v_revenue numeric;
  v_count integer := 0;
  d_start timestamptz := (_date::timestamp AT TIME ZONE 'Africa/Nairobi');
  d_end   timestamptz := ((_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');
BEGIN
  FOR b IN SELECT id, branch_id, name, stock_level FROM public.branch_fuel_types LOOP
    SELECT COALESCE(SUM(tk.current_level_litres), b.stock_level) INTO v_closing
      FROM public.branch_fuel_type_tanks lnk
      JOIN public.tanks tk ON tk.id = lnk.tank_id
     WHERE lnk.branch_fuel_type_id = b.id;
    v_closing := COALESCE(v_closing, b.stock_level);

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

    INSERT INTO public.daily_fuel_stock (
      branch_id, branch_fuel_type_id, fuel_name, stock_date,
      opening_stock, closing_stock, topups_litres, sold_litres, revenue, locked, locked_at
    ) VALUES (
      b.branch_id, b.id, b.name, _date,
      ROUND(v_closing + v_sold - v_topups, 2), ROUND(v_closing, 2),
      ROUND(v_topups, 2), ROUND(v_sold, 2), ROUND(v_revenue, 2), true, now()
    )
    ON CONFLICT (branch_fuel_type_id, stock_date) DO UPDATE
      SET opening_stock = EXCLUDED.opening_stock,
          closing_stock = EXCLUDED.closing_stock,
          topups_litres = EXCLUDED.topups_litres,
          sold_litres = EXCLUDED.sold_litres,
          revenue = EXCLUDED.revenue,
          locked = true,
          locked_at = now(),
          updated_at = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('finalize-fuel-day-midnight')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finalize-fuel-day-midnight');

SELECT cron.schedule(
  'finalize-fuel-day-midnight',
  '55 20 * * *',
  $$ SELECT public.finalize_fuel_day((now() AT TIME ZONE 'Africa/Nairobi')::date); $$
);