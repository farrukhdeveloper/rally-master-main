import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Isolated client for admin-side user creation - has its own auth storage
// so signUp() here does NOT affect the main session.
export const supabaseAdmin = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { storageKey: 'sb-admin-create-user', persistSession: false },
});

export type SkillLevel =
  | 'level_1'
  | 'level_2'
  | 'level_3'
  | 'level_4'
  | 'level_5'
  | 'level_6'
  | 'level_7'
  | 'level_8'
  | 'level_9';
export type UserRole = 'player' | 'admin' | 'super_admin';
export type Environment = 'dev' | 'prod';
export type SessionStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';
export type CourtStatus = 'available' | 'in_use' | 'maintenance';
export type MatchStatus = 'active' | 'completed' | 'abandoned';
export type TeamLabel = 'A' | 'B';
export type InviteStatus = 'pending' | 'accepted' | 'declined';
export type InviteKind = 'invite' | 'request';

export interface Profile {
  id: string;
  full_name: string;
  skill_level: SkillLevel;
  role: UserRole;
  phone: string;
  avatar_url: string;
  environment: Environment;
  last_login_at?: string | null;
  created_at: string;
}

export interface UserLoginEvent {
  id: string;
  user_id: string;
  logged_in_at: string;
  user_agent: string | null;
  created_at: string;
  profile?: Profile;
}

export interface Group {
  id: string;
  name: string;
  description: string | null;
  environment: Environment;
  created_by: string | null;
  created_by_profile?: Profile | null;
  created_at: string;
}

export interface PlayerGroup {
  id: string;
  group_id: string;
  player_id: string;
  role: 'member' | 'organiser';
  created_at: string;
  group?: Group;
  profile?: Profile;
}

export interface SessionInvite {
  id: string;
  session_id: string;
  player_id: string;
  invited_by: string;
  status: InviteStatus;
  kind?: InviteKind;
  created_at: string;
  session?: Session;
  profile?: Profile;
  invited_by_profile?: Profile;
}

export interface PlayerMatchHistory {
  player_id: string;
  match_id: string;
  session_id: string;
  session_title: string;
  session_date: string;
  venue: string;
  environment: Environment;
  session_type?: 'standard' | 'group_challenge' | 'tournament';
  counts_for_rankings?: boolean;
  competition_id?: string | null;
  competition_title?: string | null;
  organiser_name: string;
  organiser_id: string;
  my_team: TeamLabel;
  winner_team: TeamLabel | null;
  score_a: number;
  score_b: number;
  match_status: MatchStatus;
  started_at: string;
  ended_at: string | null;
  result: 'win' | 'loss' | 'draw';
}

export interface Session {
  id: string;
  title: string;
  session_date: string;
  start_time: string;
  end_time: string;
  venue: string;
  status: SessionStatus;
  created_by: string;
  environment: Environment;
  group_id: string | null;
  session_type?: 'standard' | 'group_challenge' | 'tournament';
  counts_for_rankings?: boolean;
  created_at: string;
  group?: Group | null;
}

export type CompetitionStatus = 'draft' | 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type FixtureStatus = 'scheduled' | 'completed';

export interface Competition {
  id: string;
  competition_type: 'group_challenge' | 'tournament';
  title: string;
  environment: Environment;
  event_date: string;
  start_time: string;
  venue: string;
  court_count: number;
  fixture_minutes: number;
  status: CompetitionStatus;
  counts_for_rankings: boolean;
  session_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CompetitionGroup {
  id: string;
  competition_id: string;
  group_id: string;
  side: TeamLabel;
  group?: Group;
}

export interface CompetitionRoster {
  id: string;
  competition_id: string;
  competition_group_id: string;
  player_id: string;
  seed_number: number;
  profile?: Profile;
}

export interface CompetitionFixturePlayer {
  id: string;
  fixture_id: string;
  side: TeamLabel;
  player_id: string;
  seed_number: number;
  team_position: 1 | 2;
  profile?: Profile;
}

export interface CompetitionFixture {
  id: string;
  competition_id: string;
  round_number: number;
  wave_number: number;
  court_number: number;
  scheduled_at: string;
  status: FixtureStatus;
  score_a: number | null;
  score_b: number | null;
  winner_side: TeamLabel | null;
  match_id: string | null;
  recorded_by: string | null;
  completed_at: string | null;
  is_extra: boolean;
  players?: CompetitionFixturePlayer[];
}

export interface SessionAvailability {
  id: string;
  session_id: string;
  player_id: string;
  available: boolean;
  responded_at: string;
  profile?: Profile;
}

export interface Court {
  id: string;
  session_id: string;
  name: string;
  status: CourtStatus;
  created_at: string;
}

export interface Match {
  id: string;
  session_id: string;
  court_id: string;
  status: MatchStatus;
  winner_team: TeamLabel | null;
  score_a: number;
  score_b: number;
  started_at: string;
  ended_at: string | null;
  created_by: string;
  court?: Court;
  teams?: MatchTeamWithPlayers[];
}

export interface MatchTeam {
  id: string;
  match_id: string;
  team_label: TeamLabel;
  team_name: string;
}

export interface MatchTeamPlayer {
  id: string;
  match_team_id: string;
  player_id: string;
  profile?: Profile;
}

export interface MatchTeamWithPlayers extends MatchTeam {
  players: (MatchTeamPlayer & { profile: Profile })[];
}

export interface PlayerStats {
  id: string;
  player_id: string;
  wins: number;
  losses: number;
  total_matches: number;
  updated_at: string;
  profile?: Profile;
}


