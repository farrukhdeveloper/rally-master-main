import type { Profile, SkillLevel } from './supabase';
import { SKILL_LEVELS, normalizeSkillLevel, skillLevelLabel } from './skillLevels';

const LEVEL_RANGES: Record<SkillLevel, { min: number; max: number }> = {
  level_1: { min: 800, max: 999 },
  level_2: { min: 1000, max: 1199 },
  level_3: { min: 1200, max: 1399 },
  level_4: { min: 1400, max: 1549 },
  level_5: { min: 1550, max: 1699 },
  level_6: { min: 1700, max: 1849 },
  level_7: { min: 1850, max: 1999 },
  level_8: { min: 2000, max: 2149 },
  level_9: { min: 2150, max: 2300 },
};

const MIN_MATCHES_FOR_REVIEW = 8;

type TeamRow = {
  team_label: 'A' | 'B';
  players?: Array<{ player_id: string; profile?: Profile }>;
};

type CompletedMatchRow = {
  winner_team?: 'A' | 'B' | null;
  score_a?: number | null;
  score_b?: number | null;
  started_at?: string | null;
  ended_at?: string | null;
  teams?: TeamRow[];
};

export interface RatingSummary {
  rating: number;
  currentLevel: SkillLevel;
  ratingLevel: SkillLevel;
  nextLevel: SkillLevel | null;
  progressPercent: number;
  reviewLevel: SkillLevel | null;
  reviewLabel: string | null;
}

export function baseRatingForSkill(value?: string | null) {
  const level = normalizeSkillLevel(value);
  const range = LEVEL_RANGES[level];
  return Math.round((range.min + range.max) / 2);
}

export function skillLevelFromRating(rating: number): SkillLevel {
  for (const level of SKILL_LEVELS) {
    const range = LEVEL_RANGES[level];
    if (rating >= range.min && rating <= range.max) return level;
  }
  return rating < LEVEL_RANGES.level_1.min ? 'level_1' : 'level_9';
}

export function calculatePlayerRatingsFromMatches(matches: CompletedMatchRow[]) {
  const ratings = new Map<string, number>();
  const profiles = new Map<string, Profile>();

  const ordered = [...matches].sort((a, b) =>
    new Date(a.ended_at || a.started_at || 0).getTime() - new Date(b.ended_at || b.started_at || 0).getTime()
  );

  for (const match of ordered) {
    const teamA = match.teams?.find((team) => team.team_label === 'A');
    const teamB = match.teams?.find((team) => team.team_label === 'B');
    const aPlayers = (teamA?.players || []).filter((player) => player.player_id && player.profile);
    const bPlayers = (teamB?.players || []).filter((player) => player.player_id && player.profile);
    if (!match.winner_team || aPlayers.length === 0 || bPlayers.length === 0) continue;

    for (const player of [...aPlayers, ...bPlayers]) {
      if (!player.profile) continue;
      profiles.set(player.player_id, player.profile);
      if (!ratings.has(player.player_id)) ratings.set(player.player_id, baseRatingForSkill(player.profile.skill_level));
    }

    const aRating = average(aPlayers.map((player) => ratings.get(player.player_id) || baseRatingForSkill(player.profile?.skill_level)));
    const bRating = average(bPlayers.map((player) => ratings.get(player.player_id) || baseRatingForSkill(player.profile?.skill_level)));
    const expectedA = 1 / (1 + Math.pow(10, (bRating - aRating) / 400));
    const actualA = match.winner_team === 'A' ? 1 : 0;
    const scoreA = Number(match.score_a || 0);
    const scoreB = Number(match.score_b || 0);
    const margin = scoreA > 0 || scoreB > 0 ? Math.abs(scoreA - scoreB) : 0;
    const scoreFactor = 0.85 + Math.min(0.35, margin / 30);
    const deltaA = Math.round(24 * scoreFactor * (actualA - expectedA));

    for (const player of aPlayers) ratings.set(player.player_id, (ratings.get(player.player_id) || baseRatingForSkill(player.profile?.skill_level)) + deltaA);
    for (const player of bPlayers) ratings.set(player.player_id, (ratings.get(player.player_id) || baseRatingForSkill(player.profile?.skill_level)) - deltaA);
  }

  for (const [playerId, profile] of profiles) {
    if (!ratings.has(playerId)) ratings.set(playerId, baseRatingForSkill(profile.skill_level));
  }

  return ratings;
}

export function buildRatingSummary(profile: Profile, totalMatches: number, rating?: number): RatingSummary {
  const currentLevel = normalizeSkillLevel(profile.skill_level);
  const resolvedRating = Math.round(rating ?? baseRatingForSkill(currentLevel));
  const ratingLevel = skillLevelFromRating(resolvedRating);
  const currentRange = LEVEL_RANGES[currentLevel];
  const currentIndex = SKILL_LEVELS.indexOf(currentLevel);
  const nextLevel = currentIndex < SKILL_LEVELS.length - 1 ? SKILL_LEVELS[currentIndex + 1] : null;
  const progressPercent = currentLevel === 'level_9'
    ? 100
    : clamp(Math.round(((resolvedRating - currentRange.min) / (currentRange.max - currentRange.min)) * 100), 0, 100);

  const reviewLevel = totalMatches >= MIN_MATCHES_FOR_REVIEW && ratingLevel !== currentLevel ? ratingLevel : null;

  return {
    rating: resolvedRating,
    currentLevel,
    ratingLevel,
    nextLevel,
    progressPercent,
    reviewLevel,
    reviewLabel: reviewLevel ? `Review ${skillLevelLabel(reviewLevel)}` : null,
  };
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
