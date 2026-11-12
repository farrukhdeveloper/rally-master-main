import { useEffect, useState } from 'react';
import { supabase, type Profile, type SkillLevel } from '../lib/supabase';
import { SKILL_LEVELS, SKILL_LEVEL_DESCRIPTIONS, skillLevelLabel } from '../lib/skillLevels';

type Category = 'technique' | 'movement' | 'consistency' | 'match_play';
type Scores = Record<Category, number | ''>;
type Grading = {
  id: string;
  technique: number;
  movement: number;
  consistency: number;
  match_play: number;
  assigned_level: SkillLevel;
  notes: string;
  created_at: string;
};

const categories: Array<{ key: Category; label: string; hint: string }> = [
  { key: 'technique', label: 'Technique', hint: 'Strokes, serves, and shot control' },
  { key: 'movement', label: 'Movement', hint: 'Footwork, positioning, and recovery' },
  { key: 'consistency', label: 'Consistency', hint: 'Reliable execution under pressure' },
  { key: 'match_play', label: 'Match play', hint: 'Decision making, tactics, and teamwork' },
];

export default function PlayerGradingEditor({ player, onSaved }: { player: Profile; onSaved: () => Promise<void> }) {
  const [scores, setScores] = useState<Scores>({ technique: '', movement: '', consistency: '', match_play: '' });
  const [assignedLevel, setAssignedLevel] = useState<SkillLevel>(player.skill_level);
  const [notes, setNotes] = useState('');
  const [history, setHistory] = useState<Grading[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    supabase.from('player_gradings')
      .select('id, technique, movement, consistency, match_play, assigned_level, notes, created_at')
      .eq('player_id', player.id)
      .order('created_at', { ascending: false })
      .limit(5)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        setHistory((data as Grading[]) || []);
        setError(loadError ? 'Could not load grading history. Check that the player gradings migration is applied.' : '');
        setLoading(false);
      });
    return () => { active = false; };
  }, [player.id]);

  const values = categories.map(({ key }) => scores[key]);
  const complete = values.every((value) => typeof value === 'number');
  const suggestedLevel = complete
    ? Math.max(1, Math.min(9, Math.round((values as number[]).reduce((sum, value) => sum + value, 0) / 4)))
    : null;

  async function saveGrading() {
    if (!complete || loading) return;
    setSaving(true);
    setError('');
    setSuccess('');
    const { data, error: saveError } = await supabase.from('player_gradings').insert({
      player_id: player.id,
      technique: scores.technique,
      movement: scores.movement,
      consistency: scores.consistency,
      match_play: scores.match_play,
      assigned_level: assignedLevel,
      notes: notes.trim(),
    }).select('id, technique, movement, consistency, match_play, assigned_level, notes, created_at').single();
    if (saveError) {
      setError(saveError.message);
    } else {
      setHistory((previous) => [data as Grading, ...previous].slice(0, 5));
      setScores({ technique: '', movement: '', consistency: '', match_play: '' });
      setNotes('');
      setSuccess(`Grading saved. Assigned ${skillLevelLabel(assignedLevel)}.`);
      await onSaved();
    }
    setSaving(false);
  }

  return (
    <section className="space-y-3 border-t border-gray-200 pt-4">
      <div>
        <h4 className="text-sm font-semibold text-gray-900">Player grading</h4>
        <p className="text-xs text-gray-500">Score each skill from 1 (new) to 9 (expert). The average is a guide; the final level is your decision.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {categories.map(({ key, label, hint }) => (
          <label key={key} className="text-sm font-medium text-gray-700">
            {label}
            <span className="block text-xs font-normal text-gray-500">{hint}</span>
            <select value={scores[key]} onChange={(event) => setScores((current) => ({ ...current, [key]: event.target.value ? Number(event.target.value) : '' }))} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
              <option value="">Select score</option>
              {SKILL_LEVELS.map((_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
            </select>
          </label>
        ))}
      </div>
      <p className="text-xs text-gray-600">Suggested level from assessment: <strong>{suggestedLevel ? `Level ${suggestedLevel}` : 'Score all four skills'}</strong></p>
      <label className="block text-sm font-medium text-gray-700">Final assigned level
        <select value={assignedLevel} onChange={(event) => setAssignedLevel(event.target.value as SkillLevel)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm">
          {SKILL_LEVELS.map((level) => <option key={level} value={level}>{skillLevelLabel(level)}</option>)}
        </select>
      </label>
      <p className="text-xs text-gray-500">{SKILL_LEVEL_DESCRIPTIONS[assignedLevel]}</p>
      <label className="block text-sm font-medium text-gray-700">Assessment notes
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} placeholder="Why did you assign this level?" className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm" />
      </label>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {success && <p role="status" className="text-xs text-emerald-700">{success}</p>}
      <button type="button" onClick={saveGrading} disabled={!complete || saving || loading || !notes.trim()} className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Saving grading...' : 'Save grading and level'}</button>
      <div className="space-y-2">
        <h5 className="text-xs font-semibold text-gray-600">Recent assessments</h5>
        {history.length === 0 && !loading && <p className="text-xs text-gray-500">No assessments yet.</p>}
        {history.map((grading) => (
          <div key={grading.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
            <strong>{skillLevelLabel(grading.assigned_level)}</strong> · {new Date(grading.created_at).toLocaleDateString()} · Technique {grading.technique}, Movement {grading.movement}, Consistency {grading.consistency}, Match play {grading.match_play}
            {grading.notes && <p className="mt-1 whitespace-pre-wrap">{grading.notes}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
