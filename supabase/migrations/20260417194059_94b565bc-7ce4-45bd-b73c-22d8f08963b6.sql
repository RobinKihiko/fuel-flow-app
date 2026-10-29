-- Add id_number to profiles for attendant credentials
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS id_number text;
CREATE INDEX IF NOT EXISTS idx_profiles_id_number ON public.profiles(id_number);