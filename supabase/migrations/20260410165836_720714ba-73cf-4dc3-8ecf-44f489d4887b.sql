
-- Drop permissive policies
DROP POLICY "System can update mpesa" ON public.mpesa_transactions;
DROP POLICY "Authenticated can create sales" ON public.sales;
DROP POLICY "Authenticated can create mpesa" ON public.mpesa_transactions;

-- Recreate with tighter rules
CREATE POLICY "Attendants can create sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (auth.uid() = attendant_id);
CREATE POLICY "Authenticated can create mpesa" ON public.mpesa_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can update mpesa" ON public.mpesa_transactions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));
