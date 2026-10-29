-- Remove open read policies that override the stricter ones.
DROP POLICY IF EXISTS "Authenticated can view expenses" ON public.expenses;
DROP POLICY IF EXISTS "Authenticated view dips" ON public.tank_dips;
