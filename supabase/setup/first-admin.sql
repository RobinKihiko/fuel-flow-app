-- Run this ONCE in Supabase -> SQL Editor, after the migrations.
--
-- Before running:
--   1. Supabase Dashboard -> Authentication -> Users -> Add user -> Create new user
--      (enter your email + password and tick "Auto Confirm User").
--   2. Replace the email below with that same email.

INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'
FROM auth.users
WHERE email = 'you@example.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Check: should return one row with role = admin
SELECT u.email, r.role
FROM public.user_roles r
JOIN auth.users u ON u.id = r.user_id
WHERE r.role = 'admin';
