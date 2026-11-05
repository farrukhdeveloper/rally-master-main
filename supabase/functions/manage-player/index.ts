import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    // Verify caller is an authenticated admin
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user: caller }, error: authError } = await callerClient.auth.getUser();
    if (authError || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: callerProfile } = await callerClient
      .from("profiles")
      .select("role")
      .eq("id", caller.id)
      .maybeSingle();

    if (!["admin", "super_admin"].includes(callerProfile?.role || "")) {
      return new Response(JSON.stringify({ error: "Forbidden: admin only" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for privileged operations
    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const { action, player_id, email } = body;

    if (action === "create_player") {
      const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
      const playerEmail = typeof email === "string" ? email.trim() : "";
      const password = typeof body.password === "string" ? body.password : "";
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const skillLevel = body.skill_level;
      const role = body.role;
      const environment = body.environment;
      const groupIds = body.group_ids;

      if (!fullName || fullName.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(playerEmail)
          || password.length < 8 || phone.length > 30
          || !/^level_[1-9]$/.test(skillLevel)
          || !["player", "admin"].includes(role)
          || !["prod", "dev"].includes(environment)
          || !Array.isArray(groupIds)
          || groupIds.length > 30
          || groupIds.some((id: unknown) => typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id))
          || new Set(groupIds).size !== groupIds.length) {
        return new Response(JSON.stringify({ error: "Check the player details, password, and groups" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (role === "admin" && callerProfile?.role !== "super_admin") {
        return new Response(JSON.stringify({ error: "Only SuperAdmin can create admins" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (groupIds.length > 0) {
        const { data: groups, error: groupsError } = await adminClient
          .from("groups").select("id, environment, created_by").in("id", groupIds);
        if (groupsError) throw groupsError;
        if (groups?.length !== groupIds.length || groups.some((group) =>
          group.environment !== environment ||
          (callerProfile?.role !== "super_admin" && group.created_by !== caller.id))) {
          return new Response(JSON.stringify({ error: "One or more groups cannot be assigned" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: playerEmail,
        password,
        email_confirm: true,
      });
      if (createError) throw createError;
      if (!created.user) throw new Error("Player account could not be created");

      try {
        const { error: profileError } = await adminClient.from("profiles").insert({
          id: created.user.id,
          full_name: fullName,
          skill_level: skillLevel,
          phone,
          role,
          environment,
        });
        if (profileError) throw profileError;

        if (groupIds.length > 0) {
          const { error: membershipError } = await adminClient.from("player_groups").insert(
            groupIds.map((groupId: string) => ({ group_id: groupId, player_id: created.user.id, role: "member" }))
          );
          if (membershipError) throw membershipError;
        }
      } catch (error) {
        await adminClient.auth.admin.deleteUser(created.user.id);
        throw error;
      }

      return new Response(JSON.stringify({ success: true, player_id: created.user.id }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!player_id) {
      return new Response(JSON.stringify({ error: "player_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Prevent admin from deleting themselves
    if (action === "delete" && player_id === caller.id) {
      return new Response(JSON.stringify({ error: "Cannot delete your own account" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "delete") {
      // Deleting auth user cascades to profiles (profiles.id FK → auth.users.id ON DELETE CASCADE)
      // FK fixes in migration ensure match_team_players CASCADE, matches/sessions SET NULL
      const { error } = await adminClient.auth.admin.deleteUser(player_id);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "update_email") {
      if (callerProfile?.role !== "super_admin") {
        return new Response(JSON.stringify({ error: "Forbidden: SuperAdmin only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!email || !email.includes("@")) {
        return new Response(JSON.stringify({ error: "Valid email required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { error } = await adminClient.auth.admin.updateUserById(player_id, { email });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "get_email") {
      if (callerProfile?.role !== "super_admin") {
        return new Response(JSON.stringify({ error: "Forbidden: SuperAdmin only" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const { data, error } = await adminClient.auth.admin.getUserById(player_id);
      if (error) throw error;
      return new Response(JSON.stringify({ email: data.user?.email || "" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "send_password_reset") {
      const { data, error: userError } = await adminClient.auth.admin.getUserById(player_id);
      if (userError) throw userError;
      const targetEmail = data.user?.email;
      if (!targetEmail) {
        return new Response(JSON.stringify({ error: "Player email not found" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const redirectTo = typeof body.redirectTo === "string" ? body.redirectTo : undefined;
      const { error } = await adminClient.auth.resetPasswordForEmail(targetEmail, { redirectTo });
      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
