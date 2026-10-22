/*
  Store player stats separately per environment.

  The original schema made player_stats.player_id unique, which means one row
  had to hold both dev and prod results. The app now records stats by
  environment, so the uniqueness must be player + environment instead.
*/

ALTER TABLE player_stats
  DROP CONSTRAINT IF EXISTS player_stats_player_id_key;

ALTER TABLE player_stats
  ADD CONSTRAINT player_stats_player_environment_key
  UNIQUE (player_id, environment);
