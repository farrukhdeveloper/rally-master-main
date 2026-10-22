import type { SkillLevel } from './supabase';

export const SKILL_LEVELS: SkillLevel[] = [
  'level_1',
  'level_2',
  'level_3',
  'level_4',
  'level_5',
  'level_6',
  'level_7',
  'level_8',
  'level_9',
];

export const SKILL_LEVEL_LABELS: Record<SkillLevel, string> = {
  level_1: 'Level 1',
  level_2: 'Level 2',
  level_3: 'Level 3',
  level_4: 'Level 4',
  level_5: 'Level 5',
  level_6: 'Level 6',
  level_7: 'Level 7',
  level_8: 'Level 8',
  level_9: 'Level 9',
};

export const SKILL_LEVEL_COLORS: Record<SkillLevel, string> = {
  level_1: 'bg-slate-50 text-slate-600 border-slate-200',
  level_2: 'bg-sky-50 text-sky-600 border-sky-200',
  level_3: 'bg-cyan-50 text-cyan-600 border-cyan-200',
  level_4: 'bg-lime-50 text-lime-700 border-lime-200',
  level_5: 'bg-amber-50 text-amber-600 border-amber-200',
  level_6: 'bg-orange-50 text-orange-600 border-orange-200',
  level_7: 'bg-rose-50 text-rose-600 border-rose-200',
  level_8: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200',
  level_9: 'bg-emerald-50 text-emerald-600 border-emerald-200',
};

export const SKILL_LEVEL_TEXT_COLORS: Record<SkillLevel, string> = {
  level_1: 'text-slate-600',
  level_2: 'text-sky-600',
  level_3: 'text-cyan-600',
  level_4: 'text-lime-700',
  level_5: 'text-amber-600',
  level_6: 'text-orange-600',
  level_7: 'text-rose-600',
  level_8: 'text-fuchsia-600',
  level_9: 'text-emerald-600',
};

export function normalizeSkillLevel(value?: string | null): SkillLevel {
  const normalized = (value || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (SKILL_LEVELS.includes(normalized as SkillLevel)) return normalized as SkillLevel;
  if (normalized === 'beginner') return 'level_2';
  if (normalized === 'intermediate') return 'level_5';
  if (normalized === 'advanced') return 'level_8';
  if (normalized === 'pro') return 'level_9';
  return 'level_5';
}

export function skillLevelLabel(value?: string | null) {
  return SKILL_LEVEL_LABELS[normalizeSkillLevel(value)];
}

export function skillLevelShortLabel(value?: string | null) {
  return skillLevelLabel(value).replace('Level ', 'L');
}

export function skillLevelColor(value?: string | null) {
  return SKILL_LEVEL_COLORS[normalizeSkillLevel(value)];
}

export function skillLevelTextColor(value?: string | null) {
  return SKILL_LEVEL_TEXT_COLORS[normalizeSkillLevel(value)];
}

export function compareSkillLevels(a?: string | null, b?: string | null) {
  return SKILL_LEVELS.indexOf(normalizeSkillLevel(a)) - SKILL_LEVELS.indexOf(normalizeSkillLevel(b));
}
