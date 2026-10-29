
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
