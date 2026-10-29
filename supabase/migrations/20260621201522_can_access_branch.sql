-- Replacement for the skipped tenant migration (tenant logic removed).

-- Column used by the app and by 20260716132306
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- Managers no longer get a broad profiles policy (was tenant-scoped, later removed)
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;

-- Branch access check (same logic as the original, no tenants)
CREATE OR REPLACE FUNCTION public.can_access_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR (
      public.has_role(_user_id, 'manager')
      AND public.is_assigned_to_branch(_user_id, _branch_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.branch_attendants
      WHERE user_id = _user_id AND branch_id = _branch_id
    );
$$;

-- tank_dips: managers limited to their own branches
DROP POLICY IF EXISTS "Admins/managers create dips" ON public.tank_dips;
DROP POLICY IF EXISTS "Admins/managers update dips" ON public.tank_dips;
DROP POLICY IF EXISTS "Admins/managers delete dips" ON public.tank_dips;

CREATE POLICY "Admins/managers create dips"
ON public.tank_dips FOR INSERT TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

CREATE POLICY "Admins/managers update dips"
ON public.tank_dips FOR UPDATE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

CREATE POLICY "Admins/managers delete dips"
ON public.tank_dips FOR DELETE TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);
