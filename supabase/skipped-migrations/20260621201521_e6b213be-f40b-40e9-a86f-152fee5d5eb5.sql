
-- 1) Helper: get user's tenant_id (SECURITY DEFINER to avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.get_user_tenant(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;

-- 2) Fix: Managers can only view profiles in their tenant
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view tenant profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND tenant_id IS NOT NULL
  AND tenant_id = public.get_user_tenant(auth.uid())
);

-- 3) Fix: can_access_branch — explicitly include managers assigned to the branch
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

-- 4) Fix: tank_dips policies now require branch-scope for managers
DROP POLICY IF EXISTS "Admins/managers create dips" ON public.tank_dips;
DROP POLICY IF EXISTS "Admins/managers update dips" ON public.tank_dips;
DROP POLICY IF EXISTS "Admins/managers delete dips" ON public.tank_dips;

CREATE POLICY "Admins/managers create dips"
ON public.tank_dips
FOR INSERT
TO authenticated
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
ON public.tank_dips
FOR UPDATE
TO authenticated
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
ON public.tank_dips
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

-- 5) Fix: Realtime channel authorization — only auth'd users with a branch or elevated role
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authorized realtime subscriptions" ON realtime.messages;
CREATE POLICY "Authorized realtime subscriptions"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR EXISTS (
    SELECT 1 FROM public.branch_attendants ba WHERE ba.user_id = auth.uid()
  )
);
