-- ===== 20260410165824_ec038b6e-f973-4072-b5dc-3a283f67df53.sql =====

-- Create role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'attendant');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'attendant',
  UNIQUE (user_id, role)
);

-- Create fuel_types table
CREATE TABLE public.fuel_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  price_per_litre NUMERIC(10,2) NOT NULL,
  stock_level NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create sales table
CREATE TABLE public.sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  fuel_type_id UUID NOT NULL REFERENCES public.fuel_types(id),
  litres NUMERIC(10,2) NOT NULL,
  total_amount NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'mpesa')),
  attendant_id UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create mpesa_transactions table
CREATE TABLE public.mpesa_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mpesa_code TEXT UNIQUE,
  phone TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  sale_id UUID REFERENCES public.sales(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create expenses table
CREATE TABLE public.expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  category TEXT,
  created_by UUID REFERENCES auth.users(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fuel_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mpesa_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checking
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can view all profiles" ON public.profiles FOR SELECT USING (public.has_role(auth.uid(), 'admin'));

-- User roles policies
CREATE POLICY "Users can view own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- Fuel types policies
CREATE POLICY "Authenticated can view fuel types" ON public.fuel_types FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage fuel types" ON public.fuel_types FOR ALL USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- Sales policies
CREATE POLICY "Authenticated can view sales" ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can create sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (true);

-- M-Pesa policies
CREATE POLICY "Authenticated can view mpesa" ON public.mpesa_transactions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can create mpesa" ON public.mpesa_transactions FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "System can update mpesa" ON public.mpesa_transactions FOR UPDATE TO authenticated USING (true);

-- Expenses policies
CREATE POLICY "Authenticated can view expenses" ON public.expenses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage expenses" ON public.expenses FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_fuel_types_updated_at BEFORE UPDATE ON public.fuel_types FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''));
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'attendant');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ===== 20260410165836_720714ba-73cf-4dc3-8ecf-44f489d4887b.sql =====

-- Drop permissive policies
DROP POLICY "System can update mpesa" ON public.mpesa_transactions;
DROP POLICY "Authenticated can create sales" ON public.sales;
DROP POLICY "Authenticated can create mpesa" ON public.mpesa_transactions;

-- Recreate with tighter rules
CREATE POLICY "Attendants can create sales" ON public.sales FOR INSERT TO authenticated WITH CHECK (auth.uid() = attendant_id);
CREATE POLICY "Authenticated can create mpesa" ON public.mpesa_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admins can update mpesa" ON public.mpesa_transactions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- ===== 20260410174222_5fd0256a-33cc-4165-a1e8-0480b6d386e7.sql =====
-- Intentionally empty.
-- This migration used to grant admin to a user id that only existed in the old
-- (Lovable Cloud) database, which fails on a fresh Supabase project.
-- Create your first admin with supabase/setup/first-admin.sql instead.
SELECT 1;

-- ===== 20260414194517_515515a8-eebe-4019-a918-228810290917.sql =====

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

-- ===== 20260416162307_af3b7f7f-ed83-427d-a640-312c44858fcb.sql =====

-- Drop problematic policies
DROP POLICY IF EXISTS "Managers can manage attendants for their branches" ON public.branch_attendants;
DROP POLICY IF EXISTS "Attendants can view assigned branches" ON public.branches;
DROP POLICY IF EXISTS "Managers can view assigned branches" ON public.branches;

-- Drop recursive policies on branch_fuel_types too
DROP POLICY IF EXISTS "Attendants can view their branch fuel types" ON public.branch_fuel_types;
DROP POLICY IF EXISTS "Managers can manage their branch fuel types" ON public.branch_fuel_types;

-- Create a security definer function to check branch assignment without RLS recursion
CREATE OR REPLACE FUNCTION public.is_assigned_to_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.branch_attendants
    WHERE user_id = _user_id AND branch_id = _branch_id
  )
$$;

-- Recreate manager policy on branch_attendants using security definer
CREATE POLICY "Managers can manage attendants for their branches"
ON public.branch_attendants
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND is_assigned_to_branch(auth.uid(), branch_id)
);

-- Fix branches policies
CREATE POLICY "Attendants can view assigned branches"
ON public.branches
FOR SELECT
TO authenticated
USING (is_assigned_to_branch(auth.uid(), id));

CREATE POLICY "Managers can view assigned branches"
ON public.branches
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND is_assigned_to_branch(auth.uid(), id)
);

-- Recreate branch_fuel_types policies
CREATE POLICY "Attendants can view their branch fuel types"
ON public.branch_fuel_types
FOR SELECT
TO authenticated
USING (is_assigned_to_branch(auth.uid(), branch_id));

CREATE POLICY "Managers can manage their branch fuel types"
ON public.branch_fuel_types
FOR ALL
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND is_assigned_to_branch(auth.uid(), branch_id)
);

-- ===== 20260417185446_3a40bac8-f686-4988-a1fb-600d6e89ff6d.sql =====

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

-- ===== 20260417194059_94b565bc-7ce4-45bd-b73c-22d8f08963b6.sql =====
-- Add id_number to profiles for attendant credentials
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS id_number text;
CREATE INDEX IF NOT EXISTS idx_profiles_id_number ON public.profiles(id_number);
-- ===== 20260418203020_0b740217-a0d2-4654-b639-633c2ca364ed.sql =====
-- Add last-modified audit columns to expenses, branch_fuel_types, and branches
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamp with time zone;

ALTER TABLE public.branch_fuel_types
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamp with time zone;

ALTER TABLE public.branches
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamp with time zone;

-- Trigger function to stamp modifier on every UPDATE
CREATE OR REPLACE FUNCTION public.stamp_last_modified()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.last_modified_by := auth.uid();
  NEW.last_modified_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS stamp_last_modified_expenses ON public.expenses;
CREATE TRIGGER stamp_last_modified_expenses
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.stamp_last_modified();

DROP TRIGGER IF EXISTS stamp_last_modified_branch_fuel_types ON public.branch_fuel_types;
CREATE TRIGGER stamp_last_modified_branch_fuel_types
BEFORE INSERT OR UPDATE ON public.branch_fuel_types
FOR EACH ROW EXECUTE FUNCTION public.stamp_last_modified();

DROP TRIGGER IF EXISTS stamp_last_modified_branches ON public.branches;
CREATE TRIGGER stamp_last_modified_branches
BEFORE INSERT OR UPDATE ON public.branches
FOR EACH ROW EXECUTE FUNCTION public.stamp_last_modified();

-- Allow authenticated users to view profile names so we can show the modifier's name
DROP POLICY IF EXISTS "Authenticated can view profile names" ON public.profiles;
CREATE POLICY "Authenticated can view profile names"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);
-- ===== 20260514221505_c34aed3e-e9e3-4dc5-bf32-e7ac3f019921.sql =====

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

-- ===== 20260515050258_de4b2cda-82fd-46ff-9fed-59126f163d22.sql =====
ALTER TABLE public.branch_fuel_types ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 16;
ALTER TABLE public.fuel_types ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 16;
-- ===== 20260519190851_e9b7e282-0142-4b61-8727-6870c24c80cd.sql =====

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

-- ===== 20260607174522_0659ef0c-b1eb-44bd-b61f-9102c42d8686.sql =====
-- Wipe all fuel/tank/sales data for fresh configuration
TRUNCATE TABLE public.mpesa_transactions RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.sales RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.fuel_topups RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.fuel_deliveries RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.tank_dips RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.branch_fuel_type_tanks RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.drive_off_incidents RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.pump_nozzles RESTART IDENTITY CASCADE;
DELETE FROM public.branch_fuel_types;
DELETE FROM public.tanks;
DELETE FROM public.fuel_types;

-- Realtime for tanks so dashboard updates live
ALTER TABLE public.tanks REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tanks;
-- ===== 20260608105907_c1f241f8-b45e-4d0f-8a5b-26388f8fc672.sql =====

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

-- ===== 20260608110135_843d2b28-d67c-4a69-a58b-5f648cdad910.sql =====

-- Trigger: ensure global fuel_types row exists for any branch_fuel_types row
CREATE OR REPLACE FUNCTION public.ensure_global_fuel_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.fuel_types (name, price_per_litre, stock_level, vat_rate)
  VALUES (NEW.name, NEW.price_per_litre, 0, COALESCE(NEW.vat_rate, 16))
  ON CONFLICT (name) DO UPDATE
    SET price_per_litre = EXCLUDED.price_per_litre,
        vat_rate = EXCLUDED.vat_rate,
        updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_fuel_types ON public.branch_fuel_types;
CREATE TRIGGER trg_sync_fuel_types
AFTER INSERT OR UPDATE ON public.branch_fuel_types
FOR EACH ROW EXECUTE FUNCTION public.ensure_global_fuel_type();

-- Backfill existing branch fuels
INSERT INTO public.fuel_types (name, price_per_litre, stock_level, vat_rate)
SELECT DISTINCT bft.name, bft.price_per_litre, 0, COALESCE(bft.vat_rate, 16)
FROM public.branch_fuel_types bft
ON CONFLICT (name) DO NOTHING;

-- Let managers view all profiles
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view all profiles"
  ON public.profiles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- ===== 20260621201521_e6b213be-f40b-40e9-a86f-152fee5d5eb5.sql =====

-- 1) Helper: get user's tenant_id (SECURITY DEFINER to avoid recursive RLS)
CREATE OR REPLACE FUNCTION public.get_user_tenant(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = _user_id LIMIT 1
$$;

-- 2) Fix: Managers can only view profiles in their tenant
DROP POLICY IF EXISTS "Managers can view all profiles" ON public.profiles;
CREATE POLICY "Managers can view tenant profiles"
ON public.profiles
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager')
  AND tenant_id IS NOT NULL
  AND tenant_id = public.get_user_tenant(auth.uid())
);

-- 3) Fix: can_access_branch — explicitly include managers assigned to the branch
CREATE OR REPLACE FUNCTION public.can_access_branch(_user_id uuid, _branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.has_role(_user_id, 'admin')
    OR (
      public.has_role(_user_id, 'manager')
      AND public.is_assigned_to_branch(_user_id, _branch_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.branch_attendants
      WHERE user_id = _user_id AND branch_id = _branch_id
    );
$$;

-- 4) Fix: tank_dips policies now require branch-scope for managers
DROP POLICY IF EXISTS "Admins/managers create dips" ON public.tank_dips;
DROP POLICY IF EXISTS "Admins/managers update dips" ON public.tank_dips;
DROP POLICY IF EXISTS "Admins/managers delete dips" ON public.tank_dips;

CREATE POLICY "Admins/managers create dips"
ON public.tank_dips
FOR INSERT
TO authenticated
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

CREATE POLICY "Admins/managers update dips"
ON public.tank_dips
FOR UPDATE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

CREATE POLICY "Admins/managers delete dips"
ON public.tank_dips
FOR DELETE
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND public.has_role(auth.uid(), 'manager')
      AND public.is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

-- 5) Fix: Realtime channel authorization — only auth'd users with a branch or elevated role
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authorized realtime subscriptions" ON realtime.messages;
CREATE POLICY "Authorized realtime subscriptions"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'manager')
  OR EXISTS (
    SELECT 1 FROM public.branch_attendants ba WHERE ba.user_id = auth.uid()
  )
);

-- ===== 20260624120455_0d6c2d07-d5bb-4c05-8ac7-5b2467a0ae13.sql =====
ALTER TABLE public.expenses DROP CONSTRAINT expenses_created_by_fkey,
  ADD CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.sales DROP CONSTRAINT sales_attendant_id_fkey,
  ADD CONSTRAINT sales_attendant_id_fkey FOREIGN KEY (attendant_id) REFERENCES auth.users(id) ON DELETE SET NULL;
-- ===== 20260624124502_d32d8141-db65-4d0b-8585-50bfdbdcd498.sql =====

-- Restrict fuel_deliveries writes to admin/manager only
DROP POLICY IF EXISTS "Create deliveries by assigned branch" ON public.fuel_deliveries;
DROP POLICY IF EXISTS "Update deliveries by assigned branch" ON public.fuel_deliveries;
DROP POLICY IF EXISTS "Delete deliveries by assigned branch" ON public.fuel_deliveries;

CREATE POLICY "Admins/managers create deliveries" ON public.fuel_deliveries
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = fuel_deliveries.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

CREATE POLICY "Admins/managers update deliveries" ON public.fuel_deliveries
FOR UPDATE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = fuel_deliveries.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
)
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = fuel_deliveries.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

CREATE POLICY "Admins/managers delete deliveries" ON public.fuel_deliveries
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = fuel_deliveries.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

-- Restrict fuel_topups INSERT to admin/manager only
DROP POLICY IF EXISTS "Create topups by assigned branch" ON public.fuel_topups;
CREATE POLICY "Admins/managers create topups" ON public.fuel_topups
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role) OR (
    has_role(auth.uid(), 'manager'::app_role)
    AND is_assigned_to_branch(auth.uid(), branch_id)
  )
);

-- Restrict tank_dips SELECT to admin/manager only
DROP POLICY IF EXISTS "View dips by branch" ON public.tank_dips;
CREATE POLICY "Admins/managers view dips" ON public.tank_dips
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'admin'::app_role) OR EXISTS (
    SELECT 1 FROM public.tanks t
    WHERE t.id = tank_dips.tank_id
      AND has_role(auth.uid(), 'manager'::app_role)
      AND is_assigned_to_branch(auth.uid(), t.branch_id)
  )
);

-- Restrict managers' profile reads to users in their assigned branches, excluding cross-tenant exposure
DROP POLICY IF EXISTS "Managers can view tenant profiles" ON public.profiles;
CREATE POLICY "Managers can view assigned branch profiles" ON public.profiles
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND EXISTS (
    SELECT 1
    FROM public.branch_attendants ba_target
    JOIN public.branch_attendants ba_manager
      ON ba_manager.branch_id = ba_target.branch_id
    WHERE ba_target.user_id = profiles.user_id
      AND ba_manager.user_id = auth.uid()
  )
);

-- ===== 20260624191726_3f504553-6ef1-4cdc-b20b-05ab848ac987.sql =====
ALTER TABLE public.branch_fuel_types ADD COLUMN IF NOT EXISTS buying_price NUMERIC(10,2);
-- ===== 20260625181941_d194f141-9363-45f0-91c9-650e393d089e.sql =====

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

-- ===== 20260625182152_96fb9676-9c71-4f76-b074-e60748645c7a.sql =====

-- 1. Audit log table
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name TEXT NOT NULL,
  record_id UUID,
  action TEXT NOT NULL, -- INSERT | UPDATE | DELETE
  field TEXT,           -- column name for field-level update
  old_value TEXT,
  new_value TEXT,
  context JSONB,        -- e.g. {fuel_name, branch_id}
  user_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_log_table_record ON public.audit_log(table_name, record_id, created_at DESC);
CREATE INDEX idx_audit_log_created_at ON public.audit_log(created_at DESC);

GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins and managers view audit log"
  ON public.audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "System inserts audit log"
  ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (true);

-- 2. Trigger: buying_price changes on branch_fuel_types
CREATE OR REPLACE FUNCTION public.audit_branch_fuel_buying_price()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND COALESCE(OLD.buying_price::text,'') IS DISTINCT FROM COALESCE(NEW.buying_price::text,'') THEN
    INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
    VALUES ('branch_fuel_types', NEW.id, 'UPDATE', 'buying_price',
            OLD.buying_price::text, NEW.buying_price::text,
            jsonb_build_object('name', NEW.name, 'branch_id', NEW.branch_id),
            auth.uid());
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_bft_buying_price ON public.branch_fuel_types;
CREATE TRIGGER trg_audit_bft_buying_price
AFTER UPDATE ON public.branch_fuel_types
FOR EACH ROW EXECUTE FUNCTION public.audit_branch_fuel_buying_price();

-- 3. Trigger: capacity_litres changes on tanks
CREATE OR REPLACE FUNCTION public.audit_tank_capacity()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.capacity_litres IS DISTINCT FROM NEW.capacity_litres THEN
    INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
    VALUES ('tanks', NEW.id, 'UPDATE', 'capacity_litres',
            OLD.capacity_litres::text, NEW.capacity_litres::text,
            jsonb_build_object('fuel_name', NEW.fuel_name, 'branch_id', NEW.branch_id),
            auth.uid());
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_tank_capacity ON public.tanks;
CREATE TRIGGER trg_audit_tank_capacity
AFTER UPDATE ON public.tanks
FOR EACH ROW EXECUTE FUNCTION public.audit_tank_capacity();

-- 4. Trigger: fuel_deliveries INSERT / UPDATE / DELETE
CREATE OR REPLACE FUNCTION public.audit_fuel_deliveries()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  ctx JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    ctx := jsonb_build_object('tank_id', NEW.tank_id, 'supplier', NEW.supplier,
                              'delivered_litres', NEW.delivered_litres,
                              'cost_per_litre', NEW.cost_per_litre,
                              'delivery_date', NEW.delivery_date);
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_deliveries', NEW.id, 'INSERT', ctx, auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    ctx := jsonb_build_object('tank_id', OLD.tank_id, 'supplier', OLD.supplier,
                              'delivered_litres', OLD.delivered_litres,
                              'cost_per_litre', OLD.cost_per_litre,
                              'delivery_date', OLD.delivery_date);
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_deliveries', OLD.id, 'DELETE', ctx, auth.uid());
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.delivered_litres IS DISTINCT FROM NEW.delivered_litres THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_deliveries', NEW.id, 'UPDATE', 'delivered_litres',
              OLD.delivered_litres::text, NEW.delivered_litres::text, auth.uid());
    END IF;
    IF COALESCE(OLD.cost_per_litre::text,'') IS DISTINCT FROM COALESCE(NEW.cost_per_litre::text,'') THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_deliveries', NEW.id, 'UPDATE', 'cost_per_litre',
              OLD.cost_per_litre::text, NEW.cost_per_litre::text, auth.uid());
    END IF;
    IF COALESCE(OLD.supplier,'') IS DISTINCT FROM COALESCE(NEW.supplier,'') THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_deliveries', NEW.id, 'UPDATE', 'supplier',
              OLD.supplier, NEW.supplier, auth.uid());
    END IF;
    RETURN NEW;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_fuel_deliveries ON public.fuel_deliveries;
CREATE TRIGGER trg_audit_fuel_deliveries
AFTER INSERT OR UPDATE OR DELETE ON public.fuel_deliveries
FOR EACH ROW EXECUTE FUNCTION public.audit_fuel_deliveries();

-- 5. Restrict fuel_deliveries UPDATE/DELETE to admins only
DROP POLICY IF EXISTS "Admins/managers delete deliveries" ON public.fuel_deliveries;
DROP POLICY IF EXISTS "Admins/managers update deliveries" ON public.fuel_deliveries;

CREATE POLICY "Admins delete deliveries"
  ON public.fuel_deliveries FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update deliveries"
  ON public.fuel_deliveries FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ===== 20260626040452_a60eaa4d-c631-4532-95c0-7bf136f92ecd.sql =====

-- 1. Audit log: drop overly permissive INSERT policy.
-- SECURITY DEFINER trigger functions and service_role bypass RLS, so no INSERT policy is needed for legitimate writes.
DROP POLICY IF EXISTS "System inserts audit log" ON public.audit_log;

-- 2. Realtime messages: restrict private channel subscriptions to admins only.
-- The app uses only postgres_changes on public channels (governed by table RLS), so admin-only is safe.
DROP POLICY IF EXISTS "Authorized realtime subscriptions" ON realtime.messages;
CREATE POLICY "Admins only realtime subscriptions"
  ON realtime.messages
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- 3. Remove unused tenant references (no tenants table exists).
DROP FUNCTION IF EXISTS public.get_user_tenant(uuid);
ALTER TABLE public.profiles DROP COLUMN IF EXISTS tenant_id;

-- ===== 20260703122649_19315bb7-96b3-4a68-ba1b-1bfbcecd8fb1.sql =====

-- 1) Allow all authenticated users to POST expenses (attendants included). Edit/delete stay admin/manager.
DROP POLICY IF EXISTS "Admins can manage expenses" ON public.expenses;
CREATE POLICY "Anyone signed in can add expenses"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by);

-- Attendants need to read at least their own expense entries so the list reflects what they added.
DROP POLICY IF EXISTS "Admins/managers view expenses" ON public.expenses;
CREATE POLICY "View expenses"
  ON public.expenses FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin')
    OR has_role(auth.uid(), 'manager')
    OR created_by = auth.uid()
  );

-- 2) Daily opening/closing stock snapshot table (auto-managed by trigger on sales/topups + manual close-of-day).
CREATE TABLE IF NOT EXISTS public.daily_fuel_stock (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
  branch_fuel_type_id UUID REFERENCES public.branch_fuel_types(id) ON DELETE CASCADE,
  fuel_name TEXT NOT NULL,
  stock_date DATE NOT NULL DEFAULT CURRENT_DATE,
  opening_stock NUMERIC NOT NULL DEFAULT 0,
  closing_stock NUMERIC NOT NULL DEFAULT 0,
  topups_litres NUMERIC NOT NULL DEFAULT 0,
  sold_litres NUMERIC NOT NULL DEFAULT 0,
  revenue NUMERIC NOT NULL DEFAULT 0,
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (branch_fuel_type_id, stock_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_fuel_stock TO authenticated;
GRANT ALL ON public.daily_fuel_stock TO service_role;

ALTER TABLE public.daily_fuel_stock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View daily stock" ON public.daily_fuel_stock FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager')
         OR (branch_id IS NOT NULL AND is_assigned_to_branch(auth.uid(), branch_id)));

CREATE POLICY "Admins/managers manage daily stock" ON public.daily_fuel_stock FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'))
  WITH CHECK (has_role(auth.uid(), 'admin') OR has_role(auth.uid(), 'manager'));

CREATE TRIGGER trg_daily_fuel_stock_updated_at
  BEFORE UPDATE ON public.daily_fuel_stock
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== 20260705161046_a286df6b-5a4a-42b1-ab54-af92fdb191c4.sql =====

-- =========================================================
-- 1. Extend fuel_topups to absorb fuel_deliveries semantics
-- =========================================================
ALTER TABLE public.fuel_topups
  ADD COLUMN IF NOT EXISTS tank_id uuid REFERENCES public.tanks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier text,
  ADD COLUMN IF NOT EXISTS cost_per_litre numeric,
  ADD COLUMN IF NOT EXISTS expected_litres numeric,
  ADD COLUMN IF NOT EXISTS topup_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS last_modified_by uuid,
  ADD COLUMN IF NOT EXISTS last_modified_at timestamptz;

-- Migrate existing deliveries into fuel_topups (best-effort mapping via tank -> branch/fuel).
INSERT INTO public.fuel_topups
  (id, branch_id, fuel_type_id, branch_fuel_type_id, tank_id,
   litres, supplier, cost_per_litre, expected_litres, topup_date, notes,
   created_by, created_at)
SELECT
  d.id,
  t.branch_id,
  (SELECT ft.id FROM public.fuel_types ft WHERE ft.name = t.fuel_name LIMIT 1),
  (SELECT bft.id FROM public.branch_fuel_types bft
     WHERE bft.branch_id = t.branch_id AND bft.name = t.fuel_name LIMIT 1),
  d.tank_id,
  d.delivered_litres,
  d.supplier,
  d.cost_per_litre,
  d.expected_litres,
  d.delivery_date,
  d.notes,
  d.recorded_by,
  d.created_at
FROM public.fuel_deliveries d
JOIN public.tanks t ON t.id = d.tank_id
ON CONFLICT (id) DO NOTHING;

-- Drop old delivery triggers / audit / table
DROP TRIGGER IF EXISTS apply_fuel_delivery_trg ON public.fuel_deliveries;
DROP TRIGGER IF EXISTS audit_fuel_deliveries_trg ON public.fuel_deliveries;
DROP TABLE IF EXISTS public.fuel_deliveries CASCADE;

-- =========================================================
-- 2. Concurrency-safe apply-topup trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.apply_fuel_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_capacity numeric;
  v_current  numeric;
BEGIN
  IF NEW.tank_id IS NOT NULL THEN
    -- Lock the tank row to prevent concurrent over-fill
    SELECT capacity_litres, current_level_litres
      INTO v_capacity, v_current
      FROM public.tanks WHERE id = NEW.tank_id FOR UPDATE;

    IF v_current + NEW.litres > v_capacity THEN
      RAISE EXCEPTION 'Top-up of % L exceeds tank capacity (% L available)',
        NEW.litres, GREATEST(0, v_capacity - v_current);
    END IF;

    UPDATE public.tanks
       SET current_level_litres = current_level_litres + NEW.litres,
           updated_at = now()
     WHERE id = NEW.tank_id;
  END IF;

  IF NEW.branch_fuel_type_id IS NOT NULL THEN
    UPDATE public.branch_fuel_types
       SET stock_level = stock_level + NEW.litres,
           buying_price = COALESCE(NEW.cost_per_litre, buying_price),
           updated_at = now()
     WHERE id = NEW.branch_fuel_type_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_fuel_topup_trg ON public.fuel_topups;
CREATE TRIGGER apply_fuel_topup_trg
AFTER INSERT ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.apply_fuel_topup();

-- Audit changes to top-ups
CREATE OR REPLACE FUNCTION public.audit_fuel_topups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_topups', NEW.id, 'INSERT',
      jsonb_build_object('tank_id', NEW.tank_id, 'litres', NEW.litres,
                         'supplier', NEW.supplier, 'cost_per_litre', NEW.cost_per_litre,
                         'topup_date', NEW.topup_date),
      auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_topups', OLD.id, 'DELETE',
      jsonb_build_object('tank_id', OLD.tank_id, 'litres', OLD.litres),
      auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS audit_fuel_topups_trg ON public.fuel_topups;
CREATE TRIGGER audit_fuel_topups_trg
AFTER INSERT OR DELETE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.audit_fuel_topups();

-- Admins may delete a top-up (for audited corrections)
DROP POLICY IF EXISTS "Admins delete topups" ON public.fuel_topups;
CREATE POLICY "Admins delete topups" ON public.fuel_topups
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- =========================================================
-- 3. Concurrency-safe sale deduction RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(
  _branch_fuel_type_id uuid,
  _litres numeric
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_stock numeric;
  v_remaining numeric := _litres;
  r RECORD;
  v_take numeric;
BEGIN
  IF _litres IS NULL OR _litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be positive';
  END IF;

  -- Lock the branch_fuel_types row
  SELECT stock_level INTO v_stock
    FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id FOR UPDATE;

  IF v_stock IS NULL THEN
    RAISE EXCEPTION 'Fuel product not found';
  END IF;

  IF v_stock < _litres THEN
    RAISE EXCEPTION 'Insufficient stock: % L requested, % L available', _litres, v_stock;
  END IF;

  UPDATE public.branch_fuel_types
     SET stock_level = stock_level - _litres,
         updated_at = now()
   WHERE id = _branch_fuel_type_id;

  -- Deduct across linked tanks in creation order, locking each row
  FOR r IN
    SELECT t.id, t.current_level_litres
      FROM public.branch_fuel_type_tanks lnk
      JOIN public.tanks t ON t.id = lnk.tank_id
     WHERE lnk.branch_fuel_type_id = _branch_fuel_type_id
     ORDER BY lnk.created_at ASC
     FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF r.current_level_litres <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(r.current_level_litres, v_remaining);
    UPDATE public.tanks
       SET current_level_litres = current_level_litres - v_take,
           updated_at = now()
     WHERE id = r.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_fuel_sale(uuid, numeric) TO authenticated;

-- =========================================================
-- 4. Audit daily_fuel_stock corrections
-- =========================================================
CREATE OR REPLACE FUNCTION public.audit_daily_fuel_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  ctx jsonb := jsonb_build_object(
    'branch_id', NEW.branch_id,
    'fuel_name', NEW.fuel_name,
    'stock_date', NEW.stock_date
  );
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.opening_stock IS DISTINCT FROM NEW.opening_stock THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'opening_stock',
              OLD.opening_stock::text, NEW.opening_stock::text, ctx, auth.uid());
    END IF;
    IF OLD.closing_stock IS DISTINCT FROM NEW.closing_stock THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'closing_stock',
              OLD.closing_stock::text, NEW.closing_stock::text, ctx, auth.uid());
    END IF;
    IF OLD.topups_litres IS DISTINCT FROM NEW.topups_litres THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'topups_litres',
              OLD.topups_litres::text, NEW.topups_litres::text, ctx, auth.uid());
    END IF;
    IF OLD.sold_litres IS DISTINCT FROM NEW.sold_litres THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'sold_litres',
              OLD.sold_litres::text, NEW.sold_litres::text, ctx, auth.uid());
    END IF;
    IF OLD.revenue IS DISTINCT FROM NEW.revenue THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
      VALUES ('daily_fuel_stock', NEW.id, 'UPDATE', 'revenue',
              OLD.revenue::text, NEW.revenue::text, ctx, auth.uid());
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS audit_daily_fuel_stock_trg ON public.daily_fuel_stock;
CREATE TRIGGER audit_daily_fuel_stock_trg
AFTER UPDATE ON public.daily_fuel_stock
FOR EACH ROW EXECUTE FUNCTION public.audit_daily_fuel_stock();

-- =========================================================
-- 5. Per-user page permissions
-- =========================================================
CREATE TABLE IF NOT EXISTS public.user_page_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, page_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_page_permissions TO authenticated;
GRANT ALL ON public.user_page_permissions TO service_role;

ALTER TABLE public.user_page_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own page permissions" ON public.user_page_permissions;
CREATE POLICY "Users can view own page permissions" ON public.user_page_permissions
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins manage page permissions" ON public.user_page_permissions;
CREATE POLICY "Admins manage page permissions" ON public.user_page_permissions
FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.has_page_permission(_user_id uuid, _page text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_page_permissions
     WHERE user_id = _user_id AND page_key = _page
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_page_permission(uuid, text) TO authenticated;

-- ===== 20260710140206_3ba11f42-d36a-433f-8c9e-13927a00d8e0.sql =====

-- Idempotency log for fuel sale deductions
CREATE TABLE IF NOT EXISTS public.sale_deduction_log (
  idempotency_key text PRIMARY KEY,
  branch_fuel_type_id uuid NOT NULL,
  litres numeric NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  processed_by uuid
);

GRANT SELECT, INSERT ON public.sale_deduction_log TO authenticated;
GRANT ALL ON public.sale_deduction_log TO service_role;

ALTER TABLE public.sale_deduction_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read deduction log"
  ON public.sale_deduction_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert deduction log"
  ON public.sale_deduction_log FOR INSERT TO authenticated WITH CHECK (true);

-- Replace deduct_fuel_sale with idempotent version
CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(
  _branch_fuel_type_id uuid,
  _litres numeric,
  _idempotency_key text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_stock numeric;
  v_remaining numeric := _litres;
  r RECORD;
  v_take numeric;
  v_inserted boolean := false;
BEGIN
  IF _litres IS NULL OR _litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be positive';
  END IF;

  -- Idempotency guard: if key was already processed, exit without deducting.
  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    BEGIN
      INSERT INTO public.sale_deduction_log(idempotency_key, branch_fuel_type_id, litres, processed_by)
      VALUES (_idempotency_key, _branch_fuel_type_id, _litres, auth.uid());
      v_inserted := true;
    EXCEPTION WHEN unique_violation THEN
      -- Already processed; no-op.
      RETURN;
    END;
  END IF;

  -- Lock branch_fuel_types row
  SELECT stock_level INTO v_stock
    FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id FOR UPDATE;

  IF v_stock IS NULL THEN
    RAISE EXCEPTION 'Fuel product not found';
  END IF;

  IF v_stock < _litres THEN
    RAISE EXCEPTION 'Insufficient stock: % L requested, % L available', _litres, v_stock;
  END IF;

  UPDATE public.branch_fuel_types
     SET stock_level = stock_level - _litres,
         updated_at = now()
   WHERE id = _branch_fuel_type_id;

  FOR r IN
    SELECT t.id, t.current_level_litres
      FROM public.branch_fuel_type_tanks lnk
      JOIN public.tanks t ON t.id = lnk.tank_id
     WHERE lnk.branch_fuel_type_id = _branch_fuel_type_id
     ORDER BY lnk.created_at ASC
     FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF r.current_level_litres <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(r.current_level_litres, v_remaining);
    UPDATE public.tanks
       SET current_level_litres = current_level_litres - v_take,
           updated_at = now()
     WHERE id = r.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$function$;

-- ===== 20260716102757_62d5f437-010e-49a9-b012-927fe76217e8.sql =====

-- Add locking columns to daily_fuel_stock so admins can "Finalize Day"
ALTER TABLE public.daily_fuel_stock
  ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid;

-- Prevent edits to a locked day unless the actor is an admin (who may unlock/correct)
CREATE OR REPLACE FUNCTION public.enforce_daily_fuel_stock_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.locked = true THEN
    IF NOT public.has_role(auth.uid(), 'admin') THEN
      RAISE EXCEPTION 'This day has been finalized and is locked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_daily_fuel_stock_lock ON public.daily_fuel_stock;
CREATE TRIGGER trg_enforce_daily_fuel_stock_lock
  BEFORE UPDATE ON public.daily_fuel_stock
  FOR EACH ROW EXECUTE FUNCTION public.enforce_daily_fuel_stock_lock();

-- ===== 20260716132306_3fc6d51d-3c99-404f-b773-a4c0161e41cd.sql =====

-- 1. Harden deduct_fuel_sale RPC (both overloads) with branch access check
CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(_branch_fuel_type_id uuid, _litres numeric, _idempotency_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock numeric;
  v_remaining numeric := _litres;
  r RECORD;
  v_take numeric;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _litres IS NULL OR _litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be positive';
  END IF;

  SELECT branch_id INTO v_branch_id FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Fuel product not found';
  END IF;

  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.is_assigned_to_branch(auth.uid(), v_branch_id)
  ) THEN
    RAISE EXCEPTION 'Not authorized to deduct fuel for this branch';
  END IF;

  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    BEGIN
      INSERT INTO public.sale_deduction_log(idempotency_key, branch_fuel_type_id, litres, processed_by)
      VALUES (_idempotency_key, _branch_fuel_type_id, _litres, auth.uid());
    EXCEPTION WHEN unique_violation THEN
      RETURN;
    END;
  END IF;

  SELECT stock_level INTO v_stock
    FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id FOR UPDATE;

  IF v_stock < _litres THEN
    RAISE EXCEPTION 'Insufficient stock: % L requested, % L available', _litres, v_stock;
  END IF;

  UPDATE public.branch_fuel_types
     SET stock_level = stock_level - _litres,
         updated_at = now()
   WHERE id = _branch_fuel_type_id;

  FOR r IN
    SELECT t.id, t.current_level_litres
      FROM public.branch_fuel_type_tanks lnk
      JOIN public.tanks t ON t.id = lnk.tank_id
     WHERE lnk.branch_fuel_type_id = _branch_fuel_type_id
     ORDER BY lnk.created_at ASC
     FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF r.current_level_litres <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(r.current_level_litres, v_remaining);
    UPDATE public.tanks
       SET current_level_litres = current_level_litres - v_take,
           updated_at = now()
     WHERE id = r.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(_branch_fuel_type_id uuid, _litres numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.deduct_fuel_sale(_branch_fuel_type_id, _litres, NULL);
END;
$function$;

-- 2. Tighten sales INSERT policy to require branch membership
DROP POLICY IF EXISTS "Attendants can create sales" ON public.sales;
CREATE POLICY "Users create sales for their branch"
  ON public.sales FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = attendant_id
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.is_assigned_to_branch(auth.uid(), branch_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.branch_fuel_types bft
      WHERE bft.id = sales.fuel_type_id AND bft.branch_id = sales.branch_id
    )
  );

-- Block non-admins from backdating created_at via client
CREATE OR REPLACE FUNCTION public.enforce_sales_created_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    NEW.created_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_sales_created_at ON public.sales;
CREATE TRIGGER trg_enforce_sales_created_at
  BEFORE INSERT OR UPDATE OF created_at ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.enforce_sales_created_at();

-- 3. Scope mpesa_transactions INSERT to sale ownership/role
DROP POLICY IF EXISTS "Authenticated can create mpesa" ON public.mpesa_transactions;
CREATE POLICY "Attendants create mpesa for own sale"
  ON public.mpesa_transactions FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR EXISTS (
      SELECT 1 FROM public.sales s
      WHERE s.id = mpesa_transactions.sale_id
        AND (s.attendant_id = auth.uid() OR public.is_assigned_to_branch(auth.uid(), s.branch_id))
    )
  );

-- 4. Restrict sale_deduction_log to admins (SECURITY DEFINER RPC writes bypass RLS)
DROP POLICY IF EXISTS "Authenticated can insert deduction log" ON public.sale_deduction_log;
DROP POLICY IF EXISTS "Authenticated can read deduction log" ON public.sale_deduction_log;
CREATE POLICY "Admins read deduction log"
  ON public.sale_deduction_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins insert deduction log"
  ON public.sale_deduction_log FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 5. Ensure new attendants must rotate password (defaults + backfill for accounts flagged)
ALTER TABLE public.profiles ALTER COLUMN must_change_password SET DEFAULT true;

-- ===== 20260725094526_b44624dd-1c16-4748-b488-025f31225305.sql =====
DROP POLICY IF EXISTS "Users create sales for their branch" ON public.sales;

CREATE POLICY "Users create sales for their branch"
ON public.sales
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = attendant_id
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.is_assigned_to_branch(auth.uid(), branch_id)
  )
  AND EXISTS (
    SELECT 1
    FROM public.branch_fuel_types bft
    JOIN public.fuel_types ft ON ft.name = bft.name
    WHERE bft.branch_id = sales.branch_id
      AND ft.id = sales.fuel_type_id
  )
);
-- ===== 20260801185602_8276fd96-1bad-46ed-bfc8-abdbfa912c62.sql =====
-- 1. Sale reversal tracking on sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS reversed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by uuid;

-- 2. Reversal requests
CREATE TABLE IF NOT EXISTS public.sale_reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  branch_id uuid,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sale_reversals_one_pending
  ON public.sale_reversals(sale_id) WHERE status = 'pending';

GRANT SELECT, INSERT ON public.sale_reversals TO authenticated;
GRANT UPDATE ON public.sale_reversals TO authenticated;
GRANT ALL ON public.sale_reversals TO service_role;

ALTER TABLE public.sale_reversals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View reversals for accessible branches"
  ON public.sale_reversals FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR requested_by = auth.uid()
    OR (branch_id IS NOT NULL AND public.can_access_branch(auth.uid(), branch_id))
  );

CREATE POLICY "Request reversal for accessible branches"
  ON public.sale_reversals FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND status = 'pending'
    AND (
      public.has_role(auth.uid(), 'admin')
      OR (branch_id IS NOT NULL AND public.can_access_branch(auth.uid(), branch_id))
    )
  );

CREATE POLICY "Admins review reversals"
  ON public.sale_reversals FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER sale_reversals_updated_at
  BEFORE UPDATE ON public.sale_reversals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Approve / reject a reversal (admin only). Approving restores stock.
CREATE OR REPLACE FUNCTION public.review_sale_reversal(_reversal_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  s RECORD;
  v_bft_id uuid;
  v_tank_id uuid;
  v_remaining numeric;
  v_room numeric;
  t RECORD;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can review reversals';
  END IF;

  SELECT * INTO r FROM public.sale_reversals WHERE id = _reversal_id FOR UPDATE;
  IF r IS NULL THEN RAISE EXCEPTION 'Reversal request not found'; END IF;
  IF r.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been reviewed'; END IF;

  IF NOT _approve THEN
    UPDATE public.sale_reversals
       SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
     WHERE id = _reversal_id;
    RETURN;
  END IF;

  SELECT sa.*, ft.name AS fuel_name INTO s
    FROM public.sales sa
    LEFT JOIN public.fuel_types ft ON ft.id = sa.fuel_type_id
   WHERE sa.id = r.sale_id
   FOR UPDATE OF sa;
  IF s IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF s.reversed_at IS NOT NULL THEN RAISE EXCEPTION 'Sale already reversed'; END IF;

  -- Restore product stock
  SELECT id INTO v_bft_id FROM public.branch_fuel_types
   WHERE branch_id = s.branch_id AND name = s.fuel_name
   LIMIT 1;

  IF v_bft_id IS NOT NULL THEN
    UPDATE public.branch_fuel_types
       SET stock_level = stock_level + s.litres, updated_at = now()
     WHERE id = v_bft_id;

    -- Put litres back into linked tanks (respecting capacity)
    v_remaining := s.litres;
    FOR t IN
      SELECT tk.id, tk.capacity_litres, tk.current_level_litres
        FROM public.branch_fuel_type_tanks lnk
        JOIN public.tanks tk ON tk.id = lnk.tank_id
       WHERE lnk.branch_fuel_type_id = v_bft_id
       ORDER BY lnk.created_at ASC
       FOR UPDATE OF tk
    LOOP
      EXIT WHEN v_remaining <= 0;
      v_room := GREATEST(0, t.capacity_litres - t.current_level_litres);
      IF v_room <= 0 THEN CONTINUE; END IF;
      UPDATE public.tanks
         SET current_level_litres = current_level_litres + LEAST(v_room, v_remaining),
             updated_at = now()
       WHERE id = t.id;
      v_remaining := v_remaining - LEAST(v_room, v_remaining);
    END LOOP;
  END IF;

  UPDATE public.sales
     SET reversed_at = now(), reversed_by = auth.uid()
   WHERE id = s.id;

  UPDATE public.sale_reversals
     SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = _note
   WHERE id = _reversal_id;

  INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
  VALUES ('sales', s.id, 'UPDATE', 'reversed', 'active', 'reversed',
          jsonb_build_object('litres', s.litres, 'amount', s.total_amount, 'reason', r.reason),
          auth.uid());
END;
$$;

-- 4. Automatic daily finalization
CREATE OR REPLACE FUNCTION public.finalize_fuel_day(_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  v_closing numeric;
  v_topups numeric;
  v_sold numeric;
  v_revenue numeric;
  v_count integer := 0;
  d_start timestamptz := (_date::timestamp AT TIME ZONE 'Africa/Nairobi');
  d_end   timestamptz := ((_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');
BEGIN
  FOR b IN SELECT id, branch_id, name, stock_level FROM public.branch_fuel_types LOOP
    SELECT COALESCE(SUM(tk.current_level_litres), b.stock_level) INTO v_closing
      FROM public.branch_fuel_type_tanks lnk
      JOIN public.tanks tk ON tk.id = lnk.tank_id
     WHERE lnk.branch_fuel_type_id = b.id;
    v_closing := COALESCE(v_closing, b.stock_level);

    SELECT COALESCE(SUM(litres), 0) INTO v_topups
      FROM public.fuel_topups
     WHERE branch_fuel_type_id = b.id
       AND created_at >= d_start AND created_at < d_end;

    SELECT COALESCE(SUM(sa.litres), 0), COALESCE(SUM(sa.total_amount), 0)
      INTO v_sold, v_revenue
      FROM public.sales sa
      JOIN public.fuel_types ft ON ft.id = sa.fuel_type_id
     WHERE sa.branch_id = b.branch_id AND ft.name = b.name
       AND sa.reversed_at IS NULL
       AND sa.created_at >= d_start AND sa.created_at < d_end;

    INSERT INTO public.daily_fuel_stock (
      branch_id, branch_fuel_type_id, fuel_name, stock_date,
      opening_stock, closing_stock, topups_litres, sold_litres, revenue, locked, locked_at
    ) VALUES (
      b.branch_id, b.id, b.name, _date,
      ROUND(v_closing + v_sold - v_topups, 2), ROUND(v_closing, 2),
      ROUND(v_topups, 2), ROUND(v_sold, 2), ROUND(v_revenue, 2), true, now()
    )
    ON CONFLICT (branch_fuel_type_id, stock_date) DO UPDATE
      SET opening_stock = EXCLUDED.opening_stock,
          closing_stock = EXCLUDED.closing_stock,
          topups_litres = EXCLUDED.topups_litres,
          sold_litres = EXCLUDED.sold_litres,
          revenue = EXCLUDED.revenue,
          locked = true,
          locked_at = now(),
          updated_at = now();
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('finalize-fuel-day-midnight')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'finalize-fuel-day-midnight');

SELECT cron.schedule(
  'finalize-fuel-day-midnight',
  '55 20 * * *',
  $$ SELECT public.finalize_fuel_day((now() AT TIME ZONE 'Africa/Nairobi')::date); $$
);
-- ===== 20260803063210_3f242b31-911b-45f3-b297-9c4f5dbbdd83.sql =====
CREATE OR REPLACE FUNCTION public.deduct_fuel_sale(_branch_fuel_type_id uuid, _litres numeric, _idempotency_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_stock numeric;
  v_remaining numeric := _litres;
  r RECORD;
  v_take numeric;
  v_branch_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _litres IS NULL OR _litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be positive';
  END IF;

  SELECT branch_id INTO v_branch_id FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id;
  IF v_branch_id IS NULL THEN
    RAISE EXCEPTION 'Fuel product not found';
  END IF;

  -- Explicit branch-membership enforcement: admins only bypass
  IF NOT public.can_access_branch(auth.uid(), v_branch_id) THEN
    RAISE EXCEPTION 'Not authorized to deduct fuel for this branch';
  END IF;

  IF _idempotency_key IS NOT NULL AND length(_idempotency_key) > 0 THEN
    BEGIN
      INSERT INTO public.sale_deduction_log(idempotency_key, branch_fuel_type_id, litres, processed_by)
      VALUES (_idempotency_key, _branch_fuel_type_id, _litres, auth.uid());
    EXCEPTION WHEN unique_violation THEN
      RETURN;
    END;
  END IF;

  SELECT stock_level INTO v_stock
    FROM public.branch_fuel_types WHERE id = _branch_fuel_type_id FOR UPDATE;

  IF v_stock < _litres THEN
    RAISE EXCEPTION 'Insufficient stock: % L requested, % L available', _litres, v_stock;
  END IF;

  UPDATE public.branch_fuel_types
     SET stock_level = stock_level - _litres,
         updated_at = now()
   WHERE id = _branch_fuel_type_id;

  FOR r IN
    SELECT t.id, t.current_level_litres
      FROM public.branch_fuel_type_tanks lnk
      JOIN public.tanks t ON t.id = lnk.tank_id
     WHERE lnk.branch_fuel_type_id = _branch_fuel_type_id
     ORDER BY lnk.created_at ASC
     FOR UPDATE OF t
  LOOP
    EXIT WHEN v_remaining <= 0;
    IF r.current_level_litres <= 0 THEN CONTINUE; END IF;
    v_take := LEAST(r.current_level_litres, v_remaining);
    UPDATE public.tanks
       SET current_level_litres = current_level_litres - v_take,
           updated_at = now()
     WHERE id = r.id;
    v_remaining := v_remaining - v_take;
  END LOOP;
END;
$function$;
-- ===== 20260904120518_6682334a-8d41-46a3-99b2-ca5a21ea5a92.sql =====
CREATE OR REPLACE FUNCTION public.revert_fuel_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.tank_id IS NOT NULL THEN
    UPDATE public.tanks
       SET current_level_litres = GREATEST(0, current_level_litres - OLD.litres),
           updated_at = now()
     WHERE id = OLD.tank_id;
  END IF;

  IF OLD.branch_fuel_type_id IS NOT NULL THEN
    UPDATE public.branch_fuel_types
       SET stock_level = GREATEST(0, stock_level - OLD.litres),
           updated_at = now()
     WHERE id = OLD.branch_fuel_type_id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS revert_fuel_topup_trg ON public.fuel_topups;
CREATE TRIGGER revert_fuel_topup_trg
BEFORE DELETE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.revert_fuel_topup();
-- ===== 20260904121430_2c24a5bc-5b59-423e-a2ec-11dcfabe3c74.sql =====
-- Helper: recompute a daily_fuel_stock row from live data
CREATE OR REPLACE FUNCTION public.recalc_daily_fuel_stock(_bft_id uuid, _date date)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  b RECORD;
  v_closing numeric;
  v_topups numeric;
  v_sold numeric;
  v_revenue numeric;
  d_start timestamptz := (_date::timestamp AT TIME ZONE 'Africa/Nairobi');
  d_end   timestamptz := ((_date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi');
BEGIN
  IF _bft_id IS NULL OR _date IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.daily_fuel_stock WHERE branch_fuel_type_id = _bft_id AND stock_date = _date) THEN
    RETURN;
  END IF;

  SELECT id, branch_id, name, stock_level INTO b
    FROM public.branch_fuel_types WHERE id = _bft_id;
  IF b IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(tk.current_level_litres), b.stock_level) INTO v_closing
    FROM public.branch_fuel_type_tanks lnk
    JOIN public.tanks tk ON tk.id = lnk.tank_id
   WHERE lnk.branch_fuel_type_id = b.id;
  v_closing := GREATEST(0, COALESCE(v_closing, b.stock_level));

  SELECT COALESCE(SUM(litres), 0) INTO v_topups
    FROM public.fuel_topups
   WHERE branch_fuel_type_id = b.id
     AND created_at >= d_start AND created_at < d_end;

  SELECT COALESCE(SUM(sa.litres), 0), COALESCE(SUM(sa.total_amount), 0)
    INTO v_sold, v_revenue
    FROM public.sales sa
    JOIN public.fuel_types ft ON ft.id = sa.fuel_type_id
   WHERE sa.branch_id = b.branch_id AND ft.name = b.name
     AND sa.reversed_at IS NULL
     AND sa.created_at >= d_start AND sa.created_at < d_end;

  UPDATE public.daily_fuel_stock
     SET opening_stock = GREATEST(0, ROUND(v_closing + v_sold - v_topups, 2)),
         closing_stock = ROUND(v_closing, 2),
         topups_litres = ROUND(v_topups, 2),
         sold_litres   = ROUND(v_sold, 2),
         revenue       = ROUND(v_revenue, 2),
         updated_at    = now()
   WHERE branch_fuel_type_id = b.id AND stock_date = _date;
END;
$$;

-- Safer revert on delete: block instead of silently clamping
CREATE OR REPLACE FUNCTION public.revert_fuel_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tank numeric;
  v_stock numeric;
BEGIN
  IF OLD.tank_id IS NOT NULL THEN
    SELECT current_level_litres INTO v_tank FROM public.tanks WHERE id = OLD.tank_id FOR UPDATE;
    IF v_tank IS NOT NULL AND v_tank < OLD.litres THEN
      RAISE EXCEPTION 'Cannot remove this top-up: the tank only holds % L now, less than the % L being reversed. Record a dip reading first.', ROUND(v_tank,2), ROUND(OLD.litres,2);
    END IF;
    UPDATE public.tanks
       SET current_level_litres = GREATEST(0, current_level_litres - OLD.litres),
           updated_at = now()
     WHERE id = OLD.tank_id;
  END IF;

  IF OLD.branch_fuel_type_id IS NOT NULL THEN
    SELECT stock_level INTO v_stock FROM public.branch_fuel_types WHERE id = OLD.branch_fuel_type_id FOR UPDATE;
    IF v_stock IS NOT NULL AND v_stock < OLD.litres THEN
      RAISE EXCEPTION 'Cannot remove this top-up: product stock is % L, less than the % L being reversed.', ROUND(v_stock,2), ROUND(OLD.litres,2);
    END IF;
    UPDATE public.branch_fuel_types
       SET stock_level = GREATEST(0, stock_level - OLD.litres),
           updated_at = now()
     WHERE id = OLD.branch_fuel_type_id;
  END IF;

  RETURN OLD;
END;
$$;

-- Apply edits to a top-up (admin only) as deltas, never going negative
CREATE OR REPLACE FUNCTION public.apply_fuel_topup_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_delta numeric := NEW.litres - OLD.litres;
  v_cap numeric;
  v_cur numeric;
  v_stock numeric;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can edit top-up records';
  END IF;
  IF NEW.litres IS NULL OR NEW.litres <= 0 THEN
    RAISE EXCEPTION 'Litres must be greater than zero';
  END IF;
  IF NEW.tank_id IS DISTINCT FROM OLD.tank_id OR NEW.branch_fuel_type_id IS DISTINCT FROM OLD.branch_fuel_type_id THEN
    RAISE EXCEPTION 'Tank and fuel product cannot be changed. Delete the record and create a new one.';
  END IF;

  IF v_delta <> 0 AND NEW.tank_id IS NOT NULL THEN
    SELECT capacity_litres, current_level_litres INTO v_cap, v_cur
      FROM public.tanks WHERE id = NEW.tank_id FOR UPDATE;
    IF v_cur + v_delta < 0 THEN
      RAISE EXCEPTION 'Edit rejected: tank would drop below zero (currently % L).', ROUND(v_cur,2);
    END IF;
    IF v_cur + v_delta > v_cap THEN
      RAISE EXCEPTION 'Edit rejected: exceeds tank capacity by % L.', ROUND(v_cur + v_delta - v_cap, 2);
    END IF;
    UPDATE public.tanks
       SET current_level_litres = v_cur + v_delta, updated_at = now()
     WHERE id = NEW.tank_id;
  END IF;

  IF NEW.branch_fuel_type_id IS NOT NULL THEN
    SELECT stock_level INTO v_stock FROM public.branch_fuel_types WHERE id = NEW.branch_fuel_type_id FOR UPDATE;
    IF v_stock + v_delta < 0 THEN
      RAISE EXCEPTION 'Edit rejected: product stock would drop below zero (currently % L).', ROUND(v_stock,2);
    END IF;
    UPDATE public.branch_fuel_types
       SET stock_level = v_stock + v_delta,
           buying_price = COALESCE(NEW.cost_per_litre, buying_price),
           updated_at = now()
     WHERE id = NEW.branch_fuel_type_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_fuel_topup_update_trg ON public.fuel_topups;
CREATE TRIGGER apply_fuel_topup_update_trg
BEFORE UPDATE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.apply_fuel_topup_update();

-- Audit inserts, updates and deletes of top-ups
CREATE OR REPLACE FUNCTION public.audit_fuel_topups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_topups', NEW.id, 'INSERT',
      jsonb_build_object('tank_id', NEW.tank_id, 'litres', NEW.litres,
                         'supplier', NEW.supplier, 'cost_per_litre', NEW.cost_per_litre,
                         'topup_date', NEW.topup_date),
      auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.litres IS DISTINCT FROM NEW.litres THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'litres', OLD.litres::text, NEW.litres::text, auth.uid());
    END IF;
    IF COALESCE(OLD.cost_per_litre::text,'') IS DISTINCT FROM COALESCE(NEW.cost_per_litre::text,'') THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'cost_per_litre', OLD.cost_per_litre::text, NEW.cost_per_litre::text, auth.uid());
    END IF;
    IF COALESCE(OLD.supplier,'') IS DISTINCT FROM COALESCE(NEW.supplier,'') THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'supplier', OLD.supplier, NEW.supplier, auth.uid());
    END IF;
    IF COALESCE(OLD.expected_litres::text,'') IS DISTINCT FROM COALESCE(NEW.expected_litres::text,'') THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'expected_litres', OLD.expected_litres::text, NEW.expected_litres::text, auth.uid());
    END IF;
    IF OLD.topup_date IS DISTINCT FROM NEW.topup_date THEN
      INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, user_id)
      VALUES ('fuel_topups', NEW.id, 'UPDATE', 'topup_date', OLD.topup_date::text, NEW.topup_date::text, auth.uid());
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log(table_name, record_id, action, context, user_id)
    VALUES ('fuel_topups', OLD.id, 'DELETE',
      jsonb_build_object('tank_id', OLD.tank_id, 'litres', OLD.litres,
                         'supplier', OLD.supplier, 'cost_per_litre', OLD.cost_per_litre,
                         'topup_date', OLD.topup_date),
      auth.uid());
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS audit_fuel_topups_trg ON public.fuel_topups;
CREATE TRIGGER audit_fuel_topups_trg
AFTER INSERT OR UPDATE OR DELETE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.audit_fuel_topups();

-- Recalculate the affected daily stock row after any top-up change
CREATE OR REPLACE FUNCTION public.sync_daily_stock_after_topup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_daily_fuel_stock(OLD.branch_fuel_type_id, (OLD.created_at AT TIME ZONE 'Africa/Nairobi')::date);
    RETURN OLD;
  END IF;
  PERFORM public.recalc_daily_fuel_stock(NEW.branch_fuel_type_id, (NEW.created_at AT TIME ZONE 'Africa/Nairobi')::date);
  IF TG_OP = 'UPDATE' AND OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    PERFORM public.recalc_daily_fuel_stock(OLD.branch_fuel_type_id, (OLD.created_at AT TIME ZONE 'Africa/Nairobi')::date);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_daily_stock_after_topup_trg ON public.fuel_topups;
CREATE TRIGGER sync_daily_stock_after_topup_trg
AFTER INSERT OR UPDATE OR DELETE ON public.fuel_topups
FOR EACH ROW EXECUTE FUNCTION public.sync_daily_stock_after_topup();

-- Admin-only edits
DROP POLICY IF EXISTS "Admins update topups" ON public.fuel_topups;
CREATE POLICY "Admins update topups" ON public.fuel_topups
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- ===== 20260904121443_1520c8c7-b9bc-43cd-a895-27e4da99997d.sql =====
REVOKE ALL ON FUNCTION public.recalc_daily_fuel_stock(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_fuel_topup_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_daily_stock_after_topup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_fuel_topup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_fuel_topups() FROM PUBLIC, anon, authenticated;
-- ===== 20260906214213_5e03a392-c09e-4874-acf2-8e583762548c.sql =====
CREATE OR REPLACE FUNCTION public.log_offline_sync_event(
  _record_id uuid,
  _action text,
  _field text DEFAULT NULL,
  _old_value text DEFAULT NULL,
  _new_value text DEFAULT NULL,
  _context jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _action NOT IN ('offline_sync', 'offline_conflict_merge', 'offline_conflict_overwrite', 'offline_sync_failed') THEN
    RAISE EXCEPTION 'Unsupported offline sync action';
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, field, old_value, new_value, context, user_id)
  VALUES ('sales', _record_id, _action, _field, _old_value, _new_value, _context, auth.uid())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_offline_sync_event(uuid, text, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_offline_sync_event(uuid, text, text, text, text, jsonb) TO authenticated;
-- ===== 20260906215413_486493dd-0a02-4fe0-9e6f-398e1dce5a4a.sql =====
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
-- ===== 20260906221704_7a02dce1-d452-472f-9ca8-ebf25a11a6f8.sql =====
CREATE OR REPLACE FUNCTION public.audit_sale_reversal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
    VALUES ('sale_reversals', NEW.sale_id, 'INSERT', 'status', NULL, NEW.status,
            jsonb_build_object('reversal_id', NEW.id, 'reason', NEW.reason,
                               'branch_id', NEW.branch_id, 'requested_at', NEW.requested_at),
            COALESCE(NEW.requested_by, auth.uid()));
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.audit_log(table_name, record_id, action, field, old_value, new_value, context, user_id)
    VALUES ('sale_reversals', NEW.sale_id, 'UPDATE', 'status', OLD.status, NEW.status,
            jsonb_build_object('reversal_id', NEW.id, 'reason', NEW.reason,
                               'review_note', NEW.review_note, 'branch_id', NEW.branch_id,
                               'reviewed_at', COALESCE(NEW.reviewed_at, now())),
            COALESCE(NEW.reviewed_by, auth.uid()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_sale_reversal ON public.sale_reversals;
CREATE TRIGGER trg_audit_sale_reversal
AFTER INSERT OR UPDATE ON public.sale_reversals
FOR EACH ROW EXECUTE FUNCTION public.audit_sale_reversal();
-- ===== 20260906223123_39a87e9b-5acb-432d-9883-6aab3976cf83.sql =====
CREATE OR REPLACE FUNCTION public.delete_reversed_sale(_sale_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale public.sales%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can permanently delete reversed sales';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = _sale_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF v_sale.reversed_at IS NULL THEN
    RAISE EXCEPTION 'Only reversed sales can be permanently deleted';
  END IF;

  INSERT INTO public.audit_log (table_name, record_id, action, field, old_value, new_value, context, user_id)
  VALUES ('sales', _sale_id, 'delete', 'reversed_sale',
    format('%s L / KES %s (%s)', v_sale.litres, v_sale.total_amount, v_sale.payment_method), NULL,
    jsonb_build_object('branch_id', v_sale.branch_id, 'fuel_type_id', v_sale.fuel_type_id, 'sold_at', v_sale.created_at),
    auth.uid());

  DELETE FROM public.mpesa_transactions WHERE sale_id = _sale_id;
  DELETE FROM public.reconciliation_reviews WHERE sale_id = _sale_id;
  DELETE FROM public.sale_reversals WHERE sale_id = _sale_id;
  DELETE FROM public.sales WHERE id = _sale_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_reversed_sale(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_reversed_sale(uuid) TO authenticated;
-- ===== 20261029000000_realtime_for_app_tables.sql =====
-- Tables the app listens to with Supabase Realtime (Dashboard + live permission refresh).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sales', 'user_roles', 'user_page_permissions'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

