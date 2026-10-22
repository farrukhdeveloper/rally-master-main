import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarDays, Check, ChevronDown, ChevronUp, Clock, MapPin,
  Plus, RefreshCw, ShieldCheck, Swords, Trash2, Trophy, X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import {
  Competition, CompetitionFixture, CompetitionGroup, CompetitionRoster,
  Environment, Group, Profile, supabase, TeamLabel,
} from '../lib/supabase';
import { generateSeededChallengeSchedule } from '../lib/challengeSchedule';
import { skillLevelColor, skillLevelLabel } from '../lib/skillLevels';

interface GroupWithMembers extends Group {
  members: Profile[];
}

interface ChallengeDetails extends Competition {
  groups: (CompetitionGroup & { group: Group })[];
  rosters: (CompetitionRoster & { profile: Profile })[];
  fixtures: CompetitionFixture[];
}

const emptyForm = {
  title: '', groupA: '', groupB: '', eventDate: '', startTime: '18:00', venue: '',
  courtCount: 2, fixtureMinutes: 10, countsForRankings: false,
};

const emptyExtraForm = {
  playerA: [] as string[], playerB: [] as string[], courtNumber: 1,
  scheduledAt: '', allowRematch: false,
};

function dateTimeLabel(value: string) {
  return new Date(value).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}

function playerName(player?: Profile) {
  return player?.full_name || 'Unknown player';
}

function dateTimeLocalValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function GroupChallengesPage({ envFilter = 'prod' }: { envFilter?: Environment }) {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [groups, setGroups] = useState<GroupWithMembers[]>([]);
  const [challenges, setChallenges] = useState<ChallengeDetails[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [rosterA, setRosterA] = useState<string[]>([]);
  const [rosterB, setRosterB] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fixtureFilter, setFixtureFilter] = useState<'all' | 'scheduled' | 'completed'>('all');
  const [resultFixture, setResultFixture] = useState<CompetitionFixture | null>(null);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [showExtraMatch, setShowExtraMatch] = useState(false);
  const [extraForm, setExtraForm] = useState(emptyExtraForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: groupRows }, { data: membershipRows }, { data: competitionRows }] = await Promise.all([
      supabase.from('groups').select('*').eq('environment', envFilter).order('name'),
      supabase.from('player_groups').select('group_id, profile:profiles(*)'),
      supabase.from('competitions').select('*').eq('environment', envFilter).eq('competition_type', 'group_challenge').order('event_date', { ascending: false }),
    ]);

    const membersByGroup = new Map<string, Profile[]>();
    for (const row of (membershipRows as any[]) || []) {
      if (!row.profile || row.profile.environment !== envFilter) continue;
      const list = membersByGroup.get(row.group_id) || [];
      list.push(row.profile);
      membersByGroup.set(row.group_id, list);
    }
    setGroups(((groupRows as Group[]) || []).map((group) => ({
      ...group,
      members: (membersByGroup.get(group.id) || []).sort((a, b) => a.full_name.localeCompare(b.full_name)),
    })));

    const ids = ((competitionRows as Competition[]) || []).map((row) => row.id);
    if (ids.length === 0) {
      setChallenges([]);
      setSelectedId('');
      setLoading(false);
      return;
    }

    const [{ data: sideRows }, { data: rosterRows }, { data: fixtureRows }] = await Promise.all([
      supabase.from('competition_groups').select('*, group:groups(*)').in('competition_id', ids),
      supabase.from('competition_rosters').select('*, profile:profiles(*)').in('competition_id', ids).order('seed_number'),
      supabase.from('competition_fixtures').select('*, players:competition_fixture_players(*, profile:profiles(*))').in('competition_id', ids).order('round_number').order('wave_number').order('court_number'),
    ]);

    const details = ((competitionRows as Competition[]) || []).map((competition) => ({
      ...competition,
      groups: ((sideRows as any[]) || []).filter((row) => row.competition_id === competition.id),
      rosters: ((rosterRows as any[]) || []).filter((row) => row.competition_id === competition.id),
      fixtures: ((fixtureRows as any[]) || []).filter((row) => row.competition_id === competition.id),
    })) as ChallengeDetails[];
    setChallenges(details);
    setSelectedId((current) => details.some((item) => item.id === current) ? current : details[0]?.id || '');
    setLoading(false);
  }, [envFilter]);

  useEffect(() => { loadData(); }, [loadData]);

  const selected = challenges.find((challenge) => challenge.id === selectedId) || null;
  const groupA = groups.find((group) => group.id === form.groupA);
  const groupB = groups.find((group) => group.id === form.groupB);
  const preview = useMemo(() => {
    if (rosterA.length < 2 || rosterA.length !== rosterB.length || !form.eventDate || !form.startTime) return null;
    return generateSeededChallengeSchedule(rosterA.length, form.courtCount, form.fixtureMinutes, form.eventDate, form.startTime);
  }, [rosterA.length, rosterB.length, form.courtCount, form.fixtureMinutes, form.eventDate, form.startTime]);

  function toggleRoster(side: TeamLabel, id: string) {
    const update = side === 'A' ? setRosterA : setRosterB;
    update((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function moveSeed(side: TeamLabel, index: number, direction: -1 | 1) {
    const update = side === 'A' ? setRosterA : setRosterB;
    update((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function createChallenge() {
    setError('');
    if (!user || !form.title.trim() || !form.groupA || !form.groupB || !form.eventDate || !form.venue.trim()) {
      setError('Complete the challenge name, groups, date, and venue.'); return;
    }
    if (form.groupA === form.groupB) { setError('Choose two different groups.'); return; }
    if (rosterA.length < 2 || rosterA.length !== rosterB.length) {
      setError('Both groups need the same number of seeded players, with at least two per group.'); return;
    }
    if (!preview) return;
    const ownsEitherGroup = isSuperAdmin || groupA?.created_by === user.id || groupB?.created_by === user.id;
    if (!ownsEitherGroup) { setError('Only a participating group owner or super admin can create this challenge.'); return; }

    setSaving(true);
    const { data: competition, error: competitionError } = await supabase.from('competitions').insert({
      competition_type: 'group_challenge', title: form.title.trim(), environment: envFilter,
      event_date: form.eventDate, start_time: form.startTime, venue: form.venue.trim(),
      court_count: form.courtCount, fixture_minutes: form.fixtureMinutes,
      counts_for_rankings: form.countsForRankings, status: 'scheduled', created_by: user.id,
    }).select().single();
    if (competitionError || !competition) { setError(competitionError?.message || 'Could not create challenge.'); setSaving(false); return; }

    try {
      const { data: sides, error: sideError } = await supabase.from('competition_groups').insert([
        { competition_id: competition.id, group_id: form.groupA, side: 'A' },
        { competition_id: competition.id, group_id: form.groupB, side: 'B' },
      ]).select();
      if (sideError || !sides || sides.length !== 2) throw sideError || new Error('Could not save challenge groups.');
      const sideAId = sides.find((row: any) => row.side === 'A')!.id;
      const sideBId = sides.find((row: any) => row.side === 'B')!.id;

      const { error: rosterError } = await supabase.from('competition_rosters').insert([
        ...rosterA.map((playerId, index) => ({ competition_id: competition.id, competition_group_id: sideAId, player_id: playerId, seed_number: index + 1 })),
        ...rosterB.map((playerId, index) => ({ competition_id: competition.id, competition_group_id: sideBId, player_id: playerId, seed_number: index + 1 })),
      ]);
      if (rosterError) throw rosterError;

      const { data: fixtures, error: fixtureError } = await supabase.from('competition_fixtures').insert(
        preview.fixtures.map((fixture) => ({
          competition_id: competition.id, round_number: fixture.roundNumber, wave_number: fixture.waveNumber,
          court_number: fixture.courtNumber, scheduled_at: fixture.scheduledAt, status: 'scheduled',
        })),
      ).select();
      if (fixtureError || !fixtures) throw fixtureError || new Error('Could not create fixtures.');

      const playerRows: any[] = [];
      fixtures.forEach((fixture: any, index: number) => {
        const [firstSeed, secondSeed] = preview.fixtures[index].seeds;
        playerRows.push(
          { fixture_id: fixture.id, side: 'A', player_id: rosterA[firstSeed - 1], seed_number: firstSeed, team_position: 1 },
          { fixture_id: fixture.id, side: 'A', player_id: rosterA[secondSeed - 1], seed_number: secondSeed, team_position: 2 },
          { fixture_id: fixture.id, side: 'B', player_id: rosterB[firstSeed - 1], seed_number: firstSeed, team_position: 1 },
          { fixture_id: fixture.id, side: 'B', player_id: rosterB[secondSeed - 1], seed_number: secondSeed, team_position: 2 },
        );
      });
      const { error: playerError } = await supabase.from('competition_fixture_players').insert(playerRows);
      if (playerError) throw playerError;

      if (competition.session_id) {
        const finish = new Date(preview.estimatedFinish);
        const endTime = `${finish.getHours().toString().padStart(2, '0')}:${finish.getMinutes().toString().padStart(2, '0')}:00`;
        await supabase.from('sessions').update({ end_time: endTime }).eq('id', competition.session_id);
      }

      setShowCreate(false); setForm(emptyForm); setRosterA([]); setRosterB([]);
      await loadData(); setSelectedId(competition.id);
    } catch (caught: any) {
      await supabase.from('competitions').delete().eq('id', competition.id);
      setError(caught?.message || 'Challenge creation failed.');
    } finally { setSaving(false); }
  }

  const selectedSideA = selected?.groups.find((row) => row.side === 'A');
  const selectedSideB = selected?.groups.find((row) => row.side === 'B');
  const isOrganiser = !!selected && !!user && (isSuperAdmin || selected.created_by === user.id || selectedSideA?.group?.created_by === user.id || selectedSideB?.group?.created_by === user.id);
  const isRosterPlayer = !!selected?.rosters.some((row) => row.player_id === user?.id);

  const standings = useMemo(() => {
    const completed = selected?.fixtures.filter((fixture) => fixture.status === 'completed') || [];
    const summary = { winsA: 0, winsB: 0, pointsA: 0, pointsB: 0, completed: completed.length };
    completed.forEach((fixture) => {
      if (fixture.winner_side === 'A') summary.winsA++; else if (fixture.winner_side === 'B') summary.winsB++;
      summary.pointsA += fixture.score_a || 0; summary.pointsB += fixture.score_b || 0;
    });
    return summary;
  }, [selected]);

  function leaderLabel() {
    if (!selected) return '';
    const nameA = selectedSideA?.group?.name || 'Group A';
    const nameB = selectedSideB?.group?.name || 'Group B';
    if (standings.winsA !== standings.winsB) return standings.winsA > standings.winsB ? `${nameA} lead` : `${nameB} lead`;
    const diff = standings.pointsA - standings.pointsB;
    if (diff !== 0) return diff > 0 ? `${nameA} lead on points` : `${nameB} lead on points`;
    if (standings.pointsA !== standings.pointsB) return standings.pointsA > standings.pointsB ? `${nameA} lead on points scored` : `${nameB} lead on points scored`;
    return 'Challenge tied';
  }

  async function saveResult() {
    if (!resultFixture || !user) return;
    const a = Number(scoreA); const b = Number(scoreB);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) {
      setError('Scores must be non-negative whole numbers and cannot be equal.'); return;
    }
    setSaving(true); setError('');
    const { error: resultError } = await supabase.from('competition_fixtures').update({
      score_a: a, score_b: b, winner_side: a > b ? 'A' : 'B', status: 'completed',
      completed_at: new Date().toISOString(), recorded_by: user.id,
    }).eq('id', resultFixture.id);
    if (resultError) setError(resultError.message);
    else { setResultFixture(null); setScoreA(''); setScoreB(''); await loadData(); }
    setSaving(false);
  }

  async function clearResult(fixture: CompetitionFixture) {
    if (!isOrganiser || !confirm('Remove this fixture result?')) return;
    setSaving(true);
    const { error: clearError } = await supabase.from('competition_fixtures').update({ status: 'scheduled' }).eq('id', fixture.id);
    if (clearError) setError(clearError.message); else await loadData();
    setSaving(false);
  }

  function openExtraMatch() {
    if (!selected || !isOrganiser) return;
    const latestTime = selected.fixtures.reduce(
      (latest, fixture) => Math.max(latest, new Date(fixture.scheduled_at).getTime()),
      new Date(`${selected.event_date}T${selected.start_time}`).getTime(),
    );
    setExtraForm({
      ...emptyExtraForm,
      scheduledAt: dateTimeLocalValue(new Date(latestTime + selected.fixture_minutes * 60_000)),
    });
    setError('');
    setShowExtraMatch(true);
  }

  function toggleExtraPlayer(side: TeamLabel, playerId: string) {
    const key = side === 'A' ? 'playerA' : 'playerB';
    setExtraForm((current) => {
      const selectedPlayers = current[key];
      const next = selectedPlayers.includes(playerId)
        ? selectedPlayers.filter((id) => id !== playerId)
        : selectedPlayers.length < 2 ? [...selectedPlayers, playerId] : selectedPlayers;
      return { ...current, [key]: next };
    });
  }

  async function addExtraMatch() {
    if (!selected || !isOrganiser || extraForm.playerA.length !== 2 || extraForm.playerB.length !== 2 || !extraForm.scheduledAt) return;
    setError('');

    const scheduledAt = new Date(extraForm.scheduledAt).toISOString();
    const selectedPlayerIds = new Set([...extraForm.playerA, ...extraForm.playerB]);
    const courtConflict = selected.fixtures.some((fixture) =>
      fixture.scheduled_at === scheduledAt && fixture.court_number === extraForm.courtNumber,
    );
    if (courtConflict) {
      setError(`Court ${extraForm.courtNumber} already has a fixture at this time.`);
      return;
    }
    const playerConflict = selected.fixtures.find((fixture) =>
      fixture.scheduled_at === scheduledAt
      && (fixture.players || []).some((player) => selectedPlayerIds.has(player.player_id)),
    );
    if (playerConflict) {
      setError('One or more selected players already have a fixture at this time.');
      return;
    }

    const pairKey = (ids: string[]) => [...ids].sort().join('|');
    const duplicate = selected.fixtures.some((fixture) => {
      const idsA = (fixture.players || []).filter((player) => player.side === 'A').map((player) => player.player_id);
      const idsB = (fixture.players || []).filter((player) => player.side === 'B').map((player) => player.player_id);
      return pairKey(idsA) === pairKey(extraForm.playerA) && pairKey(idsB) === pairKey(extraForm.playerB);
    });
    if (duplicate && !extraForm.allowRematch) {
      setError('This exact fixture is already scheduled. Select intentional rematch to add it again.');
      return;
    }

    const rosterByPlayer = new Map(selected.rosters.map((row) => [row.player_id, row]));
    const roundNumber = Math.max(0, ...selected.fixtures.map((fixture) => fixture.round_number)) + 1;
    setSaving(true);
    const { data: fixture, error: fixtureError } = await supabase.from('competition_fixtures').insert({
      competition_id: selected.id,
      round_number: roundNumber,
      wave_number: 1,
      court_number: extraForm.courtNumber,
      scheduled_at: scheduledAt,
      status: 'scheduled',
      is_extra: true,
    }).select().single();

    if (fixtureError || !fixture) {
      setError(fixtureError?.message || 'Could not add the extra match.');
      setSaving(false);
      return;
    }

    const playerRows = [
      ...extraForm.playerA.map((playerId, index) => ({ fixture_id: fixture.id, side: 'A', player_id: playerId, seed_number: rosterByPlayer.get(playerId)!.seed_number, team_position: index + 1 })),
      ...extraForm.playerB.map((playerId, index) => ({ fixture_id: fixture.id, side: 'B', player_id: playerId, seed_number: rosterByPlayer.get(playerId)!.seed_number, team_position: index + 1 })),
    ];
    const { error: playersError } = await supabase.from('competition_fixture_players').insert(playerRows);
    if (playersError) {
      await supabase.from('competition_fixtures').delete().eq('id', fixture.id);
      setError(playersError.message);
    } else {
      setShowExtraMatch(false);
      setExtraForm(emptyExtraForm);
      await loadData();
    }
    setSaving(false);
  }

  async function deleteFixture(fixture: CompetitionFixture) {
    if (!isOrganiser) return;
    const matchLabel = fixture.is_extra ? 'extra match' : `Round ${fixture.round_number} match`;
    const historyWarning = fixture.status === 'completed'
      ? ' Its result and linked player match history will also be removed.'
      : '';
    if (!confirm(`Permanently delete this ${matchLabel}?${historyWarning}`)) return;

    setSaving(true);
    setError('');
    const { error: deleteError } = await supabase.rpc('delete_challenge_fixture', {
      target_fixture_id: fixture.id,
    });
    if (deleteError) setError(deleteError.message);
    else {
      if (resultFixture?.id === fixture.id) setResultFixture(null);
      await loadData();
    }
    setSaving(false);
  }

  async function deleteChallenge() {
    if (!selected || !isOrganiser) return;
    const completedCount = selected.fixtures.filter((fixture) => fixture.status === 'completed').length;
    const resultWarning = completedCount > 0
      ? ` ${completedCount} completed result${completedCount === 1 ? '' : 's'} and their linked player match history will be removed.`
      : '';
    if (!confirm(`Permanently delete "${selected.title}" and all ${selected.fixtures.length} matches?${resultWarning} This cannot be undone.`)) return;

    setSaving(true);
    setError('');
    const { error: deleteError } = await supabase.rpc('delete_group_challenge', {
      target_competition_id: selected.id,
    });
    if (deleteError) setError(deleteError.message);
    else {
      setResultFixture(null);
      setShowExtraMatch(false);
      setSelectedId('');
      await loadData();
    }
    setSaving(false);
  }

  async function regenerateSchedule() {
    if (!selected || !isOrganiser || selected.fixtures.some((fixture) => fixture.status === 'completed')) return;
    const sideA = selected.groups.find((row) => row.side === 'A');
    const sideB = selected.groups.find((row) => row.side === 'B');
    const seededA = selected.rosters
      .filter((row) => row.competition_group_id === sideA?.id)
      .sort((a, b) => a.seed_number - b.seed_number);
    const seededB = selected.rosters
      .filter((row) => row.competition_group_id === sideB?.id)
      .sort((a, b) => a.seed_number - b.seed_number);

    if (!sideA || !sideB || seededA.length < 2 || seededA.length !== seededB.length) {
      setError('The challenge needs equal, seeded rosters before its schedule can be regenerated.');
      return;
    }

    const schedule = generateSeededChallengeSchedule(
      seededA.length,
      selected.court_count,
      selected.fixture_minutes,
      selected.event_date,
      selected.start_time,
    );

    if (!confirm(`Regenerate all ${schedule.totalFixtures} pending fixtures?`)) return;
    setSaving(true);
    setError('');

    try {
      const { error: deleteError } = await supabase
        .from('competition_fixtures')
        .delete()
        .eq('competition_id', selected.id);
      if (deleteError) throw deleteError;

      const { data: fixtures, error: fixtureError } = await supabase
        .from('competition_fixtures')
        .insert(schedule.fixtures.map((fixture) => ({
          competition_id: selected.id,
          round_number: fixture.roundNumber,
          wave_number: fixture.waveNumber,
          court_number: fixture.courtNumber,
          scheduled_at: fixture.scheduledAt,
          status: 'scheduled',
        })))
        .select();
      if (fixtureError || !fixtures) throw fixtureError || new Error('Could not regenerate fixtures.');

      const playerRows: Array<{
        fixture_id: string;
        side: TeamLabel;
        player_id: string;
        seed_number: number;
        team_position: 1 | 2;
      }> = [];
      fixtures.forEach((fixture, index) => {
        const [firstSeed, secondSeed] = schedule.fixtures[index].seeds;
        playerRows.push(
          { fixture_id: fixture.id, side: 'A', player_id: seededA[firstSeed - 1].player_id, seed_number: firstSeed, team_position: 1 },
          { fixture_id: fixture.id, side: 'A', player_id: seededA[secondSeed - 1].player_id, seed_number: secondSeed, team_position: 2 },
          { fixture_id: fixture.id, side: 'B', player_id: seededB[firstSeed - 1].player_id, seed_number: firstSeed, team_position: 1 },
          { fixture_id: fixture.id, side: 'B', player_id: seededB[secondSeed - 1].player_id, seed_number: secondSeed, team_position: 2 },
        );
      });

      const { error: playerError } = await supabase.from('competition_fixture_players').insert(playerRows);
      if (playerError) throw playerError;
      await loadData();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Schedule regeneration failed.');
    } finally {
      setSaving(false);
    }
  }

  function openResult(fixture: CompetitionFixture) {
    setError(''); setResultFixture(fixture);
    setScoreA(fixture.score_a?.toString() || ''); setScoreB(fixture.score_b?.toString() || '');
  }

  const rounds = [...new Set((selected?.fixtures || []).map((fixture) => fixture.round_number))];
  const regularRoundCount = new Set(
    (selected?.fixtures || []).filter((fixture) => !fixture.is_extra).map((fixture) => fixture.round_number),
  ).size;
  const extraMatchCount = (selected?.fixtures || []).filter((fixture) => fixture.is_extra).length;
  const visibleRounds = rounds.map((round) => ({
    round,
    fixtures: (selected?.fixtures || []).filter((fixture) => fixture.round_number === round && (fixtureFilter === 'all' || fixture.status === fixtureFilter)),
  })).filter((entry) => entry.fixtures.length > 0);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div><h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Swords className="w-6 h-6 text-emerald-600" />Group Challenges</h1><p className="text-sm text-gray-500 mt-1">Seeded doubles challenges with live group standings.</p></div>
        {isAdmin && <button onClick={() => { setShowCreate(true); setError(''); }} className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2.5 rounded-xl text-sm font-semibold"><Plus className="w-4 h-4" />New Challenge</button>}
      </header>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">{error}</div>}

      {showCreate && (
        <section className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between"><div><h2 className="font-bold text-gray-900">Create Seeded Challenge</h2><p className="text-xs text-gray-500 mt-1">Select equal rosters, then arrange each side by challenge seed.</p></div><button onClick={() => setShowCreate(false)} className="p-2 text-gray-400 hover:text-gray-800"><X className="w-5 h-5" /></button></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Challenge name" className="lg:col-span-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Venue" className="lg:col-span-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <label className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-500">Courts<input type="number" min="1" value={form.courtCount} onChange={(e) => setForm({ ...form, courtCount: Math.max(1, Number(e.target.value)) })} className="block w-full bg-transparent text-gray-900 text-sm focus:outline-none" /></label>
            <label className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-500">Minutes / fixture<input type="number" min="1" value={form.fixtureMinutes} onChange={(e) => setForm({ ...form, fixtureMinutes: Math.max(1, Number(e.target.value)) })} className="block w-full bg-transparent text-gray-900 text-sm focus:outline-none" /></label>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <RosterEditor side="A" groups={groups} selectedGroup={form.groupA} onGroup={(value) => { setForm({ ...form, groupA: value }); setRosterA([]); }} roster={rosterA} group={groupA} onToggle={(id) => toggleRoster('A', id)} onMove={(index, direction) => moveSeed('A', index, direction)} excludedGroup={form.groupB} />
            <RosterEditor side="B" groups={groups} selectedGroup={form.groupB} onGroup={(value) => { setForm({ ...form, groupB: value }); setRosterB([]); }} roster={rosterB} group={groupB} onToggle={(id) => toggleRoster('B', id)} onMove={(index, direction) => moveSeed('B', index, direction)} excludedGroup={form.groupA} />
          </div>
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-sky-50 text-sky-700 px-3 py-2 rounded-lg">{preview?.totalFixtures || 0} fixtures</span><span className="bg-violet-50 text-violet-700 px-3 py-2 rounded-lg">{preview?.rounds || 0} rounds</span><span className="bg-amber-50 text-amber-700 px-3 py-2 rounded-lg">{preview?.appearancesPerPlayer || 0} games / player</span>{preview && <span className="bg-gray-100 text-gray-600 px-3 py-2 rounded-lg">Finish {new Date(preview.estimatedFinish).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            <div className="flex items-center gap-3"><label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.countsForRankings} onChange={(e) => setForm({ ...form, countsForRankings: e.target.checked })} className="w-4 h-4 accent-emerald-500" />Count for rankings</label><button onClick={createChallenge} disabled={saving || !preview} className="bg-emerald-500 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">{saving ? 'Creating...' : 'Create & Schedule'}</button></div>
          </div>
        </section>
      )}

      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-5">
        <aside className="space-y-2">
          <div className="flex items-center justify-between px-1"><h2 className="font-semibold text-gray-900">Challenges</h2><button onClick={loadData} className="p-2 text-gray-400 hover:text-gray-800"><RefreshCw className="w-4 h-4" /></button></div>
          {loading ? <div className="h-28 bg-gray-200 animate-pulse rounded-xl" /> : challenges.length === 0 ? <div className="bg-white border border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">No challenges yet.</div> : challenges.map((challenge) => {
            const a = challenge.groups.find((row) => row.side === 'A')?.group?.name || 'Group A'; const b = challenge.groups.find((row) => row.side === 'B')?.group?.name || 'Group B';
            return <button key={challenge.id} onClick={() => setSelectedId(challenge.id)} className={`w-full text-left p-3 rounded-xl border transition-all ${challenge.id === selectedId ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-200 hover:border-gray-300'}`}><p className="font-semibold text-gray-900 break-words">{challenge.title}</p><p className="text-xs text-gray-500 mt-1 break-words">{a} vs {b}</p><p className="text-xs text-gray-400 mt-2">{challenge.event_date} · {challenge.status.replace('_', ' ')}</p></button>;
          })}
        </aside>

        <main className="min-w-0">
          {!selected ? <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center"><Swords className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Select a challenge to see its fixtures.</p></div> : (
            <div className="space-y-4">
              <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="p-4 sm:p-5 bg-emerald-50 border-b border-emerald-100"><div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3"><div><div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-bold text-gray-900">{selected.title}</h2>{isOrganiser && <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 text-emerald-700 px-2 py-1 rounded-lg text-xs"><ShieldCheck className="w-3.5 h-3.5" />Organiser</span>}{!selected.counts_for_rankings && <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg text-xs">Exhibition</span>}</div><div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-2"><span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{selected.event_date}</span><span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{selected.start_time.slice(0, 5)}</span><span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{selected.venue}</span></div></div><div className="flex items-center gap-2 flex-wrap"><span className="bg-white border border-emerald-200 px-3 py-2 rounded-xl text-sm font-semibold text-emerald-700">{leaderLabel()}</span></div></div></div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4 sm:p-6"><div className="text-center min-w-0"><p className="font-bold text-gray-900 break-words">{selectedSideA?.group?.name}</p><p className="text-3xl font-bold text-sky-600 mt-2">{standings.winsA}</p><p className="text-xs text-gray-400">fixture wins · {standings.pointsA - standings.pointsB >= 0 ? '+' : ''}{standings.pointsA - standings.pointsB} diff</p></div><div className="text-gray-300 font-bold">vs</div><div className="text-center min-w-0"><p className="font-bold text-gray-900 break-words">{selectedSideB?.group?.name}</p><p className="text-3xl font-bold text-rose-600 mt-2">{standings.winsB}</p><p className="text-xs text-gray-400">fixture wins · {standings.pointsB - standings.pointsA >= 0 ? '+' : ''}{standings.pointsB - standings.pointsA} diff</p></div></div>
                <div className="grid grid-cols-3 border-t border-gray-100 text-center text-xs"><div className="p-3"><b className="block text-gray-900 text-base">{standings.completed}</b><span className="text-gray-400">Completed</span></div><div className="p-3 border-x border-gray-100"><b className="block text-gray-900 text-base">{selected.fixtures.length - standings.completed}</b><span className="text-gray-400">Remaining</span></div><div className="p-3"><b className="block text-gray-900 text-base">{regularRoundCount}</b><span className="text-gray-400">Rounds{extraMatchCount > 0 ? ` + ${extraMatchCount} extra` : ''}</span></div></div>
              </section>

              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex gap-2 flex-wrap">
                  {(['all', 'scheduled', 'completed'] as const).map((value) => (
                    <button key={value} onClick={() => setFixtureFilter(value)} className={`px-3 py-2 rounded-lg text-xs font-semibold capitalize ${fixtureFilter === value ? 'bg-emerald-500 text-white' : 'bg-white border border-gray-200 text-gray-500'}`}>
                      {value === 'scheduled' ? 'Upcoming' : value}
                    </button>
                  ))}
                </div>
                {isOrganiser && (
                  <div className="flex gap-2 flex-wrap">
                    <button onClick={openExtraMatch} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-500 text-white rounded-lg text-xs font-semibold disabled:opacity-40">
                      <Plus className="w-3.5 h-3.5" />Extra Match
                    </button>
                    {standings.completed === 0 && (
                      <button onClick={regenerateSchedule} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 hover:border-emerald-300 rounded-lg text-xs font-semibold disabled:opacity-40">
                        <RefreshCw className="w-3.5 h-3.5" />Regenerate schedule
                      </button>
                    )}
                    <button onClick={deleteChallenge} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-lg text-xs font-semibold disabled:opacity-40">
                      <Trash2 className="w-3.5 h-3.5" />Delete whole challenge
                    </button>
                  </div>
                )}
              </div>

              {visibleRounds.map(({ round, fixtures }) => { const extraRound = fixtures.every((fixture) => fixture.is_extra); return <section key={round} className={`bg-white border rounded-2xl p-4 ${extraRound ? 'border-violet-200' : 'border-gray-200'}`}><h3 className="font-semibold text-gray-900 mb-3">{extraRound ? 'Extra Match' : `Round ${round}`}</h3><div className="grid xl:grid-cols-2 gap-3">{fixtures.map((fixture) => <FixtureCard key={fixture.id} fixture={fixture} groupA={selectedSideA?.group?.name || 'Group A'} groupB={selectedSideB?.group?.name || 'Group B'} canSubmit={isOrganiser || (isRosterPlayer && fixture.status === 'scheduled')} isOrganiser={isOrganiser} onResult={() => openResult(fixture)} onClear={() => clearResult(fixture)} onDelete={() => deleteFixture(fixture)} />)}</div></section>; })}
            </div>
          )}
        </main>
      </div>

      {resultFixture && selected && <ResultModal fixture={resultFixture} groupA={selectedSideA?.group?.name || 'Group A'} groupB={selectedSideB?.group?.name || 'Group B'} scoreA={scoreA} scoreB={scoreB} onScoreA={setScoreA} onScoreB={setScoreB} onSave={saveResult} onClose={() => setResultFixture(null)} saving={saving} />}
      {showExtraMatch && selected && <ExtraMatchModal challenge={selected} sideA={selectedSideA} sideB={selectedSideB} form={extraForm} onToggle={toggleExtraPlayer} onCourt={(courtNumber) => setExtraForm((current) => ({ ...current, courtNumber }))} onTime={(scheduledAt) => setExtraForm((current) => ({ ...current, scheduledAt }))} onRematch={(allowRematch) => setExtraForm((current) => ({ ...current, allowRematch }))} onSave={addExtraMatch} onClose={() => setShowExtraMatch(false)} saving={saving} />}
    </div>
  );
}

function RosterEditor({ side, groups, selectedGroup, onGroup, roster, group, onToggle, onMove, excludedGroup }: { side: TeamLabel; groups: GroupWithMembers[]; selectedGroup: string; onGroup: (value: string) => void; roster: string[]; group?: GroupWithMembers; onToggle: (id: string) => void; onMove: (index: number, direction: -1 | 1) => void; excludedGroup: string }) {
  return <div className={`border rounded-2xl p-4 ${side === 'A' ? 'border-sky-200 bg-sky-50' : 'border-rose-200 bg-rose-50'}`}><label className="text-xs font-semibold text-gray-500">Group {side}</label><select value={selectedGroup} onChange={(e) => onGroup(e.target.value)} className="w-full mt-1 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm"><option value="">Select group</option>{groups.filter((item) => item.id !== excludedGroup).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{roster.length > 0 && <div className="space-y-1.5 mt-3">{roster.map((id, index) => { const profile = group?.members.find((member) => member.id === id); return <div key={id} className="bg-white border border-gray-100 rounded-xl p-2 flex items-center gap-2"><span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold">{index + 1}</span><span className="flex-1 text-sm font-medium text-gray-900 break-words">{playerName(profile)}</span><button onClick={() => onMove(index, -1)} disabled={index === 0} className="p-1 text-gray-400 disabled:opacity-20"><ChevronUp className="w-4 h-4" /></button><button onClick={() => onMove(index, 1)} disabled={index === roster.length - 1} className="p-1 text-gray-400 disabled:opacity-20"><ChevronDown className="w-4 h-4" /></button><button onClick={() => onToggle(id)} className="p-1 text-red-400"><X className="w-4 h-4" /></button></div>; })}</div>}<div className="mt-3"><p className="text-xs font-semibold text-gray-400 mb-2">GROUP MEMBERS</p><div className="grid sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">{group?.members.filter((member) => !roster.includes(member.id)).map((member) => <button key={member.id} onClick={() => onToggle(member.id)} className="text-left bg-white border border-gray-100 rounded-lg px-2.5 py-2 text-xs hover:border-emerald-300"><span className="block font-medium text-gray-800 break-words">{member.full_name}</span><span className={`inline-block mt-1 px-1.5 py-0.5 rounded ${skillLevelColor(member.skill_level)}`}>{skillLevelLabel(member.skill_level)}</span></button>)}</div></div></div>;
}

function FixtureCard({ fixture, groupA, groupB, canSubmit, isOrganiser, onResult, onClear, onDelete }: { fixture: CompetitionFixture; groupA: string; groupB: string; canSubmit: boolean; isOrganiser: boolean; onResult: () => void; onClear: () => void; onDelete: () => void }) {
  const playersA = (fixture.players || []).filter((player) => player.side === 'A').sort((a, b) => a.team_position - b.team_position);
  const playersB = (fixture.players || []).filter((player) => player.side === 'B').sort((a, b) => a.team_position - b.team_position);
  return <article className={`border rounded-xl p-3 ${fixture.is_extra ? 'border-violet-200 bg-violet-50/30' : 'border-gray-200'}`}><div className="flex items-center justify-between gap-2 mb-3"><div className="text-xs text-gray-500"><span className={`font-semibold ${fixture.is_extra ? 'text-violet-700' : 'text-gray-700'}`}>{fixture.is_extra ? 'Extra match' : `Wave ${fixture.wave_number}`}</span> · Court {fixture.court_number} · {dateTimeLabel(fixture.scheduled_at)}</div>{fixture.status === 'completed' ? <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 px-2 py-1 rounded-lg text-xs"><Check className="w-3 h-3" />Done</span> : <span className="bg-amber-50 text-amber-700 px-2 py-1 rounded-lg text-xs">Upcoming</span>}</div><div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-stretch"><TeamBox name={groupA} side="A" players={playersA} winner={fixture.winner_side === 'A'} /><div className="flex items-center font-bold text-gray-300 text-xs">vs</div><TeamBox name={groupB} side="B" players={playersB} winner={fixture.winner_side === 'B'} /></div><div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100"><div>{fixture.status === 'completed' && <span className="font-bold text-gray-900 tabular-nums">{fixture.score_a} - {fixture.score_b}</span>}</div><div className="flex gap-2">{isOrganiser && fixture.status === 'completed' && <button onClick={onClear} title="Clear result and return match to upcoming" className="p-2 text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg"><RefreshCw className="w-4 h-4" /></button>}{isOrganiser && <button onClick={onDelete} title="Permanently delete match" className="p-2 text-red-500 bg-red-50 hover:bg-red-100 rounded-lg"><Trash2 className="w-4 h-4" /></button>}{canSubmit && <button onClick={onResult} className="px-3 py-2 bg-emerald-500 text-white rounded-lg text-xs font-semibold">{fixture.status === 'completed' ? 'Correct result' : 'Enter result'}</button>}</div></div></article>;
}

function TeamBox({ name, side, players, winner }: { name: string; side: TeamLabel; players: any[]; winner: boolean }) {
  return <div className={`rounded-lg p-2 border min-w-0 ${side === 'A' ? 'bg-sky-50 border-sky-100' : 'bg-rose-50 border-rose-100'}`}><p className="text-[11px] font-semibold text-gray-500 break-words">{name}{winner && <Trophy className="inline w-3 h-3 ml-1 text-amber-500" />}</p>{players.map((player) => <p key={player.id} className="text-xs text-gray-900 font-medium mt-1 break-words"><span className="text-gray-400">#{player.seed_number}</span> {playerName(player.profile)}</p>)}</div>;
}

function ExtraMatchModal({ challenge, sideA, sideB, form, onToggle, onCourt, onTime, onRematch, onSave, onClose, saving }: {
  challenge: ChallengeDetails;
  sideA?: CompetitionGroup & { group: Group };
  sideB?: CompetitionGroup & { group: Group };
  form: typeof emptyExtraForm;
  onToggle: (side: TeamLabel, playerId: string) => void;
  onCourt: (value: number) => void;
  onTime: (value: string) => void;
  onRematch: (value: boolean) => void;
  onSave: () => void;
  onClose: () => void;
  saving: boolean;
}) {
  const rosterFor = (competitionGroupId?: string) => challenge.rosters
    .filter((row) => row.competition_group_id === competitionGroupId)
    .sort((a, b) => a.seed_number - b.seed_number);
  const rosterA = rosterFor(sideA?.id);
  const rosterB = rosterFor(sideB?.id);
  const canSave = form.playerA.length === 2 && form.playerB.length === 2 && !!form.scheduledAt && !saving;

  const sidePicker = (side: TeamLabel, rows: (CompetitionRoster & { profile: Profile })[], selectedPlayers: string[], groupName: string) => (
    <div className={`rounded-xl border p-3 ${side === 'A' ? 'border-sky-200 bg-sky-50' : 'border-rose-200 bg-rose-50'}`}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className={`text-sm font-semibold break-words ${side === 'A' ? 'text-sky-700' : 'text-rose-700'}`}>{groupName}</p>
        <span className="text-xs text-gray-500">{selectedPlayers.length}/2</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {rows.map((row) => {
          const selected = selectedPlayers.includes(row.player_id);
          return <button key={row.id} type="button" onClick={() => onToggle(side, row.player_id)} className={`min-w-0 text-left rounded-lg border px-3 py-2 transition-colors ${selected ? side === 'A' ? 'bg-sky-100 border-sky-400' : 'bg-rose-100 border-rose-400' : 'bg-white border-gray-200 hover:border-gray-300'}`}><span className="block text-sm font-medium text-gray-900 break-words">#{row.seed_number} {playerName(row.profile)}</span><span className="text-xs text-gray-400">{skillLevelLabel(row.profile?.skill_level)}</span></button>;
        })}
      </div>
    </div>
  );

  return <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"><div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[95vh] overflow-y-auto"><div className="sticky top-0 z-10 bg-white flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-gray-100"><div><h3 className="font-bold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-violet-600" />Add Extra Match</h3><p className="text-xs text-gray-500 mt-1">Adds a separate fixture without changing the generated seeded schedule.</p></div><button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div><div className="p-4 sm:p-5 space-y-4"><div className="grid sm:grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-500">Court<select value={form.courtNumber} onChange={(event) => onCourt(Number(event.target.value))} className="block w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900">{Array.from({ length: challenge.court_count }, (_, index) => <option key={index + 1} value={index + 1}>Court {index + 1}</option>)}</select></label><label className="text-xs font-semibold text-gray-500">Scheduled time<input type="datetime-local" value={form.scheduledAt} onChange={(event) => onTime(event.target.value)} className="block w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900" /></label></div><div className="grid md:grid-cols-2 gap-3">{sidePicker('A', rosterA, form.playerA, sideA?.group?.name || 'Group A')}{sidePicker('B', rosterB, form.playerB, sideB?.group?.name || 'Group B')}</div><label className="flex items-start gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.allowRematch} onChange={(event) => onRematch(event.target.checked)} className="mt-0.5 w-4 h-4 accent-violet-600" /><span><b className="block text-gray-800">Allow intentional rematch</b>Use only when these exact pairs should play again.</span></label><p className="text-xs text-gray-400">This match counts toward the challenge score and follows the challenge's ranking setting.</p></div><div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm">Cancel</button><button onClick={onSave} disabled={!canSave} className="px-5 py-2.5 bg-violet-600 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">{saving ? 'Adding...' : 'Add Extra Match'}</button></div></div></div>;
}

function ResultModal({ fixture, groupA, groupB, scoreA, scoreB, onScoreA, onScoreB, onSave, onClose, saving }: { fixture: CompetitionFixture; groupA: string; groupB: string; scoreA: string; scoreB: string; onScoreA: (value: string) => void; onScoreB: (value: string) => void; onSave: () => void; onClose: () => void; saving: boolean }) {
  const playersA = (fixture.players || []).filter((player) => player.side === 'A'); const playersB = (fixture.players || []).filter((player) => player.side === 'B');
  return <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"><div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 sm:p-5 max-h-[95vh] overflow-y-auto"><div className="flex justify-between items-start"><div><h3 className="font-bold text-gray-900">Record Fixture Result</h3><p className="text-xs text-gray-500 mt-1">Round {fixture.round_number} · Court {fixture.court_number}</p></div><button onClick={onClose} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div><div className="grid grid-cols-2 gap-3 mt-4"><TeamBox name={groupA} side="A" players={playersA} winner={Number(scoreA) > Number(scoreB)} /><TeamBox name={groupB} side="B" players={playersB} winner={Number(scoreB) > Number(scoreA)} /></div><div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mt-4"><input type="number" min="0" value={scoreA} onChange={(e) => onScoreA(e.target.value)} placeholder="A" className="min-w-0 w-full bg-gray-50 border border-sky-200 rounded-xl px-3 py-3 text-center text-xl font-bold" /><span className="text-gray-300 font-bold">vs</span><input type="number" min="0" value={scoreB} onChange={(e) => onScoreB(e.target.value)} placeholder="B" className="min-w-0 w-full bg-gray-50 border border-rose-200 rounded-xl px-3 py-3 text-center text-xl font-bold" /></div><p className="text-xs text-gray-400 text-center mt-2">The higher score automatically wins the fixture.</p><div className="flex gap-2 mt-5"><button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm">Cancel</button><button onClick={onSave} disabled={saving} className="flex-1 bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">{saving ? 'Saving...' : 'Save Result'}</button></div></div></div>;
}
