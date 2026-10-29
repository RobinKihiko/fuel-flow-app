
-- Drop problematic policies
DROP POLICY IF EXISTS "Managers can manage attendants for their branches" ON public.branch_attendants;
DROP POLICY IF EXISTS "Attendants can view assigned branches" ON public.branches;
DROP POLICY IF EXISTS "Managers can view assigned branches" ON public.branches;

-- Drop recursive policies on branch_fuel_types too
DROP POLICY IF EXISTS "Attendants can view their branch fuel types" ON public.branch_fuel_types;
DROP POLICY IF EXISTS "Managers can manage their branch fuel types" ON public.branch_fuel_types;

-- Create a security definer function to check branch assignment without RLS recursion
CREATE OR REPLACE FUNCTION public.is_assigned_to_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.branch_attendants
    WHERE user_id = _user_id AND branch_id = _branch_id
  )
$$;

-- Recreate manager policy on branch_attendants using security definer
CREATE POLICY "Managers can manage attendants for their branches"
ON public.branch_attendants
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND is_assigned_to_branch(auth.uid(), branch_id)
);

-- Fix branches policies
CREATE POLICY "Attendants can view assigned branches"
ON public.branches
FOR SELECT
TO authenticated
USING (is_assigned_to_branch(auth.uid(), id));

CREATE POLICY "Managers can view assigned branches"
ON public.branches
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND is_assigned_to_branch(auth.uid(), id)
);

-- Recreate branch_fuel_types policies
CREATE POLICY "Attendants can view their branch fuel types"
ON public.branch_fuel_types
FOR SELECT
TO authenticated
USING (is_assigned_to_branch(auth.uid(), branch_id));

CREATE POLICY "Managers can manage their branch fuel types"
ON public.branch_fuel_types
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND is_assigned_to_branch(auth.uid(), branch_id)
);
