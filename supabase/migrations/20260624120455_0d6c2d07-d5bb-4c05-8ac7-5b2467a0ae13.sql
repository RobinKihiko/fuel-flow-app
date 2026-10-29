ALTER TABLE public.expenses DROP CONSTRAINT expenses_created_by_fkey,
  ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.sales DROP CONSTRAINT sales_attendant_id_fkey,
  ADD CONSTRAINT sales_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES auth.users(id) ON DELETE SET NULL;