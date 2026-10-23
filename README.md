# Rally Master

Badminton session and match management built with React, TypeScript, Vite, Tailwind CSS, and Supabase.

Includes court queues, player rotation, rankings, seeded group challenges, extra challenge matches, and organiser/super-admin challenge deletion.

## Local development

1. Install Node.js and run `npm install`.
2. Copy `.env.example` to `.env` and supply the existing Supabase project's URL and public anon key.
3. Run `npm run dev`.

Validation: `npm run typecheck` and `npm run build`.

## Bolt

Import this GitHub repository from the Bolt homepage. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for the existing Supabase project. Preview the app, then use Publish to deploy it. Future repository changes sync into Bolt; use Publish > Update to update the live site.

## Database

SQL migrations are under `supabase/migrations`. Use the existing Supabase database when continuing an existing deployment. Check its applied migration history before applying pending migrations; importing source code does not execute these SQL files.

The recent challenge features use:

- `20260823120000_seeded_group_challenges.sql`
- `20260823143000_extra_challenge_fixtures.sql`
- `20260823150000_challenge_delete_cleanup.sql`

Supabase Edge Function source is under `supabase/functions`. Deploy and configure those functions separately where needed.

## Public-form protection

1. Apply `supabase/migrations/20261023160000_contact_abuse_protection.sql` to the existing project. It stores contact requests, limits them to three per hour per visitor, and prevents players from changing protected profile fields through the API. Admins can read requests under **Admin Panel → Contact Requests** even if email delivery fails.
2. Deploy the updated `notify-super-admin` Edge Function. It records contact requests before attempting email delivery and logs the provider's response when sending fails. Keep `RESEND_API_KEY` and `NOTIFICATION_FROM_EMAIL` in Supabase Edge Function secrets; never add them to Bolt or GitHub.
3. Create a Cloudflare Turnstile widget for `rally-master.bolt.host`. Add its public site key as `VITE_TURNSTILE_SITE_KEY` in Bolt's project environment. Add its secret key as `TURNSTILE_SECRET_KEY` in Supabase Edge Function secrets. The public site key may be committed; the secret key must stay server-side. For Bolt Preview, also authorize its preview hostname in the widget or use Cloudflare's test keys in an isolated test environment.
4. Once the site key is available in the app, enable **Turnstile CAPTCHA** under Supabase **Authentication → Bot and Abuse Protection** with the same secret key. Enable this last so login and signup remain usable during setup. Republish the app afterward.

Supabase Auth's own [rate limits](https://supabase.com/docs/guides/auth/rate-limits) also apply to signup, sign-in, and password reset. The contact form uses a server-side limit because it is a separate public Edge Function.

Credentials, dependencies, compiled builds, and archive backups are excluded from version control.
