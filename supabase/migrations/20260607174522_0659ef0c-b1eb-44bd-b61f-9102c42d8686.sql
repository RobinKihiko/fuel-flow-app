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