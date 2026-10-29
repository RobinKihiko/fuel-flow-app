DROP POLICY IF EXISTS "Users create sales for their branch" ON public.sales;

CREATE POLICY "Users create sales for their branch"
ON public.sales
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = attendant_id
  AND branch_id IS NOT NULL
  AND (
    has_role(auth.uid(), 'admin'::app_role)
    OR (has_role(auth.uid(), 'manager'::app_role) AND can_access_branch(auth.uid(), branch_id))
    OR is_assigned_to_branch(auth.uid(), branch_id)
  )
  AND EXISTS (
    SELECT 1
    FROM public.branch_fuel_types bft
    JOIN public.fuel_types ft ON ft.name = bft.name
    WHERE bft.branch_id = sales.branch_id
      AND ft.id = sales.fuel_type_id
  )
);