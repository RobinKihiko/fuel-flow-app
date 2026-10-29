-- Objects that exist in the application (see src/integrations/supabase/types.ts)
-- but were never captured in a migration file because they were created directly
-- in the original database. Must run before 20260519190851 (first use).

-- ---------------------------------------------------------------- columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS id_number_used_as_password boolean NOT NULL DEFAULT false;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS pump_id uuid REFERENCES public.pumps(id) ON DELETE SET NULL;

ALTER TABLE public.branch_fuel_types
  ADD COLUMN IF NOT EXISTS tank_id uuid REFERENCES public.tanks(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------- reconciliation_reviews
CREATE TABLE IF NOT EXISTS public.reconciliation_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid,
  tx_id uuid,
  status text NOT NULL DEFAULT 'pending',
  note text,
  reviewed_by uuid,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_reviews_sale ON public.reconciliation_reviews (sale_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_reviews_tx ON public.reconciliation_reviews (tx_id);
ALTER TABLE public.reconciliation_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and managers manage reconciliation reviews"
  ON public.reconciliation_reviews FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- ---------------------------------------------------------------- user_payroll
CREATE TABLE IF NOT EXISTS public.user_payroll (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  gross_salary numeric NOT NULL DEFAULT 0,
  allowances numeric NOT NULL DEFAULT 0,
  deductions numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.user_payroll ENABLE ROW LEVEL SECURITY;

-- (replaced by 20260608105907 which also allows managers)
CREATE POLICY "Admins manage payroll"
  ON public.user_payroll FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_user_payroll_updated_at
  BEFORE UPDATE ON public.user_payroll
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------- payroll_runs
CREATE TABLE IF NOT EXISTS public.payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  period_month date NOT NULL,
  net_amount numeric NOT NULL DEFAULT 0,
  expense_id uuid,
  submitted_by uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, period_month)
);
ALTER TABLE public.payroll_runs ENABLE ROW LEVEL SECURITY;

-- (replaced by 20260608105907 which also allows managers)
CREATE POLICY "Admins manage payroll runs"
  ON public.payroll_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------- branch_fuel_type_tanks
CREATE TABLE IF NOT EXISTS public.branch_fuel_type_tanks (
  branch_fuel_type_id uuid NOT NULL REFERENCES public.branch_fuel_types(id) ON DELETE CASCADE,
  tank_id uuid NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (branch_fuel_type_id, tank_id)
);
CREATE INDEX IF NOT EXISTS idx_bftt_tank ON public.branch_fuel_type_tanks (tank_id);
ALTER TABLE public.branch_fuel_type_tanks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated view fuel type tank links"
  ON public.branch_fuel_type_tanks FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins and managers manage fuel type tank links"
  ON public.branch_fuel_type_tanks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- ---------------------------------------------------------------- get_profile_names
CREATE OR REPLACE FUNCTION public.get_profile_names(_ids uuid[])
RETURNS TABLE (user_id uuid, full_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, COALESCE(p.full_name, '')::text
  FROM public.profiles p
  WHERE p.user_id = ANY(_ids);
$$;

REVOKE ALL ON FUNCTION public.get_profile_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profile_names(uuid[]) TO authenticated;
