
-- Remove broad manager SELECT on profiles (exposed PII)
DROP POLICY IF EXISTS "Managers can view assigned branch profiles" ON public.profiles;

-- Allow attendants to read dips for their assigned branches
CREATE POLICY "Attendants view branch dips"
ON public.tank_dips
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);
