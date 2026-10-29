-- Add last-modified audit columns to expenses, branch_fuel_types, and branches
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamp with time zone;

ALTER TABLE public.branch_fuel_types
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamp with time zone;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamp with time zone;

-- Trigger function to stamp modifier on every UPDATE
CREATE OR REPLACE FUNCTION public.stamp_last_modified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.last_modified_by := auth.uid();
  NEW.last_modified_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_last_modified_expenses ON public.expenses;
CREATE TRIGGER stamp_last_modified_expenses
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.stamp_last_modified();

DROP TRIGGER IF EXISTS stamp_last_modified_branch_fuel_types ON public.branch_fuel_types;
CREATE TRIGGER stamp_last_modified_branch_fuel_types
BEFORE INSERT OR UPDATE ON public.branch_fuel_types
FOR EACH ROW EXECUTE FUNCTION public.stamp_last_modified();

DROP TRIGGER IF EXISTS stamp_last_modified_branches ON public.branches;
CREATE TRIGGER stamp_last_modified_branches
BEFORE INSERT OR UPDATE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.stamp_last_modified();

-- Allow authenticated users to view profile names so we can show the modifier's name
DROP POLICY IF EXISTS "Authenticated can view profile names" ON public.profiles;
CREATE POLICY "Authenticated can view profile names"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);