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