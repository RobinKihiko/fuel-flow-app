
-- Tenants / onboarding
CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL UNIQUE,
  db_name text NOT NULL UNIQUE,
  email text NOT NULL,
  phone text NOT NULL,
  negotiated_rate numeric NOT NULL DEFAULT 0,
  billing_cycle text NOT NULL DEFAULT 'monthly',
  status text NOT NULL DEFAULT 'active',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage tenants" ON public.tenants
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers view tenants" ON public.tenants
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_tenants_updated_at
  BEFORE UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Slugify trigger for db_name fallback
CREATE OR REPLACE FUNCTION public.slugify_tenant_db_name()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.db_name IS NULL OR length(trim(NEW.db_name)) = 0 THEN
    NEW.db_name := lower(regexp_replace(NEW.business_name, '[^a-zA-Z0-9]+', '_', 'g'));
    NEW.db_name := trim(both '_' from NEW.db_name);
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER trg_tenants_db_name
  BEFORE INSERT OR UPDATE ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.slugify_tenant_db_name();

-- Reconciliation verification extras
ALTER TABLE public.reconciliation_reviews
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verified_by uuid;
