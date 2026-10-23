import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, CalendarDays, Check, Clock, MapPin,
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

interface PlayerChoice {
  profile: Profile;
  groupIds: string[];
  groupNames: string[];
}

interface ChallengeDetails extends Competition {
  groups: (CompetitionGroup & { group: Group | null })[];
  rosters: (CompetitionRoster & { profile: Profile })[];
  fixtures: CompetitionFixture[];
}

const emptyForm = {
  title: '', teamAName: '', teamBName: '', eventDate: '', startTime: '18:00', venue: '',
  courtCount: 2, fixtureMinutes: 10, countsForRankings: true,
};

const emptyExtraForm = {
  playerA: [] as string[], playerB: [] as string[], courtNumber: 1,
  scheduledAt: '', allowRematch: false,
};

function sideName(side?: CompetitionGroup & { group?: Group | null }, fallback = 'Team') {
  return side?.team_name?.trim() || side?.group?.name || fallback;
}

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
  const [availablePlayers, setAvailablePlayers] = useState<Profile[]>([]);
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
  const [showEditRoster, setShowEditRoster] = useState(false);
  const [editRosterA, setEditRosterA] = useState<string[]>([]);
  const [editRosterB, setEditRosterB] = useState<string[]>([]);
  const [extraForm, setExtraForm] = useState(emptyExtraForm);

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: groupRows }, { data: membershipRows }, { data: competitionRows }, { data: profileRows }] = await Promise.all([
      supabase.from('groups').select('*').eq('environment', envFilter).order('name'),
      supabase.from('player_groups').select('group_id, profile:profiles(*)'),
      supabase.from('competitions').select('*').eq('environment', envFilter).eq('competition_type', 'group_challenge').order('event_date', { ascending: false }),
      supabase.from('profiles').select('*').eq('environment', envFilter).order('full_name'),
    ]);
    setAvailablePlayers((profileRows as Profile[]) || []);

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
  const playerChoices = useMemo(() => {
    const choices = new Map<string, PlayerChoice>();
    for (const profile of availablePlayers) choices.set(profile.id, { profile, groupIds: [], groupNames: [] });
    for (const group of groups) for (const profile of group.members) {
      const choice = choices.get(profile.id) || { profile, groupIds: [], groupNames: [] };
      choice.groupIds.push(group.id);
      choice.groupNames.push(group.name);
      choices.set(profile.id, choice);
    }
    return [...choices.values()].sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name));
  }, [groups, availablePlayers]);
  const playerById = useMemo(() => new Map(playerChoices.map((choice) => [choice.profile.id, choice.profile])), [playerChoices]);
  const preview = useMemo(() => {
    if (rosterA.length < 2 || rosterA.length !== rosterB.length || !form.eventDate || !form.startTime) return null;
    return generateSeededChallengeSchedule(rosterA.length, form.courtCount, form.fixtureMinutes, form.eventDate, form.startTime);
  }, [rosterA.length, rosterB.length, form.courtCount, form.fixtureMinutes, form.eventDate, form.startTime]);

  function toggleRoster(side: TeamLabel, id: string) {
    const otherRoster = side === 'A' ? rosterB : rosterA;
    if (otherRoster.includes(id)) return;
    const update = side === 'A' ? setRosterA : setRosterB;
    update((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  async function createChallenge() {
    setError('');
    if (!user || !form.teamAName.trim() || !form.teamBName.trim() || !form.eventDate || !form.venue.trim()) {
      setError('Complete both team names, date, and venue.'); return;
    }
    if (new Set([...rosterA, ...rosterB]).size !== rosterA.length + rosterB.length) {
      setError('Each player can belong to only one side of this challenge.'); return;
    }
    if ([...rosterA, ...rosterB].some((id) => !playerById.has(id))) {
      setError('Select players from the available player list.'); return;
    }
    if (rosterA.length < 2 || rosterA.length !== rosterB.length) {
      setError('Both teams need the same number of seeded players, with at least two per team.'); return;
    }
    if (!preview) return;
    if (!isAdmin) { setError('Only an organiser or super admin can create a challenge.'); return; }

    const teamAName = form.teamAName.trim();
    const teamBName = form.teamBName.trim();
    if (teamAName.toLowerCase() === teamBName.toLowerCase()) {
      setError('Give the two sides different team names.'); return;
    }
    setSaving(true);
    const { data: competition, error: competitionError } = await supabase.from('competitions').insert({
      competition_type: 'group_challenge', title: form.title.trim() || `${teamAName} vs ${teamBName}`, environment: envFilter,
      event_date: form.eventDate, start_time: form.startTime, venue: form.venue.trim(),
      court_count: form.courtCount, fixture_minutes: form.fixtureMinutes,
      counts_for_rankings: true, status: 'scheduled', created_by: user.id,
    }).select().single();
    if (competitionError || !competition) { setError(competitionError?.message || 'Could not create challenge.'); setSaving(false); return; }

    try {
      const { data: sides, error: sideError } = await supabase.from('competition_groups').insert([
        { competition_id: competition.id, group_id: null, side: 'A', team_name: teamAName },
        { competition_id: competition.id, group_id: null, side: 'B', team_name: teamBName },
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

  const playerResults = useMemo(() => {
    if (!selected) return [];
    const rows = new Map<string, { id: string; name: string; side: TeamLabel; seed: number; played: number; wins: number; pointsFor: number; pointsAgainst: number; partners: Map<string, { name: string; played: number; wins: number }> }>();
    const sideById = new Map(selected.groups.map((side) => [side.id, side.side]));
    selected.rosters.forEach((roster) => rows.set(roster.player_id, {
      id: roster.player_id, name: playerName(roster.profile), side: sideById.get(roster.competition_group_id) || 'A',
      seed: roster.seed_number, played: 0, wins: 0, pointsFor: 0, pointsAgainst: 0, partners: new Map(),
    }));
    selected.fixtures.filter((fixture) => fixture.status === 'completed').forEach((fixture) => {
      (['A', 'B'] as TeamLabel[]).forEach((side) => {
        const players = (fixture.players || []).filter((player) => player.side === side);
        players.forEach((player) => {
          const row = rows.get(player.player_id);
          if (!row) return;
          row.played++;
          if (fixture.winner_side === side) row.wins++;
          row.pointsFor += (side === 'A' ? fixture.score_a : fixture.score_b) || 0;
          row.pointsAgainst += (side === 'A' ? fixture.score_b : fixture.score_a) || 0;
          players.filter((partner) => partner.player_id !== player.player_id).forEach((partner) => {
            const pair = row.partners.get(partner.player_id) || { name: playerName(partner.profile), played: 0, wins: 0 };
            pair.played++;
            if (fixture.winner_side === side) pair.wins++;
            row.partners.set(partner.player_id, pair);
          });
        });
      });
    });
    return [...rows.values()].sort((a, b) => b.wins - a.wins || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst) || b.played - a.played || a.seed - b.seed);
  }, [selected]);

  const roundResults = useMemo(() => {
    const rounds = new Map<number, { round: number; winsA: number; winsB: number }>();
    selected?.fixtures.filter((fixture) => fixture.status === 'completed').forEach((fixture) => {
      const row = rounds.get(fixture.round_number) || { round: fixture.round_number, winsA: 0, winsB: 0 };
      if (fixture.winner_side === 'A') row.winsA++;
      if (fixture.winner_side === 'B') row.winsB++;
      rounds.set(fixture.round_number, row);
    });
    return [...rounds.values()].sort((a, b) => a.round - b.round);
  }, [selected]);
  const topPerformer = playerResults.filter((player) => player.played >= 3)
    .sort((a, b) => b.wins / b.played - a.wins / a.played || (b.pointsFor - b.pointsAgainst) - (a.pointsFor - a.pointsAgainst))[0];

  function leaderLabel() {
    if (!selected) return '';
    const nameA = sideName(selectedSideA, 'Team A');
    const nameB = sideName(selectedSideB, 'Team B');
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

  function openRosterEditor() {
    if (!selected || !isOrganiser || selected.fixtures.some((fixture) => fixture.status === 'completed')) return;
    const sideA = selected.groups.find((row) => row.side === 'A');
    const sideB = selected.groups.find((row) => row.side === 'B');
    setEditRosterA(selected.rosters.filter((row) => row.competition_group_id === sideA?.id).sort((a, b) => a.seed_number - b.seed_number).map((row) => row.player_id));
    setEditRosterB(selected.rosters.filter((row) => row.competition_group_id === sideB?.id).sort((a, b) => a.seed_number - b.seed_number).map((row) => row.player_id));
    setError('');
    setShowEditRoster(true);
  }

  function toggleEditRoster(side: TeamLabel, id: string) {
    const other = side === 'A' ? editRosterB : editRosterA;
    if (other.includes(id)) return;
    const update = side === 'A' ? setEditRosterA : setEditRosterB;
    update((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  }

  function moveEditSeed(side: TeamLabel, index: number, direction: -1 | 1) {
    const update = side === 'A' ? setEditRosterA : setEditRosterB;
    update((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  async function saveEditedRoster() {
    if (!selected || !isOrganiser) return;
    if (selected.fixtures.some((fixture) => fixture.status === 'completed')) {
      setError('Player changes are locked once a match result has been recorded.'); return;
    }
    if (editRosterA.length < 2 || editRosterA.length !== editRosterB.length) {
      setError('Both teams need the same number of players, with at least two on each team.'); return;
    }
    const ids = [...editRosterA, ...editRosterB];
    if (new Set(ids).size !== ids.length || ids.some((id) => !playerById.has(id))) {
      setError('Each available player can appear on only one team.'); return;
    }
    const schedule = generateSeededChallengeSchedule(editRosterA.length, selected.court_count, selected.fixture_minutes, selected.event_date, selected.start_time);
    if (!confirm(`Save both rosters and recreate ${schedule.totalFixtures} pending matches?`)) return;
    setSaving(true);
    setError('');
    try {
      const { error: rosterError } = await supabase.rpc('replace_challenge_rosters', {
        target_competition_id: selected.id,
        player_ids_a: editRosterA,
        player_ids_b: editRosterB,
        fixture_schedule: schedule.fixtures.map((fixture) => ({
          round_number: fixture.roundNumber, wave_number: fixture.waveNumber,
          court_number: fixture.courtNumber, scheduled_at: fixture.scheduledAt, seeds: fixture.seeds,
        })),
      });
      if (rosterError) throw rosterError;
      setShowEditRoster(false);
      await loadData();
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Could not save rosters and schedule.');
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
        <div><h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Swords className="w-6 h-6 text-emerald-600" />Group Challenges</h1><p className="text-sm text-gray-500 mt-1">Seeded team challenges with live standings.</p></div>
        {isAdmin && <button onClick={() => { setShowCreate(true); setError(''); }} className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2.5 rounded-xl text-sm font-semibold"><Plus className="w-4 h-4" />New Challenge</button>}
      </header>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl px-4 py-3 text-sm">{error}</div>}

      {showCreate && (
        <section className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between"><div><h2 className="font-bold text-gray-900">Create Seeded Challenge</h2><p className="text-xs text-gray-500 mt-1">Name your teams and add any available players, including players without a group. Selection order sets seeds.</p></div><button onClick={() => setShowCreate(false)} className="p-2 text-gray-400 hover:text-gray-800"><X className="w-5 h-5" /></button></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Challenge name (optional)" className="lg:col-span-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <input type="time" value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <input value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} placeholder="Venue" className="lg:col-span-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <label className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-500">Courts<input type="number" min="1" value={form.courtCount} onChange={(e) => setForm({ ...form, courtCount: Math.max(1, Number(e.target.value)) })} className="block w-full bg-transparent text-gray-900 text-sm focus:outline-none" /></label>
            <label className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs text-gray-500">Minutes / fixture<input type="number" min="1" value={form.fixtureMinutes} onChange={(e) => setForm({ ...form, fixtureMinutes: Math.max(1, Number(e.target.value)) })} className="block w-full bg-transparent text-gray-900 text-sm focus:outline-none" /></label>
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <TeamRosterEditor side="A" groups={groups} players={playerChoices} roster={rosterA} onToggle={(id) => toggleRoster('A', id)} otherRoster={rosterB} teamName={form.teamAName} onTeamName={(value) => setForm({ ...form, teamAName: value })} />
            <TeamRosterEditor side="B" groups={groups} players={playerChoices} roster={rosterB} onToggle={(id) => toggleRoster('B', id)} otherRoster={rosterA} teamName={form.teamBName} onTeamName={(value) => setForm({ ...form, teamBName: value })} />
          </div>
          {rosterA.length > 0 && rosterB.length > 0 && (
            <div className="rounded-xl border border-gray-200 p-3 space-y-1 text-xs text-gray-600">
              <p className="font-semibold text-gray-900">Matching seeds: {form.teamAName.trim() || 'Team 1'} vs {form.teamBName.trim() || 'Team 2'}</p>
              {Array.from({ length: Math.max(rosterA.length, rosterB.length) }, (_, index) => (
                <p key={index}>#{index + 1}: {playerName(playerById.get(rosterA[index]))} vs {playerName(playerById.get(rosterB[index]))}</p>
              ))}
              <p className="text-gray-400">Example: seeds #1 + #2 on side A play seeds #1 + #2 on side B. Remove and reselect a player to change their seed.</p>
            </div>
          )}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="bg-sky-50 text-sky-700 px-3 py-2 rounded-lg">{preview?.totalFixtures || 0} fixtures</span><span className="bg-violet-50 text-violet-700 px-3 py-2 rounded-lg">{preview?.rounds || 0} rounds</span><span className="bg-amber-50 text-amber-700 px-3 py-2 rounded-lg">{preview?.appearancesPerPlayer || 0} games / player</span>{preview && <span className="bg-gray-100 text-gray-600 px-3 py-2 rounded-lg">Finish {new Date(preview.estimatedFinish).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
            <div className="flex items-center gap-3"><span className="text-xs text-gray-500">Completed matches count toward overall rankings.</span><button onClick={createChallenge} disabled={saving || !preview} className="bg-emerald-500 disabled:opacity-40 text-white px-5 py-2.5 rounded-xl text-sm font-semibold">{saving ? 'Creating...' : 'Create & Schedule'}</button></div>
          </div>
        </section>
      )}

      {showEditRoster && selected && (
        <section className="bg-white border border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-gray-900">Edit teams and seeds</h2><p className="text-xs text-gray-500 mt-1">Replace players or use the arrows to change seed order. Saving recreates the pending schedule.</p></div><button onClick={() => setShowEditRoster(false)} aria-label="Close roster editor" className="p-2 text-gray-400"><X className="w-5 h-5" /></button></div>
          <div className="grid lg:grid-cols-2 gap-4">
            <TeamRosterEditor side="A" groups={groups} players={playerChoices} roster={editRosterA} otherRoster={editRosterB} teamName={sideName(selectedSideA, 'Team A')} onTeamName={() => {}} nameEditable={false} onToggle={(id) => toggleEditRoster('A', id)} onMove={(index, direction) => moveEditSeed('A', index, direction)} />
            <TeamRosterEditor side="B" groups={groups} players={playerChoices} roster={editRosterB} otherRoster={editRosterA} teamName={sideName(selectedSideB, 'Team B')} onTeamName={() => {}} nameEditable={false} onToggle={(id) => toggleEditRoster('B', id)} onMove={(index, direction) => moveEditSeed('B', index, direction)} />
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap"><p className="text-xs text-gray-500">Both teams need equal rosters. Completed results cannot be changed here.</p><button onClick={saveEditedRoster} disabled={saving || editRosterA.length < 2 || editRosterA.length !== editRosterB.length} className="bg-emerald-500 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl text-sm font-semibold">{saving ? 'Saving...' : 'Save teams & recreate schedule'}</button></div>
        </section>
      )}

      <div className="grid lg:grid-cols-[280px_minmax(0,1fr)] gap-5">
        <aside className="space-y-2">
          <div className="flex items-center justify-between px-1"><h2 className="font-semibold text-gray-900">Challenges</h2><button onClick={loadData} className="p-2 text-gray-400 hover:text-gray-800"><RefreshCw className="w-4 h-4" /></button></div>
          {loading ? <div className="h-28 bg-gray-200 animate-pulse rounded-xl" /> : challenges.length === 0 ? <div className="bg-white border border-dashed border-gray-200 rounded-xl p-6 text-center text-sm text-gray-400">No challenges yet.</div> : challenges.map((challenge) => {
            const a = sideName(challenge.groups.find((row) => row.side === 'A'), 'Team A'); const b = sideName(challenge.groups.find((row) => row.side === 'B'), 'Team B');
            return <button key={challenge.id} onClick={() => setSelectedId(challenge.id)} className={`w-full text-left p-3 rounded-xl border transition-all ${challenge.id === selectedId ? 'bg-emerald-50 border-emerald-300' : 'bg-white border-gray-200 hover:border-gray-300'}`}><p className="font-semibold text-gray-900 break-words">{challenge.title}</p><p className="text-xs text-gray-500 mt-1 break-words">{a} vs {b}</p><p className="text-xs text-gray-400 mt-2">{challenge.event_date} · {challenge.status.replace('_', ' ')}</p></button>;
          })}
        </aside>

        <main className="min-w-0">
          {!selected ? <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center"><Swords className="w-10 h-10 text-gray-300 mx-auto mb-3" /><p className="text-gray-500">Select a challenge to see its fixtures.</p></div> : (
            <div className="space-y-4">
              <section className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="p-4 sm:p-5 bg-emerald-50 border-b border-emerald-100"><div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3"><div><div className="flex items-center gap-2 flex-wrap"><h2 className="text-xl font-bold text-gray-900">{selected.title}</h2>{isOrganiser && <span className="inline-flex items-center gap-1 bg-white border border-emerald-200 text-emerald-700 px-2 py-1 rounded-lg text-xs"><ShieldCheck className="w-3.5 h-3.5" />Organiser</span>}{!selected.counts_for_rankings && <span className="bg-amber-100 text-amber-700 px-2 py-1 rounded-lg text-xs">Exhibition</span>}</div><div className="flex flex-wrap gap-3 text-xs text-gray-500 mt-2"><span className="flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{selected.event_date}</span><span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{selected.start_time.slice(0, 5)}</span><span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{selected.venue}</span></div></div><div className="flex items-center gap-2 flex-wrap"><span className="bg-white border border-emerald-200 px-3 py-2 rounded-xl text-sm font-semibold text-emerald-700">{leaderLabel()}</span></div></div></div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4 sm:p-6"><div className="text-center min-w-0"><p className="font-bold text-gray-900 break-words">{sideName(selectedSideA, 'Team A')}</p><p className="text-3xl font-bold text-sky-600 mt-2">{standings.winsA}</p><p className="text-xs text-gray-400">fixture wins · {standings.pointsA - standings.pointsB >= 0 ? '+' : ''}{standings.pointsA - standings.pointsB} diff</p></div><div className="text-gray-300 font-bold">vs</div><div className="text-center min-w-0"><p className="font-bold text-gray-900 break-words">{sideName(selectedSideB, 'Team B')}</p><p className="text-3xl font-bold text-rose-600 mt-2">{standings.winsB}</p><p className="text-xs text-gray-400">fixture wins · {standings.pointsB - standings.pointsA >= 0 ? '+' : ''}{standings.pointsB - standings.pointsA} diff</p></div></div>
                <div className="grid grid-cols-3 border-t border-gray-100 text-center text-xs"><div className="p-3"><b className="block text-gray-900 text-base">{standings.completed}</b><span className="text-gray-400">Completed</span></div><div className="p-3 border-x border-gray-100"><b className="block text-gray-900 text-base">{selected.fixtures.length - standings.completed}</b><span className="text-gray-400">Remaining</span></div><div className="p-3"><b className="block text-gray-900 text-base">{regularRoundCount}</b><span className="text-gray-400">Rounds{extraMatchCount > 0 ? ` + ${extraMatchCount} extra` : ''}</span></div></div>
              </section>

              <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 space-y-5">
                <div className="flex items-start justify-between gap-3 flex-wrap"><div><h3 className="font-bold text-gray-900">Challenge results</h3><p className="text-xs text-gray-500 mt-1">Player results include regular and extra matches. Completed matches also count toward overall rankings.</p></div>{topPerformer && <span className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-800">Top performer: {topPerformer.name} · {topPerformer.wins}/{topPerformer.played} wins</span>}</div>
                <div className="grid sm:grid-cols-2 gap-3 text-sm">
                  {(['A', 'B'] as TeamLabel[]).map((side) => <div key={side} className={`rounded-xl p-3 border ${side === 'A' ? 'bg-sky-50 border-sky-100' : 'bg-rose-50 border-rose-100'}`}><p className="font-semibold text-gray-900">{side === 'A' ? sideName(selectedSideA, 'Team A') : sideName(selectedSideB, 'Team B')}</p><p className="mt-1 text-gray-600">{side === 'A' ? standings.winsA : standings.winsB} wins · {side === 'A' ? standings.pointsA : standings.pointsB} points · {side === 'A' ? standings.pointsA - standings.pointsB : standings.pointsB - standings.pointsA} point difference</p></div>)}
                </div>
                {roundResults.length > 0 && <div><h4 className="text-sm font-semibold text-gray-800 mb-2">Results by round</h4><div className="flex flex-wrap gap-2">{roundResults.map((round) => <span key={round.round} className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">Round {round.round}: <b className="text-sky-700">{round.winsA}</b>–<b className="text-rose-700">{round.winsB}</b></span>)}</div></div>}
                <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b border-gray-200 text-xs text-gray-500"><th className="py-2 text-left">Player</th><th className="py-2 text-left">Team / seed</th><th className="py-2 text-right">Played</th><th className="py-2 text-right">W–L</th><th className="py-2 text-right">Win rate</th><th className="py-2 text-right">Points</th><th className="py-2 text-right">Difference</th></tr></thead><tbody>{playerResults.map((player) => <tr key={player.id} className="border-b border-gray-100 last:border-0"><td className="py-2.5 font-medium text-gray-900">{player.name}</td><td className="py-2.5 text-gray-600">{player.side === 'A' ? sideName(selectedSideA, 'Team A') : sideName(selectedSideB, 'Team B')} · #{player.seed}</td><td className="py-2.5 text-right tabular-nums">{player.played}</td><td className="py-2.5 text-right tabular-nums">{player.wins}–{player.played - player.wins}</td><td className="py-2.5 text-right tabular-nums">{player.played ? Math.round(player.wins / player.played * 100) : 0}%</td><td className="py-2.5 text-right tabular-nums">{player.pointsFor}–{player.pointsAgainst}</td><td className="py-2.5 text-right tabular-nums">{player.pointsFor - player.pointsAgainst >= 0 ? '+' : ''}{player.pointsFor - player.pointsAgainst}</td></tr>)}</tbody></table></div>
                {playerResults.some((player) => player.partners.size > 0) && <details className="text-sm"><summary className="cursor-pointer font-semibold text-gray-800">Partnership results</summary><div className="grid sm:grid-cols-2 gap-2 mt-3">{playerResults.flatMap((player) => [...player.partners.entries()].filter(([id]) => player.id < id).map(([id, pair]) => <div key={`${player.id}-${id}`} className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2"><span className="font-medium text-gray-900">{player.name} + {pair.name}</span><span className="block text-xs text-gray-500">{pair.wins} wins · {pair.played - pair.wins} losses · {pair.played} played</span></div>))}</div></details>}
                {standings.completed === 0 && <p className="text-sm text-gray-400">Enter a match result to see team and individual progress.</p>}
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
                    {standings.completed === 0 && <button onClick={openRosterEditor} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-600 hover:border-emerald-300 rounded-lg text-xs font-semibold disabled:opacity-40"><RefreshCw className="w-3.5 h-3.5" />Edit teams & seeds</button>}
                    <button onClick={deleteChallenge} disabled={saving} className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-50 border border-red-200 text-red-700 hover:bg-red-100 rounded-lg text-xs font-semibold disabled:opacity-40">
                      <Trash2 className="w-3.5 h-3.5" />Delete whole challenge
                    </button>
                  </div>
                )}
              </div>

              {visibleRounds.map(({ round, fixtures }) => { const extraRound = fixtures.every((fixture) => fixture.is_extra); return <section key={round} className={`bg-white border rounded-2xl p-4 ${extraRound ? 'border-violet-200' : 'border-gray-200'}`}><h3 className="font-semibold text-gray-900 mb-3">{extraRound ? 'Extra Match' : `Round ${round}`}</h3><div className="grid xl:grid-cols-2 gap-3">{fixtures.map((fixture) => <FixtureCard key={fixture.id} fixture={fixture} groupA={sideName(selectedSideA, 'Team A')} groupB={sideName(selectedSideB, 'Team B')} canSubmit={isOrganiser || (isRosterPlayer && fixture.status === 'scheduled')} isOrganiser={isOrganiser} onResult={() => openResult(fixture)} onClear={() => clearResult(fixture)} onDelete={() => deleteFixture(fixture)} />)}</div></section>; })}
            </div>
          )}
        </main>
      </div>

      {resultFixture && selected && <ResultModal fixture={resultFixture} groupA={sideName(selectedSideA, 'Team A')} groupB={sideName(selectedSideB, 'Team B')} scoreA={scoreA} scoreB={scoreB} onScoreA={setScoreA} onScoreB={setScoreB} onSave={saveResult} onClose={() => setResultFixture(null)} saving={saving} />}
      {showExtraMatch && selected && <ExtraMatchModal challenge={selected} sideA={selectedSideA} sideB={selectedSideB} form={extraForm} onToggle={toggleExtraPlayer} onCourt={(courtNumber) => setExtraForm((current) => ({ ...current, courtNumber }))} onTime={(scheduledAt) => setExtraForm((current) => ({ ...current, scheduledAt }))} onRematch={(allowRematch) => setExtraForm((current) => ({ ...current, allowRematch }))} onSave={addExtraMatch} onClose={() => setShowExtraMatch(false)} saving={saving} />}
    </div>
  );
}

function TeamRosterEditor({ side, groups, players, roster, onToggle, otherRoster, teamName, onTeamName, onMove, nameEditable = true }: {
  side: TeamLabel; groups: GroupWithMembers[]; players: PlayerChoice[]; roster: string[];
  onToggle: (id: string) => void; otherRoster: string[]; teamName: string; onTeamName: (value: string) => void;
  onMove?: (index: number, direction: -1 | 1) => void; nameEditable?: boolean;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const [search, setSearch] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const label = teamName.trim() || (side === 'A' ? 'Team 1' : 'Team 2');
  const playerById = new Map(players.map((choice) => [choice.profile.id, choice.profile]));
  const visiblePlayers = players.filter((choice) => !otherRoster.includes(choice.profile.id)
    && (!groupFilter || (groupFilter === 'ungrouped' ? choice.groupIds.length === 0 : choice.groupIds.includes(groupFilter)))
    && `${choice.profile.full_name} ${choice.groupNames.join(' ')} ${choice.groupNames.length ? '' : 'no group'}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return (
    <div className={`border rounded-2xl p-4 ${side === 'A' ? 'border-sky-200 bg-sky-50' : 'border-rose-200 bg-rose-50'}`}>
      {nameEditable ? <><label className="block text-xs font-semibold text-gray-500" htmlFor={`challenge-team-${side}`}>{side === 'A' ? 'First team name' : 'Second team name'}</label><input id={`challenge-team-${side}`} value={teamName} onChange={(event) => onTeamName(event.target.value)} placeholder={side === 'A' ? 'e.g. Strikers' : 'e.g. Smashers'} className="w-full mt-1 bg-white border border-gray-200 rounded-xl px-3 py-2.5 text-sm" /></> : <p className="font-semibold text-gray-900">{label}</p>}
      <div className="flex items-center justify-between gap-2 mt-4">
        <p className="text-sm font-semibold text-gray-800">{roster.length} players selected</p>
        <button type="button" onClick={() => setShowPicker(true)} className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-white border border-gray-200 text-emerald-700 text-sm font-semibold"><Plus className="w-4 h-4" />Add players</button>
      </div>
      <p className="text-xs text-gray-500 mt-2">Selection order sets seeds. Players without a group are available too.</p>
      {roster.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">Add players to build {label}.</p> : (
        <ol className="space-y-1.5 mt-3 max-h-72 overflow-y-auto">
          {roster.map((id, index) => <li key={id} className="bg-white border border-gray-100 rounded-xl p-2 flex items-center gap-2">
            <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold">#{index + 1}</span>
            <span className="flex-1 text-sm font-medium text-gray-900 break-words">{playerName(playerById.get(id))}</span>
            {onMove && <><button type="button" onClick={() => onMove(index, -1)} disabled={index === 0} aria-label={`Move ${playerName(playerById.get(id))} seed up`} className="p-1 text-gray-500 disabled:opacity-30"><ArrowUp className="w-4 h-4" /></button><button type="button" onClick={() => onMove(index, 1)} disabled={index === roster.length - 1} aria-label={`Move ${playerName(playerById.get(id))} seed down`} className="p-1 text-gray-500 disabled:opacity-30"><ArrowDown className="w-4 h-4" /></button></>}
            <button type="button" onClick={() => onToggle(id)} aria-label={`Remove ${playerName(playerById.get(id))} from ${label}`} className="p-1 text-red-400"><X className="w-4 h-4" /></button>
          </li>)}
        </ol>
      )}
      {showPicker && <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-6" onKeyDown={(event) => { if (event.key === 'Escape') setShowPicker(false); }}>
        <section role="dialog" aria-modal="true" aria-label={`Choose players for ${label}`} className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
          <header className="p-4 border-b border-gray-100 flex items-center justify-between gap-3">
            <div><h3 className="font-bold text-gray-900">Add players to {label}</h3><p className="text-xs text-gray-500 mt-1">Search all players, including those without a group. Each selection receives the next seed.</p></div>
            <button type="button" onClick={() => setShowPicker(false)} aria-label="Close player picker" className="p-2 text-gray-400"><X className="w-5 h-5" /></button>
          </header>
          <div className="p-4 grid sm:grid-cols-2 gap-3 border-b border-gray-100">
            <input autoFocus aria-label="Search players" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by player name or group..." className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm" />
            <select aria-label="Filter players by group" value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm">
              <option value="">All players</option><option value="ungrouped">No group</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>
          </div>
          <div className="overflow-y-auto min-h-0 p-4 space-y-2">
            <p className="text-xs text-gray-500">{visiblePlayers.length} matching players. Players on the other team are excluded.</p>
            {visiblePlayers.length === 0 && <p className="py-6 text-center text-gray-400">No players match. Try another name or select All players.</p>}
            {visiblePlayers.map((choice) => {
              const seedIndex = roster.indexOf(choice.profile.id);
              return <label key={choice.profile.id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer ${seedIndex >= 0 ? 'bg-emerald-50 border-emerald-300' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="checkbox" checked={seedIndex >= 0} onChange={() => onToggle(choice.profile.id)} aria-label={`Select ${choice.profile.full_name}`} className="w-4 h-4 accent-emerald-600" />
                <span className="flex-1 min-w-0"><span className="block font-medium text-sm text-gray-900 break-words">{choice.profile.full_name}</span><span className="block text-xs text-gray-500 break-words">{choice.groupNames.join(', ') || 'No group'}</span></span>
                <span className={`text-xs rounded px-2 py-1 ${seedIndex >= 0 ? 'bg-emerald-100 text-emerald-700 font-bold' : skillLevelColor(choice.profile.skill_level)}`}>{seedIndex >= 0 ? `Seed #${seedIndex + 1}` : skillLevelLabel(choice.profile.skill_level)}</span>
              </label>;
            })}
          </div>
          <footer className="p-4 border-t border-gray-100 flex items-center justify-between gap-3"><span className="text-sm text-gray-600">{roster.length} selected for {label}</span><button type="button" onClick={() => setShowPicker(false)} className="bg-emerald-500 text-white rounded-xl px-5 py-2.5 text-sm font-semibold">Done</button></footer>
        </section>
      </div>}
    </div>
  );
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
  sideA?: CompetitionGroup & { group: Group | null };
  sideB?: CompetitionGroup & { group: Group | null };
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

  return <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"><div className="bg-white w-full sm:max-w-3xl rounded-t-2xl sm:rounded-2xl max-h-[95vh] overflow-y-auto"><div className="sticky top-0 z-10 bg-white flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-gray-100"><div><h3 className="font-bold text-gray-900 flex items-center gap-2"><Plus className="w-4 h-4 text-violet-600" />Add Extra Match</h3><p className="text-xs text-gray-500 mt-1">Adds a separate fixture without changing the generated seeded schedule.</p></div><button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button></div><div className="p-4 sm:p-5 space-y-4"><div className="grid sm:grid-cols-2 gap-3"><label className="text-xs font-semibold text-gray-500">Court<select value={form.courtNumber} onChange={(event) => onCourt(Number(event.target.value))} className="block w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900">{Array.from({ length: challenge.court_count }, (_, index) => <option key={index + 1} value={index + 1}>Court {index + 1}</option>)}</select></label><label className="text-xs font-semibold text-gray-500">Scheduled time<input type="datetime-local" value={form.scheduledAt} onChange={(event) => onTime(event.target.value)} className="block w-full mt-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900" /></label></div><div className="grid md:grid-cols-2 gap-3">{sidePicker('A', rosterA, form.playerA, sideName(sideA, 'Team A'))}{sidePicker('B', rosterB, form.playerB, sideName(sideB, 'Team B'))}</div><label className="flex items-start gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.allowRematch} onChange={(event) => onRematch(event.target.checked)} className="mt-0.5 w-4 h-4 accent-violet-600" /><span><b className="block text-gray-800">Allow intentional rematch</b>Use only when these exact pairs should play again.</span></label><p className="text-xs text-gray-400">This match counts toward the challenge score and follows the challenge's ranking setting.</p></div><div className="sticky bottom-0 bg-white border-t border-gray-100 p-4 flex justify-end gap-2"><button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm">Cancel</button><button onClick={onSave} disabled={!canSave} className="px-5 py-2.5 bg-violet-600 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">{saving ? 'Adding...' : 'Add Extra Match'}</button></div></div></div>;
}

function ResultModal({ fixture, groupA, groupB, scoreA, scoreB, onScoreA, onScoreB, onSave, onClose, saving }: { fixture: CompetitionFixture; groupA: string; groupB: string; scoreA: string; scoreB: string; onScoreA: (value: string) => void; onScoreB: (value: string) => void; onSave: () => void; onClose: () => void; saving: boolean }) {
  const playersA = (fixture.players || []).filter((player) => player.side === 'A'); const playersB = (fixture.players || []).filter((player) => player.side === 'B');
  return <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4"><div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-4 sm:p-5 max-h-[95vh] overflow-y-auto"><div className="flex justify-between items-start"><div><h3 className="font-bold text-gray-900">Record Fixture Result</h3><p className="text-xs text-gray-500 mt-1">Round {fixture.round_number} · Court {fixture.court_number}</p></div><button onClick={onClose} className="p-1 text-gray-400"><X className="w-5 h-5" /></button></div><div className="grid grid-cols-2 gap-3 mt-4"><TeamBox name={groupA} side="A" players={playersA} winner={Number(scoreA) > Number(scoreB)} /><TeamBox name={groupB} side="B" players={playersB} winner={Number(scoreB) > Number(scoreA)} /></div><div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center mt-4"><input type="number" min="0" value={scoreA} onChange={(e) => onScoreA(e.target.value)} placeholder="A" className="min-w-0 w-full bg-gray-50 border border-sky-200 rounded-xl px-3 py-3 text-center text-xl font-bold" /><span className="text-gray-300 font-bold">vs</span><input type="number" min="0" value={scoreB} onChange={(e) => onScoreB(e.target.value)} placeholder="B" className="min-w-0 w-full bg-gray-50 border border-rose-200 rounded-xl px-3 py-3 text-center text-xl font-bold" /></div><p className="text-xs text-gray-400 text-center mt-2">The higher score automatically wins the fixture.</p><div className="flex gap-2 mt-5"><button onClick={onClose} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm">Cancel</button><button onClick={onSave} disabled={saving} className="flex-1 bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-sm font-semibold">{saving ? 'Saving...' : 'Save Result'}</button></div></div></div>;
}
