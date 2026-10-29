REVOKE ALL ON FUNCTION public.recalc_daily_fuel_stock(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_fuel_topup_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_daily_stock_after_topup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revert_fuel_topup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.audit_fuel_topups() FROM PUBLIC, anon, authenticated;