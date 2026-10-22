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

Credentials, dependencies, compiled builds, and archive backups are excluded from version control.
