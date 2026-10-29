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