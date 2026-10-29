
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
