import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const HTML = (title: string, message: string, color: string) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #f8fafc;
      padding: 24px;
    }
    .card {
      background: white;
      border-radius: 20px;
      padding: 40px 32px;
      max-width: 380px;
      width: 100%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .icon {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0 auto 20px;
      font-size: 32px;
      background: ${color === 'green' ? '#d1fae5' : color === 'red' ? '#fee2e2' : '#f3f4f6'};
    }
    h1 { font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    p { font-size: 15px; color: #6b7280; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${color === 'green' ? '✅' : color === 'red' ? '❌' : 'ℹ️'}</div>
    <h1>${title}</h1>
    <p>${message}</p>
  </div>
</body>
</html>`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const response = url.searchParams.get("r"); // 'yes' or 'no'

    if (!token || !response || (response !== "yes" && response !== "no")) {
      return new Response(
        HTML("Invalid Link", "This availability link is invalid or incomplete.", "gray"),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "text/html" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up the token
    const { data: pollToken, error: lookupError } = await supabase
      .from("availability_poll_tokens")
      .select("id, session_id, player_id, used, response")
      .eq("token", token)
      .maybeSingle();

    if (lookupError || !pollToken) {
      return new Response(
        HTML("Link Not Found", "This availability link is invalid or has expired.", "gray"),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "text/html" } }
      );
    }

    if (pollToken.used) {
      const prev = pollToken.response === "yes" ? "available" : "unavailable";
      return new Response(
        HTML("Already Responded", `You already marked yourself as ${prev} for this session.`, "gray"),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html" } }
      );
    }

    // Mark token as used
    await supabase
      .from("availability_poll_tokens")
      .update({ used: true, response, responded_at: new Date().toISOString() })
      .eq("id", pollToken.id);

    const available = response === "yes";

    // Upsert session availability
    await supabase
      .from("session_availability")
      .upsert(
        {
          session_id: pollToken.session_id,
          player_id: pollToken.player_id,
          available,
          responded_at: new Date().toISOString(),
        },
        { onConflict: "session_id,player_id" }
      );

    const title = available ? "You're In!" : "Got It";
    const message = available
      ? "You've been marked as available for the session. See you on the court!"
      : "You've been marked as unavailable. No worries, see you next time!";

    return new Response(
      HTML(title, message, available ? "green" : "red"),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "text/html" } }
    );
  } catch (err) {
    console.error(err);
    return new Response(
      HTML("Something Went Wrong", "An unexpected error occurred. Please try again.", "gray"),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "text/html" } }
    );
  }
});
