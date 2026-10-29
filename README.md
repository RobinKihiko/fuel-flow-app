# Fuel Flow Pro

Petrol station management system: sales, pumps, tanks, fuel stock, expenses, payroll, reconciliation and reports, with multiple branches and roles (admin, manager, attendant).

**Stack:** Vite + React + TypeScript + Tailwind + shadcn/ui, Supabase (Postgres, Auth, Realtime, Edge Functions), deployed on Cloudflare Workers (static assets).

## Local development

```bash
cp .env.example .env.local   # then fill in your Supabase URL and anon key
bun install
bun run dev                  # http://localhost:8080
```

## Supabase setup (once)

1. Create a project at https://supabase.com/dashboard.
2. Apply the database schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref YOUR-PROJECT-REF
   npx supabase db push
   ```
   (No CLI? Paste `supabase/setup/all-migrations.sql` into the SQL Editor and run it.)
3. Deploy the user-management function:
   ```bash
   npx supabase functions deploy manage-users
   ```
4. Create your admin: Authentication -> Users -> Add user (tick Auto Confirm), then run `supabase/setup/first-admin.sql` in the SQL Editor with your email.
5. Authentication -> Sign In / Providers: turn **off** "Allow new users to sign up". Staff accounts are created by an admin from the Users page.

## Deploy to Cloudflare

Build command `bun run build`, deploy command `npx wrangler deploy` (config in `wrangler.json`).
Add these under **Settings -> Build -> Variables and secrets** (they must be build variables, because Vite bakes them in at build time):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Never put the Supabase `service_role` key in the frontend or in Cloudflare build variables.
