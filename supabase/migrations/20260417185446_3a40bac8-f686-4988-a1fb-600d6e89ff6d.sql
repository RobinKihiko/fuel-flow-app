
-- Fuel top-up history
CREATE TABLE public.fuel_topups (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_fuel_type_id UUID,
  fuel_type_id UUID,
  branch_id UUID,
  litres NUMERIC NOT NULL,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.fuel_topups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view topups"
ON public.fuel_topups FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Admins and managers can create topups"
ON public.fuel_topups FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

-- Allow admin/manager to UPDATE expenses (for editing)
CREATE POLICY "Admins can update expenses"
ON public.expenses FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));
