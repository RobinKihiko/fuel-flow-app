
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
