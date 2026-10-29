
-- 1) Allow all authenticated users to POST expenses (attendants included). Edit/delete stay admin/manager.
DROP POLICY IF EXISTS "Admins can manage expenses" ON public.expenses;
CREATE POLICY "Anyone signed in can add expenses"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- Attendants need to read at least their own expense entries so the list reflects what they added.
DROP POLICY IF EXISTS "Admins/managers view expenses" ON public.expenses;
CREATE POLICY "View expenses"
  ON public.expenses FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'manager')
    OR created_by = auth.uid()
  );

-- 2) Daily opening/closing stock snapshot table (auto-managed by trigger on sales/topups + manual close-of-day).
CREATE TABLE IF NOT EXISTS public.daily_fuel_stock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
  branch_fuel_type_id UUID REFERENCES public.branch_fuel_types(id) ON DELETE CASCADE,
  fuel_name TEXT NOT NULL,
  stock_date DATE NOT NULL DEFAULT CURRENT_DATE,
  opening_stock NUMERIC NOT NULL DEFAULT 0,
  closing_stock NUMERIC NOT NULL DEFAULT 0,
  topups_litres NUMERIC NOT NULL DEFAULT 0,
  sold_litres NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_fuel_type_id, stock_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_fuel_stock TO authenticated;
GRANT ALL ON public.daily_fuel_stock TO service_role;

ALTER TABLE public.daily_fuel_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View daily stock" ON public.daily_fuel_stock FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')
         OR (branch_id IS NOT NULL AND is_assigned_to_branch(auth.uid(), branch_id)));

CREATE POLICY "Admins/managers manage daily stock" ON public.daily_fuel_stock FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'));

CREATE TRIGGER trg_daily_fuel_stock_updated_at
  BEFORE UPDATE ON public.daily_fuel_stock
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
