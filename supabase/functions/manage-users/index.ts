import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Verify caller is admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const token = authHeader.replace("Bearer ", "");
    const { data: { user: caller } } = await adminClient.auth.getUser(token);
    if (!caller) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: callerRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!callerRole) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers: corsHeaders });
    }

    const url = new URL(req.url);
    const action = url.searchParams.get("action");

    if (req.method === "GET" && action === "list") {
      const { data: { users }, error } = await adminClient.auth.admin.listUsers({ perPage: 100 });
      if (error) throw error;

      const { data: profiles } = await adminClient.from("profiles").select("*");
      const { data: roles } = await adminClient.from("user_roles").select("*");
      const { data: assignments } = await adminClient.from("branch_attendants").select("user_id, branch_id, branches(name)");

      const enriched = users.map((u) => {
        const profile = profiles?.find((p) => p.user_id === u.id);
        const userRoles = roles?.filter((r) => r.user_id === u.id).map((r) => r.role) ?? [];
        const userBranches = assignments?.filter((a: any) => a.user_id === u.id).map((a: any) => ({ id: a.branch_id, name: a.branches?.name })) ?? [];
        return {
          id: u.id,
          email: u.email,
          full_name: profile?.full_name || "",
          phone: profile?.phone || "",
          id_number: profile?.id_number || "",
          roles: userRoles,
          branches: userBranches,
          created_at: u.created_at,
        };
      });

      return new Response(JSON.stringify(enriched), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST" && action === "create-user") {
      const { email, phone, id_number, full_name, branch_id } = await req.json();
      if (!email || !id_number) {
        return new Response(JSON.stringify({ error: "Email and ID number are required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (String(id_number).length < 6) {
        return new Response(JSON.stringify({ error: "ID number must be at least 6 characters (used as password)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      // Create the auth user (auto-confirmed so they can log in immediately)
      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password: String(id_number),
        email_confirm: true,
        user_metadata: { full_name: full_name || "" },
      });
      if (createErr) throw createErr;
      const newUserId = created.user!.id;

      // Update profile (handle_new_user trigger creates a row already)
      await adminClient.from("profiles").update({
        phone: phone || null,
        id_number: String(id_number),
        full_name: full_name || "",
        must_change_password: true,
        id_number_used_as_password: true,
      }).eq("user_id", newUserId);

      // Ensure attendant role (trigger sets it by default but make sure)
      await adminClient.from("user_roles").upsert({ user_id: newUserId, role: "attendant" }, { onConflict: "user_id,role" });

      // Optional branch assignment
      if (branch_id) {
        await adminClient.from("branch_attendants").insert({ user_id: newUserId, branch_id });
      }

      return new Response(JSON.stringify({ success: true, user_id: newUserId }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST" && action === "update-role") {
      const { user_id, role, operation } = await req.json();
      if (!user_id || !role) throw new Error("user_id and role required");

      if (operation === "remove") {
        const { error } = await adminClient
          .from("user_roles")
          .delete()
          .eq("user_id", user_id)
          .eq("role", role);
        if (error) throw error;
      } else {
        const { error } = await adminClient
          .from("user_roles")
          .upsert({ user_id, role }, { onConflict: "user_id,role" });
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST" && action === "assign-branch") {
      const { user_id, branch_id, operation } = await req.json();
      if (!user_id || !branch_id) throw new Error("user_id and branch_id required");

      if (operation === "remove") {
        const { error } = await adminClient
          .from("branch_attendants")
          .delete()
          .eq("user_id", user_id)
          .eq("branch_id", branch_id);
        if (error) throw error;
      } else {
        const { error } = await adminClient
          .from("branch_attendants")
          .insert({ user_id, branch_id });
        if (error) throw error;
      }

      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (req.method === "POST" && action === "delete-user") {
      const { user_id } = await req.json();
      if (!user_id) throw new Error("user_id required");
      if (user_id === caller.id) {
        return new Response(JSON.stringify({ error: "You cannot delete your own account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { error } = await adminClient.auth.admin.deleteUser(user_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: corsHeaders });
  } catch (error) {
    console.error("manage-users error:", error);
    return new Response(JSON.stringify({ error: "Something went wrong" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
