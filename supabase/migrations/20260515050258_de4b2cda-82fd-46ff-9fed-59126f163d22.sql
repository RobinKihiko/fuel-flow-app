ALTER TABLE public.branch_fuel_types ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 16;
ALTER TABLE public.fuel_types ADD COLUMN IF NOT EXISTS vat_rate numeric NOT NULL DEFAULT 16;