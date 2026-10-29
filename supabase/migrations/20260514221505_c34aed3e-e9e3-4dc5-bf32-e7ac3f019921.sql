
-- PUMPS
CREATE TABLE public.pumps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  code TEXT NOT NULL,
  label TEXT,
  status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('active','idle','error','offline')),
  assigned_attendant_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by UUID,
  last_modified_at TIMESTAMPTZ,
  UNIQUE(branch_id, code)
);
ALTER TABLE public.pumps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage pumps" ON public.pumps FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Managers manage their branch pumps" ON public.pumps FOR ALL TO authenticated
  USING (has_role(auth.uid(),'manager') AND is_assigned_to_branch(auth.uid(), branch_id))
  WITH CHECK (has_role(auth.uid(),'manager') AND is_assigned_to_branch(auth.uid(), branch_id));
CREATE POLICY "Attendants view their branch pumps" ON public.pumps FOR SELECT TO authenticated
  USING (is_assigned_to_branch(auth.uid(), branch_id));
CREATE TRIGGER pumps_stamp BEFORE INSERT OR UPDATE ON public.pumps
  FOR EACH ROW EXECUTE FUNCTION public.stamp_last_modified();
CREATE TRIGGER pumps_updated_at BEFORE UPDATE ON public.pumps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- PUMP NOZZLES
CREATE TABLE public.pump_nozzles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pump_id UUID NOT NULL REFERENCES public.pumps(id) ON DELETE CASCADE,
  branch_fuel_type_id UUID NOT NULL,
  code TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(pump_id, code)
);
ALTER TABLE public.pump_nozzles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage nozzles" ON public.pump_nozzles FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Managers manage nozzles in their branches" ON public.pump_nozzles FOR ALL TO authenticated
  USING (has_role(auth.uid(),'manager') AND EXISTS (SELECT 1 FROM public.pumps p WHERE p.id = pump_id AND is_assigned_to_branch(auth.uid(), p.branch_id)))
  WITH CHECK (has_role(auth.uid(),'manager') AND EXISTS (SELECT 1 FROM public.pumps p WHERE p.id = pump_id AND is_assigned_to_branch(auth.uid(), p.branch_id)));
CREATE POLICY "Authenticated view nozzles" ON public.pump_nozzles FOR SELECT TO authenticated USING (true);

-- TANKS
CREATE TABLE public.tanks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  fuel_name TEXT NOT NULL,
  capacity_litres NUMERIC NOT NULL DEFAULT 0,
  current_level_litres NUMERIC NOT NULL DEFAULT 0,
  low_stock_threshold NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_modified_by UUID,
  last_modified_at TIMESTAMPTZ
);
ALTER TABLE public.tanks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage tanks" ON public.tanks FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Managers manage their branch tanks" ON public.tanks FOR ALL TO authenticated
  USING (has_role(auth.uid(),'manager') AND is_assigned_to_branch(auth.uid(), branch_id))
  WITH CHECK (has_role(auth.uid(),'manager') AND is_assigned_to_branch(auth.uid(), branch_id));
CREATE POLICY "Attendants view their branch tanks" ON public.tanks FOR SELECT TO authenticated
  USING (is_assigned_to_branch(auth.uid(), branch_id));
CREATE TRIGGER tanks_stamp BEFORE INSERT OR UPDATE ON public.tanks
  FOR EACH ROW EXECUTE FUNCTION public.stamp_last_modified();
CREATE TRIGGER tanks_updated_at BEFORE UPDATE ON public.tanks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- TANK DIPS
CREATE TABLE public.tank_dips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id UUID NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  dip_litres NUMERIC NOT NULL,
  notes TEXT,
  recorded_by UUID,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tank_dips ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins/managers create dips" ON public.tank_dips FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'));
CREATE POLICY "Authenticated view dips" ON public.tank_dips FOR SELECT TO authenticated USING (true);

-- Update tank current level after a dip is recorded
CREATE OR REPLACE FUNCTION public.apply_tank_dip()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tanks SET current_level_litres = NEW.dip_litres WHERE id = NEW.tank_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER tank_dips_apply AFTER INSERT ON public.tank_dips
  FOR EACH ROW EXECUTE FUNCTION public.apply_tank_dip();

-- FUEL DELIVERIES
CREATE TABLE public.fuel_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tank_id UUID NOT NULL REFERENCES public.tanks(id) ON DELETE CASCADE,
  supplier TEXT,
  expected_litres NUMERIC,
  delivered_litres NUMERIC NOT NULL,
  cost_per_litre NUMERIC,
  delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
  notes TEXT,
  recorded_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.fuel_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins/managers create deliveries" ON public.fuel_deliveries FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'));
CREATE POLICY "Authenticated view deliveries" ON public.fuel_deliveries FOR SELECT TO authenticated USING (true);

-- Auto-add delivered litres to tank
CREATE OR REPLACE FUNCTION public.apply_fuel_delivery()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.tanks
    SET current_level_litres = current_level_litres + NEW.delivered_litres
    WHERE id = NEW.tank_id;
  RETURN NEW;
END; $$;
CREATE TRIGGER fuel_deliveries_apply AFTER INSERT ON public.fuel_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.apply_fuel_delivery();

-- DRIVE-OFF INCIDENTS
CREATE TABLE public.drive_off_incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id UUID NOT NULL,
  pump_id UUID REFERENCES public.pumps(id) ON DELETE SET NULL,
  attendant_id UUID,
  estimated_litres NUMERIC,
  estimated_amount NUMERIC,
  vehicle_plate TEXT,
  notes TEXT,
  reported_by UUID,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.drive_off_incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage drive-offs" ON public.drive_off_incidents FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));
CREATE POLICY "Branch users create drive-offs" ON public.drive_off_incidents FOR INSERT TO authenticated
  WITH CHECK (is_assigned_to_branch(auth.uid(), branch_id) OR has_role(auth.uid(),'manager') OR has_role(auth.uid(),'admin'));
CREATE POLICY "Branch users view drive-offs" ON public.drive_off_incidents FOR SELECT TO authenticated
  USING (is_assigned_to_branch(auth.uid(), branch_id) OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'manager'));
