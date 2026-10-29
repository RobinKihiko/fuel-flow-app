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