import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    if (Number(req.headers.get("content-length") || 0) > 8192) return json({ error: "Message is too long." }, 413);
    const raw = await req.text();
    if (raw.length > 8192) return json({ error: "Message is too long." }, 413);
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (body.action !== "contact_us" && body.action !== "account_created") {
      return json({ error: "Unknown notification action" }, 400);
    }
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const email = field(body.email, 254).toLowerCase();
    const fullName = field(body.full_name, 100);
    const phone = field(body.phone, 30);
    if (!fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: "Enter a valid name and email address." }, 400);
    }

    if (body.action === "account_created") {
      // The public signup notification must be tied to the new user's session.
      const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
      if (!token) return json({ error: "Not authorized" }, 401);
      const { data, error } = await adminClient.auth.getUser(token);
      if (error || data.user?.email?.toLowerCase() !== email) return json({ error: "Not authorized" }, 401);
    }

    let contactId: string | null = null;
    let message = "";
    if (body.action === "contact_us") {
      if (field(body.website, 100)) return json({ success: true }); // Honeypot.
      message = field(body.message, 4000);
      if (message.length < 10) return json({ error: "Please enter at least 10 characters." }, 400);

      const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
      if (secret) {
        if (typeof body.captcha_token !== "string" || !body.captcha_token) {
          return json({ error: "Complete the verification before sending." }, 400);
        }
        const form = new FormData();
        form.set("secret", secret);
        form.set("response", body.captcha_token);
        const ip = requestIp(req);
        if (ip) form.set("remoteip", ip);
        const verification = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
        const result = await verification.json();
        if (!verification.ok || !result.success) return json({ error: "Verification expired or failed. Please try again." }, 400);
      }

      const fingerprint = await hash(`${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}:${requestIp(req) || "unknown"}`);
      const { data: allowed, error: limitError } = await adminClient.rpc("reserve_contact_request", { p_fingerprint: fingerprint });
      if (limitError) {
        console.error("Contact rate limit unavailable", limitError.message);
        return json({ error: "Contact form is temporarily unavailable. Please try later." }, 503);
      }
      if (!allowed) return json({ error: "Too many messages. Please try again next hour." }, 429);
      const { data: saved, error: saveError } = await adminClient.from("contact_requests")
        .insert({ full_name: fullName, email, phone, message }).select("id").single();
      if (saveError) {
        console.error("Contact save failed", saveError.message);
        return json({ error: "Could not receive your message. Please try later." }, 503);
      }
      contactId = saved.id;
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("NOTIFICATION_FROM_EMAIL");
    let emailStatus: "sent" | "failed" = "failed";
    try {
    if (resendApiKey && fromEmail) {
      const { data: superAdmins } = await adminClient.from("profiles").select("id").eq("role", "super_admin");
      const recipients: string[] = [];
      for (const profile of superAdmins || []) {
        const { data } = await adminClient.auth.admin.getUserById(profile.id);
        if (data.user?.email) recipients.push(data.user.email);
      }
      if (recipients.length) {
        const html = body.action === "contact_us"
          ? contactHtml({ full_name: fullName, email, phone, message })
          : accountCreatedHtml({ full_name: fullName, email, phone });
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: fromEmail, to: recipients,
            subject: body.action === "contact_us" ? "Rally Master: Contact request" : "Rally Master: New account created",
            html, reply_to: email,
          }),
        });
        emailStatus = response.ok ? "sent" : "failed";
        if (!response.ok) console.error("Notification email failed", response.status, await response.text());
      } else console.error("Notification email failed: no Super Admin recipient");
    } else console.error("Notification email failed: Resend configuration is missing");
    } catch (error) {
      console.error("Notification email failed unexpectedly", error);
    }

    if (contactId) await adminClient.from("contact_requests").update({ email_status: emailStatus }).eq("id", contactId);
    return json({ success: true, email_status: emailStatus });
  } catch (error) {
    console.error("notify-super-admin failed", error);
    return json({ error: "Contact form is temporarily unavailable. Please try later." }, 500);
  }
});

function field(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}
function requestIp(req: Request) {
  return req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "";
}
async function hash(value: string) {
  const bytes = new TextEncoder().encode(value);
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function accountCreatedHtml(body: Record<string, string>) {
  return `<h2>New Rally Master account created</h2><p><strong>Name:</strong> ${escapeHtml(body.full_name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(body.email)}</p><p><strong>Phone:</strong> ${escapeHtml(body.phone || "Not provided")}</p>`;
}
function contactHtml(body: Record<string, string>) {
  return `<h2>Rally Master contact request</h2><p><strong>Name:</strong> ${escapeHtml(body.full_name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(body.email)}</p><p><strong>Phone:</strong> ${escapeHtml(body.phone || "Not provided")}</p>
    <p><strong>Message:</strong></p><p>${escapeHtml(body.message).replace(/\n/g, "<br />")}</p>`;
}
function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
