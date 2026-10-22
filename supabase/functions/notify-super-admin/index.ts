import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

type NotifyAction = "account_created" | "contact_us";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const body = await req.json();
    const action = body.action as NotifyAction;

    if (!["account_created", "contact_us"].includes(action)) {
      return json({ error: "Unknown notification action" }, 400);
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("NOTIFICATION_FROM_EMAIL");
    if (!resendApiKey || !fromEmail) {
      return json({
        error: "Email is not configured. Add RESEND_API_KEY and NOTIFICATION_FROM_EMAIL in Supabase secrets.",
      }, 500);
    }

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: superAdmins } = await adminClient
      .from("profiles")
      .select("id, full_name")
      .eq("role", "super_admin");

    const recipients: string[] = [];
    for (const profile of superAdmins || []) {
      const { data } = await adminClient.auth.admin.getUserById(profile.id);
      if (data.user?.email) recipients.push(data.user.email);
    }

    if (recipients.length === 0) {
      return json({ error: "No Super Admin email found." }, 500);
    }

    const subject = action === "account_created"
      ? "Rally Master: New account created"
      : "Rally Master: Contact request";

    const html = action === "account_created"
      ? accountCreatedHtml(body)
      : contactHtml(body);

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: recipients,
        subject,
        html,
        reply_to: body.email || undefined,
      }),
    });

    if (!resendRes.ok) {
      const detail = await resendRes.text();
      return json({ error: `Email failed: ${detail}` }, 500);
    }

    return json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unexpected error";
    return json({ error: message }, 500);
  }
});

function accountCreatedHtml(body: Record<string, string>) {
  return `
    <h2>New Rally Master account created</h2>
    <p><strong>Name:</strong> ${escapeHtml(body.full_name || "Not provided")}</p>
    <p><strong>Email:</strong> ${escapeHtml(body.email || "Not provided")}</p>
    <p><strong>Phone:</strong> ${escapeHtml(body.phone || "Not provided")}</p>
  `;
}

function contactHtml(body: Record<string, string>) {
  return `
    <h2>Rally Master contact request</h2>
    <p><strong>Name:</strong> ${escapeHtml(body.full_name || "Not provided")}</p>
    <p><strong>Email:</strong> ${escapeHtml(body.email || "Not provided")}</p>
    <p><strong>Phone:</strong> ${escapeHtml(body.phone || "Not provided")}</p>
    <p><strong>Message:</strong></p>
    <p>${escapeHtml(body.message || "No message").replace(/\n/g, "<br />")}</p>
  `;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
