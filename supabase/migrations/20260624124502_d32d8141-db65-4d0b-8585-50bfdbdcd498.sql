
-- Restrict fuel_deliveries writes to admin/manager only
DROP POLICY IF EXISTS "Create deliveries by assigned branch" ON public.fuel_deliveries;
DROP POLICY IF EXISTS "Update deliveries by assigned branch" ON public.fuel_deliveries;
DROP POLICY IF EXISTS "Delete deliveries by assigned branch" ON public.fuel_deliveries;

CREATE POLICY "Admins/managers create deliveries" ON public.fuel_deliveries
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = fuel_deliveries.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

CREATE POLICY "Admins/managers update deliveries" ON public.fuel_deliveries
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = fuel_deliveries.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = fuel_deliveries.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

CREATE POLICY "Admins/managers delete deliveries" ON public.fuel_deliveries
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = fuel_deliveries.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

-- Restrict fuel_topups INSERT to admin/manager only
DROP POLICY IF EXISTS "Create topups by assigned branch" ON public.fuel_topups;
CREATE POLICY "Admins/managers create topups" ON public.fuel_topups
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND is_assigned_to_branch(auth.uid(), branch_id)
  )
);

-- Restrict tank_dips SELECT to admin/manager only
DROP POLICY IF EXISTS "View dips by branch" ON public.tank_dips;
CREATE POLICY "Admins/managers view dips" ON public.tank_dips
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

-- Restrict managers' profile reads to users in their assigned branches, excluding cross-tenant exposure
DROP POLICY IF EXISTS "Managers can view tenant profiles" ON public.profiles;
CREATE POLICY "Managers can view assigned branch profiles" ON public.profiles
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.branch_attendants ba_target
    JOIN public.branch_attendants ba_manager
      ON ba_manager.branch_id = ba_target.branch_id
    WHERE ba_target.user_id = profiles.user_id
      AND ba_manager.user_id = auth.uid()
  )
);
