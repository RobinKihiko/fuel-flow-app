
-- 1. Create all tables first (no cross-references in policies yet)

CREATE TABLE public.branches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  location TEXT,
  mpesa_shortcode TEXT,
  mpesa_consumer_key TEXT,
  mpesa_consumer_secret TEXT,
  mpesa_passkey TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.branch_fuel_types (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price_per_litre NUMERIC NOT NULL,
  stock_level NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.branch_fuel_types ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.branch_attendants (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(branch_id, user_id)
);

ALTER TABLE public.branch_attendants ENABLE ROW LEVEL SECURITY;

-- Add branch_id to sales
ALTER TABLE public.sales ADD COLUMN branch_id UUID REFERENCES public.branches(id);

-- 2. Now add all RLS policies (branch_attendants exists now)

-- branches policies
CREATE POLICY "Admins can manage branches"
  ON public.branches FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers can view assigned branches"
  ON public.branches FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'manager') AND
    EXISTS (SELECT 1 FROM public.branch_attendants ba WHERE ba.branch_id = id AND ba.user_id = auth.uid())
  );

CREATE POLICY "Attendants can view assigned branches"
  ON public.branches FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.branch_attendants ba WHERE ba.branch_id = id AND ba.user_id = auth.uid())
  );

-- branch_fuel_types policies
CREATE POLICY "Admins can manage branch fuel types"
  ON public.branch_fuel_types FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers can manage their branch fuel types"
  ON public.branch_fuel_types FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'manager') AND
    EXISTS (SELECT 1 FROM public.branch_attendants ba WHERE ba.branch_id = branch_fuel_types.branch_id AND ba.user_id = auth.uid())
  );

CREATE POLICY "Attendants can view their branch fuel types"
  ON public.branch_fuel_types FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.branch_attendants ba WHERE ba.branch_id = branch_fuel_types.branch_id AND ba.user_id = auth.uid())
  );

-- branch_attendants policies
CREATE POLICY "Admins can manage branch attendants"
  ON public.branch_attendants FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers can manage attendants for their branches"
  ON public.branch_attendants FOR ALL TO authenticated
  USING (
    has_role(auth.uid(), 'manager') AND
    EXISTS (SELECT 1 FROM public.branch_attendants ba2 WHERE ba2.branch_id = branch_attendants.branch_id AND ba2.user_id = auth.uid())
  );

CREATE POLICY "Users can view own assignments"
  ON public.branch_attendants FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- 3. Triggers
CREATE TRIGGER update_branches_updated_at
  BEFORE UPDATE ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_branch_fuel_types_updated_at
  BEFORE UPDATE ON public.branch_fuel_types
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
