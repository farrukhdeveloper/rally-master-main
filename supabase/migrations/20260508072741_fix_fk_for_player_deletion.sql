/*
  # Fix foreign key constraints to allow player deletion

  ## Problem
  Three foreign keys use NO ACTION, which prevents deleting a player if they:
  - Have match_team_players rows (blocks profile delete)
  - Created matches (created_by is NO ACTION)
  - Created sessions (created_by is NO ACTION)

  ## Changes
  - match_team_players.player_id → profiles: change to CASCADE (remove player from teams when deleted)
  - matches.created_by → profiles: change to SET NULL (keep match history, nullify creator ref)
  - sessions.created_by → profiles: change to SET NULL (keep session history, nullify creator ref)

  These changes preserve match and session history while allowing a player to be
  fully removed from the system.
*/

-- match_team_players: cascade so player is removed from any team compositions
ALTER TABLE match_team_players
  DROP CONSTRAINT match_team_players_player_id_fkey;

ALTER TABLE match_team_players
  ADD CONSTRAINT match_team_players_player_id_fkey
  FOREIGN KEY (player_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- matches: set null so match records are kept but creator reference is cleared
ALTER TABLE matches
  DROP CONSTRAINT matches_created_by_fkey;

ALTER TABLE matches
  ADD CONSTRAINT matches_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;

-- sessions: set null so session records are kept but creator reference is cleared
ALTER TABLE sessions
  DROP CONSTRAINT sessions_created_by_fkey;

ALTER TABLE sessions
  ADD CONSTRAINT sessions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE SET NULL;
