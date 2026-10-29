
DROP TABLE IF EXISTS public.tenants CASCADE;
DROP FUNCTION IF EXISTS public.slugify_tenant_db_name() CASCADE;

DROP POLICY IF EXISTS "Admins manage payroll" ON public.user_payroll;
CREATE POLICY "Admins/managers manage payroll"
  ON public.user_payroll FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

DROP POLICY IF EXISTS "Admins manage payroll runs" ON public.payroll_runs;
CREATE POLICY "Admins/managers manage payroll runs"
  ON public.payroll_runs FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));
