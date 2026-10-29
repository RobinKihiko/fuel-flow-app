-- Per-branch M-Pesa credentials (used by the Branches page).
-- Created late so it can use can_access_branch() (defined in 20260621201521).
CREATE TABLE IF NOT EXISTS public.branch_mpesa_credentials (
  branch_id uuid PRIMARY KEY REFERENCES public.branches(id) ON DELETE CASCADE,
  mpesa_shortcode text,
  mpesa_consumer_key text,
  mpesa_consumer_secret text,
  mpesa_passkey text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.branch_mpesa_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage branch mpesa credentials"
  ON public.branch_mpesa_credentials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers manage own branch mpesa credentials"
  ON public.branch_mpesa_credentials FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'manager') AND public.can_access_branch(auth.uid(), branch_id))
  WITH CHECK (public.has_role(auth.uid(), 'manager') AND public.can_access_branch(auth.uid(), branch_id));

CREATE TRIGGER trg_branch_mpesa_credentials_updated_at
  BEFORE UPDATE ON public.branch_mpesa_credentials
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
