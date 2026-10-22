import { Component, useEffect, useState, useCallback, type ErrorInfo, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { Session, Court, Profile, Match, MatchTeamWithPlayers, Environment } from '../lib/supabase';
import { compareSkillLevels, skillLevelColor, skillLevelShortLabel } from '../lib/skillLevels';
import { useAuth } from '../context/AuthContext';
import {
  Play, Trophy, X, Shuffle, UserMinus,
  Clock, AlertTriangle, RefreshCw, Users, Zap, RotateCcw, Hash, ClipboardList, ArrowRightLeft, Trash2
} from 'lucide-react';

interface MatchWithDetails extends Match {
  court: Court;
  teams: MatchTeamWithPlayers[];
}

interface AvailablePlayer extends Profile {
  in_match?: boolean;
}

interface CourtQueue {
  id: string;
  session_id: string;
  court_id: string;
  player_id: string;
  position: number;
  consecutive_games: number;
  status: 'playing' | 'waiting' | 'resting';
}

interface CourtWithQueue {
  court: Court;
  playing: (CourtQueue & { profile: Profile })[];
  waiting: (CourtQueue & { profile: Profile })[];
}

interface SmartAssignment {
  court: Court;
  teamA: [Profile, Profile];
  teamB: [Profile, Profile];
  waiting: Profile[];
}

type SmartAssignmentSlot = {
  area: 'teamA' | 'teamB' | 'waiting';
  index: number;
  player: Profile;
};

interface ActiveMatchEditState {
  match: MatchWithDetails;
  teamA: [Profile, Profile];
  teamB: [Profile, Profile];
  waiting: (CourtQueue & { profile: Profile })[];
  courtNames: Record<string, string>;
}

type TeamEditSlot = {
  area: 'A' | 'B' | 'waiting';
  index: number;
  player: Profile;
  queue?: CourtQueue & { profile: Profile };
};

// -----------------------------------------------------------------------------
// Rules:
// 1. Every court that gets players must have at least 4 (otherwise matches can't start).
// 2. Use only as many courts as can each hold 4+ players.
// 3. Interleave by skill level so every court has a balanced mix.
function distributePlayersToCourts(players: Profile[], courts: Court[]): Map<string, Profile[]> {
  const n = players.length;
  if (n < 4 || courts.length === 0) return new Map();

  // How many courts can we actually fill with at least 4 players each?
  const maxCourts = Math.min(courts.length, Math.floor(n / 4));
  const activeCourts = courts.slice(0, maxCourts);

  const sorted = [...players].sort((a, b) => compareSkillLevels(a.skill_level, b.skill_level));

  const result = new Map<string, Profile[]>(activeCourts.map((c) => [c.id, []]));
  // Interleave so each court gets a balanced skill spread
  sorted.forEach((p, i) => {
    const courtId = activeCourts[i % maxCourts].id;
    result.get(courtId)!.push(p);
  });
  return result;
}
// -----------------------------------------------------------------------------
// Returns [teamA_ids, teamB_ids] for a set of 4 players given prior pair history.
// A "pair" is a sorted tuple of two player ids that have been on the SAME team.
// We try to find an assignment where neither pair has played together recently.
// If all combinations are exhausted, we fall back to the least-recently-used combo.
type PairHistory = Set<string>;

function pairKey(a: string, b: string): string {
  return [a, b].sort().join('|');
}

function buildTeams(
  playerIds: [string, string, string, string],
  partnerHistory: PairHistory,
  opponentHistory: PairHistory
): { teamA: [string, string]; teamB: [string, string] } {
  const [p0, p1, p2, p3] = playerIds;

  // All 3 ways to split 4 players into 2 pairs:
  const splits: Array<{ teamA: [string, string]; teamB: [string, string] }> = [
    { teamA: [p0, p1], teamB: [p2, p3] },
    { teamA: [p0, p2], teamB: [p1, p3] },
    { teamA: [p0, p3], teamB: [p1, p2] },
  ];

  // Score each split: lower is better
  // +2 for each partner pair that already played together
  // +1 for each opponent pair that already faced each other
  const scored = splits.map((s) => {
    const partnerPenalty =
      (partnerHistory.has(pairKey(s.teamA[0], s.teamA[1])) ? 2 : 0) +
      (partnerHistory.has(pairKey(s.teamB[0], s.teamB[1])) ? 2 : 0);
    const opponentPenalty =
      (opponentHistory.has(pairKey(s.teamA[0], s.teamB[0])) ? 1 : 0) +
      (opponentHistory.has(pairKey(s.teamA[0], s.teamB[1])) ? 1 : 0) +
      (opponentHistory.has(pairKey(s.teamA[1], s.teamB[0])) ? 1 : 0) +
      (opponentHistory.has(pairKey(s.teamA[1], s.teamB[1])) ? 1 : 0);
    return { ...s, score: partnerPenalty + opponentPenalty };
  });

  // Pick the split with the lowest score (ties broken by original order)
  scored.sort((a, b) => a.score - b.score);
  return scored[0];
}

// Extract partner and opponent pair history from completed matches in this session
function extractPairHistory(completedMatches: MatchWithDetails[]): { partnerHistory: PairHistory; opponentHistory: PairHistory } {
  const partnerHistory: PairHistory = new Set();
  const opponentHistory: PairHistory = new Set();
  for (const m of completedMatches) {
    const tA = m.teams?.find((t) => t.team_label === 'A');
    const tB = m.teams?.find((t) => t.team_label === 'B');
    const aIds = (tA?.players || []).map((p) => p.player_id);
    const bIds = (tB?.players || []).map((p) => p.player_id);
    // Partners
    for (let i = 0; i < aIds.length; i++) {
      for (let j = i + 1; j < aIds.length; j++) partnerHistory.add(pairKey(aIds[i], aIds[j]));
    }
    for (let i = 0; i < bIds.length; i++) {
      for (let j = i + 1; j < bIds.length; j++) partnerHistory.add(pairKey(bIds[i], bIds[j]));
    }
    // Opponents
    for (const a of aIds) {
      for (const b of bIds) opponentHistory.add(pairKey(a, b));
    }
  }
  return { partnerHistory, opponentHistory };
}

function sessionDateTime(session: Session, time: string) {
  return new Date(`${session.session_date}T${time}`);
}

function isSessionManageWindowOpen(session: Session) {
  const now = new Date();
  const start = sessionDateTime(session, session.start_time);
  const end = sessionDateTime(session, session.end_time);
  return now >= start && now <= end;
}

function inferWinnerFromScores(scoreAValue: string, scoreBValue: string): 'A' | 'B' | '' {
  const parsedA = scoreAValue.trim() === '' ? null : Number(scoreAValue);
  const parsedB = scoreBValue.trim() === '' ? null : Number(scoreBValue);

  if (parsedA === null || parsedB === null || Number.isNaN(parsedA) || Number.isNaN(parsedB)) return '';
  if (parsedA >= 21 && parsedA > parsedB) return 'A';
  if (parsedB >= 21 && parsedB > parsedA) return 'B';
  return '';
}

class MatchManagerErrorBoundary extends Component<
  { children: ReactNode },
  { error: string }
> {
  state = { error: '' };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || 'Unexpected Match Manager error' };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Match Manager crashed', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="p-4 sm:p-6 max-w-4xl mx-auto">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
            <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
            <h1 className="text-red-700 font-bold text-xl">Match Manager crashed</h1>
            <p className="text-red-600 text-sm mt-2 break-words">{this.state.error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 inline-flex items-center gap-2 bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-xl text-sm font-semibold"
            >
              <RefreshCw className="w-4 h-4" /> Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function MatchManager(props: { envFilter?: 'all' | Environment }) {
  return (
    <MatchManagerErrorBoundary>
      <MatchManagerContent {...props} />
    </MatchManagerErrorBoundary>
  );
}

function MatchManagerContent({ envFilter = 'all' }: { envFilter?: 'all' | Environment }) {
  const { user, isAdmin, isSuperAdmin } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string>('');
  const [courts, setCourts] = useState<Court[]>([]);
  const [availablePlayers, setAvailablePlayers] = useState<AvailablePlayer[]>([]);
  const [activeMatches, setActiveMatches] = useState<MatchWithDetails[]>([]);
  const [courtQueues, setCourtQueues] = useState<(CourtQueue & { profile: Profile })[]>([]);
  const [sessionGameCounts, setSessionGameCounts] = useState<Record<string, { name: string; count: number; skill: string }>>({});
  const [completedMatches, setCompletedMatches] = useState<MatchWithDetails[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [pageError, setPageError] = useState('');
  const [actionError, setActionError] = useState('');

  // Create match state
  const [showCreate, setShowCreate] = useState(false);
  const [showQuickMatch, setShowQuickMatch] = useState(false);
  const [showLogMatch, setShowLogMatch] = useState(false);
  const [selectedCourt, setSelectedCourt] = useState('');
  const [teamA, setTeamA] = useState<AvailablePlayer[]>([]);
  const [teamB, setTeamB] = useState<AvailablePlayer[]>([]);
  const [teamAName, setTeamAName] = useState('');
  const [teamBName, setTeamBName] = useState('');
  const [smartAssignments, setSmartAssignments] = useState<SmartAssignment[]>([]);
  const [selectedSmartPlayer, setSelectedSmartPlayer] = useState<{ courtId: string; playerId: string } | null>(null);

  // Result modal
  const [resultMatch, setResultMatch] = useState<MatchWithDetails | null>(null);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');
  const [winner, setWinner] = useState<'A' | 'B' | ''>('');
  const [editingActiveMatch, setEditingActiveMatch] = useState<ActiveMatchEditState | null>(null);
  const [selectedActiveEditPlayer, setSelectedActiveEditPlayer] = useState<{ area: 'A' | 'B' | 'waiting'; playerId: string } | null>(null);
  const [abandonConfirm, setAbandonConfirm] = useState<string | null>(null);
  const [deleteMatchConfirm, setDeleteMatchConfirm] = useState<MatchWithDetails | null>(null);

  useEffect(() => {
    async function loadManageableSessions() {
      if (!user) return;
      setLoadingSessions(true);
      setPageError('');

      let query = supabase
        .from('sessions')
        .select('*, group:groups(*)')
        .in('status', ['open', 'in_progress'])
        .order('session_date', { ascending: false })
        .order('start_time', { ascending: false });

      if (envFilter !== 'all') query = query.eq('environment', envFilter);

      const { data, error } = await query;
      if (error) {
        setSessions([]);
        setSelectedSession('');
        setPageError(error.message);
        setLoadingSessions(false);
        return;
      }
      let list = (data || []) as Session[];

      if (!isAdmin) {
        const { data: availabilityRows, error: availabilityError } = await supabase
          .from('session_availability')
          .select('session_id')
          .eq('player_id', user.id)
          .eq('available', true);
        if (availabilityError) {
          setSessions([]);
          setSelectedSession('');
          setPageError(availabilityError.message);
          setLoadingSessions(false);
          return;
        }
        const availableSessionIds = new Set(((availabilityRows as any[]) || []).map((row) => row.session_id));
        list = list.filter((session) => availableSessionIds.has(session.id) && isSessionManageWindowOpen(session));
      }

      setSessions(list);
      setSelectedSession((current) => list.some((session) => session.id === current) ? current : list[0]?.id || '');
      if (list.length === 0) {
        setCourts([]);
        setAvailablePlayers([]);
        setActiveMatches([]);
        setCourtQueues([]);
        setSessionGameCounts({});
        setCompletedMatches([]);
      }
      setLoadingSessions(false);
    }

    loadManageableSessions();
  }, [envFilter, user, isAdmin]);

  const loadSessionData = useCallback(async (sessionId: string) => {
    if (!sessionId) return;
    setLoading(true);
    setPageError('');
    try {
    const [courtsRes, availRes, matchesRes, queuesRes, allMatchesRes, completedRes] = await Promise.all([
      supabase.from('courts').select('*').eq('session_id', sessionId).order('created_at'),
      supabase
        .from('session_availability')
        .select('*, profile:profiles(*)')
        .eq('session_id', sessionId)
        .eq('available', true),
      supabase
        .from('matches')
        .select(`*, court:courts(*), teams:match_teams(*, players:match_team_players(*, profile:profiles(*)))`)
        .eq('session_id', sessionId)
        .eq('status', 'active'),
      supabase
        .from('court_queues')
        .select('*, profile:profiles(*)')
        .eq('session_id', sessionId)
        .order('position'),
      // All matches (active + completed) to count games per player
      supabase
        .from('matches')
        .select(`teams:match_teams(players:match_team_players(player_id, profile:profiles(full_name, skill_level)))`)
        .eq('session_id', sessionId)
        .in('status', ['active', 'completed']),
      // Completed matches with full detail for history notes
      supabase
        .from('matches')
        .select(`*, court:courts(*), teams:match_teams(*, players:match_team_players(*, profile:profiles(*)))`)
        .eq('session_id', sessionId)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false }),
    ]);

    const loadError = courtsRes.error || availRes.error || matchesRes.error || queuesRes.error || allMatchesRes.error || completedRes.error;
    if (loadError) {
      setPageError(loadError.message);
      setCourts([]);
      setAvailablePlayers([]);
      setActiveMatches([]);
      setCourtQueues([]);
      setSessionGameCounts({});
      setCompletedMatches([]);
      setLoading(false);
      return;
    }

    const courtList: Court[] = courtsRes.data || [];
    setCourts(courtList);

    const inMatchIds = new Set<string>();
    for (const m of (matchesRes.data as MatchWithDetails[]) || []) {
      for (const team of m.teams || []) {
        for (const p of team.players || []) inMatchIds.add(p.player_id);
      }
    }
    const players = ((availRes.data as any) || []).map((a: any) => ({
      ...a.profile,
      in_match: inMatchIds.has(a.profile?.id),
    })).filter((p: AvailablePlayer) => Boolean(p?.id));
    setAvailablePlayers(players);
    setActiveMatches((matchesRes.data as MatchWithDetails[]) || []);
    setCourtQueues((queuesRes.data as any) || []);

    // Build per-player game count for this session
    const counts: Record<string, { name: string; count: number; skill: string }> = {};
    for (const match of (allMatchesRes.data as any) || []) {
      for (const team of match.teams || []) {
        for (const mp of team.players || []) {
          const id = mp.player_id;
          if (!counts[id]) counts[id] = { name: mp.profile?.full_name || '?', count: 0, skill: mp.profile?.skill_level || 'level_5' };
          counts[id].count += 1;
        }
      }
    }
    setSessionGameCounts(counts);
    setCompletedMatches((completedRes.data as MatchWithDetails[]) || []);

    // Auto-select first available court for new match form
    const avail = courtList.find((c) => c.status === 'available');
    if (avail && !showCreate) setSelectedCourt(avail.id);

    } catch (err: any) {
      setPageError(err?.message || 'Failed to load match management data.');
      setCourts([]);
      setAvailablePlayers([]);
      setActiveMatches([]);
      setCourtQueues([]);
      setSessionGameCounts({});
      setCompletedMatches([]);
    } finally {
      setLoading(false);
    }
  }, [showCreate]);

  useEffect(() => {
    if (selectedSession) loadSessionData(selectedSession);
  }, [selectedSession, loadSessionData]);
// -----------------------------------------------------------------------------
  async function smartAssignAll() {
    const availCourts = courts.filter((c) => c.status === 'available');
    const availCourtIds = availCourts.map((c) => c.id);

    if (!selectedSession || availCourts.length === 0) return;

    setLoading(true);

    try {
      const [{ data: activeMatchPlayers }, { data: existingQueues }] = await Promise.all([
        supabase
          .from('match_team_players')
          .select('player_id, match_team:match_teams!inner(match:matches!inner(session_id, status))')
          .eq('match_team.match.session_id', selectedSession)
          .eq('match_team.match.status', 'active'),
        supabase
          .from('court_queues')
          .select('*')
          .eq('session_id', selectedSession),
      ]);

      const alreadyPlaying = new Set((activeMatchPlayers || []).map((r: any) => r.player_id));
      const protectedQueuedPlayers = new Set(
        ((existingQueues || []) as CourtQueue[])
          .filter((q) => !availCourtIds.includes(q.court_id))
          .map((q) => q.player_id)
      );

      const freePlayersList = availablePlayers.filter(
        (p) => !alreadyPlaying.has(p.id) && !protectedQueuedPlayers.has(p.id)
      );

      if (freePlayersList.length < 4) return;

      const { partnerHistory, opponentHistory } = extractPairHistory(completedMatches);
      const distribution = distributePlayersToCourts(freePlayersList, availCourts);
      const preview: SmartAssignment[] = [];

      for (const court of availCourts) {
        const group = distribution.get(court.id);
        if (!group || group.length < 4) continue;

        const playing = group.slice(0, 4);
        const { teamA: tAIds, teamB: tBIds } = buildTeams(
          [playing[0].id, playing[1].id, playing[2].id, playing[3].id],
          partnerHistory,
          opponentHistory
        );
        const byId = new Map(group.map((p) => [p.id, p]));
        const tA = [byId.get(tAIds[0])!, byId.get(tAIds[1])!] as [Profile, Profile];
        const tB = [byId.get(tBIds[0])!, byId.get(tBIds[1])!] as [Profile, Profile];
        preview.push({
          court,
          teamA: tA,
          teamB: tB,
          waiting: group.filter((p) => !tAIds.includes(p.id) && !tBIds.includes(p.id)),
        });
      }

      setSmartAssignments(preview);
      setSelectedSmartPlayer(null);
    } finally {
      setLoading(false);
    }
  }

  async function startSmartAssignments() {
    if (!selectedSession || smartAssignments.length === 0) return;
    setLoading(true);
    setActionError('');

    try {
      const assignmentCourtIds = smartAssignments.map((a) => a.court.id);

      await supabase
        .from('court_queues')
        .delete()
        .eq('session_id', selectedSession)
        .in('court_id', assignmentCourtIds);

      for (const assignment of smartAssignments) {
        const group = [
          ...assignment.teamA,
          ...assignment.teamB,
          ...assignment.waiting,
        ];
        const inserts = group.map((p, i) => ({
          session_id: selectedSession,
          court_id: assignment.court.id,
          player_id: p.id,
          position: i,
          consecutive_games: 0,
          status: i < 4 ? ('playing' as const) : ('waiting' as const),
        }));
        const { error: queueError } = await supabase.from('court_queues').insert(inserts);
        if (queueError) throw queueError;

        await createActiveMatch(assignment.court.id, assignment.teamA.map((p) => p.id), assignment.teamB.map((p) => p.id));
      }

      if (isAdmin) {
        const { error: sessionError } = await supabase.from('sessions').update({ status: 'in_progress' }).eq('id', selectedSession);
        if (sessionError) throw sessionError;
      }
      setSmartAssignments([]);
      setSelectedSmartPlayer(null);
      await loadSessionData(selectedSession);
    } catch (error: any) {
      setActionError(error?.message || 'Could not start match. Please try again.');
      await loadSessionData(selectedSession);
    } finally {
      setLoading(false);
    }
  }

  function cancelSmartAssignments() {
    setSmartAssignments([]);
    setSelectedSmartPlayer(null);
  }

  function swapSmartAssignmentPlayers(courtId: string, firstPlayerId: string, secondPlayerId: string) {
    if (firstPlayerId === secondPlayerId) return;

    setSmartAssignments((prev) => prev.map((assignment) => {
      if (assignment.court.id !== courtId) return assignment;

      const slots: SmartAssignmentSlot[] = [
        { area: 'teamA' as const, index: 0, player: assignment.teamA[0] },
        { area: 'teamA' as const, index: 1, player: assignment.teamA[1] },
        { area: 'teamB' as const, index: 0, player: assignment.teamB[0] },
        { area: 'teamB' as const, index: 1, player: assignment.teamB[1] },
        ...assignment.waiting.map((player, index) => ({ area: 'waiting' as const, index, player })),
      ];
      const first = slots.find((slot) => slot.player.id === firstPlayerId);
      const second = slots.find((slot) => slot.player.id === secondPlayerId);
      if (!first || !second) return assignment;

      const nextTeamA = [...assignment.teamA] as [Profile, Profile];
      const nextTeamB = [...assignment.teamB] as [Profile, Profile];
      const nextWaiting = [...assignment.waiting];
      const setSlot = (slot: SmartAssignmentSlot, player: Profile) => {
        if (slot.area === 'teamA') nextTeamA[slot.index] = player;
        if (slot.area === 'teamB') nextTeamB[slot.index] = player;
        if (slot.area === 'waiting') nextWaiting[slot.index] = player;
      };

      setSlot(first, second.player);
      setSlot(second, first.player);

      return { ...assignment, teamA: nextTeamA, teamB: nextTeamB, waiting: nextWaiting };
    }));
  }

  function selectSmartPlayer(courtId: string, playerId: string) {
    if (!selectedSmartPlayer || selectedSmartPlayer.courtId !== courtId) {
      setSelectedSmartPlayer({ courtId, playerId });
      return;
    }

    if (selectedSmartPlayer.playerId === playerId) {
      setSelectedSmartPlayer(null);
      return;
    }

    swapSmartAssignmentPlayers(courtId, selectedSmartPlayer.playerId, playerId);
    setSelectedSmartPlayer(null);
  }

  function freePlayers() {
    const queuedIds = new Set(courtQueues.map((q) => q.player_id));

    return availablePlayers.filter(
      (p) =>
        !p.in_match &&
        !queuedIds.has(p.id) &&
        !teamA.find((t) => t.id === p.id) &&
        !teamB.find((t) => t.id === p.id)
    );
  }

  function shuffleTeams() {
    const free = freePlayers();
    if (free.length < 4) return;
    const shuffled = [...free].sort(() => Math.random() - 0.5).slice(0, 4);
    setTeamA([shuffled[0], shuffled[1]]);
    setTeamB([shuffled[2], shuffled[3]]);
  }

  function moveToTeam(player: AvailablePlayer, team: 'A' | 'B') {
    if (team === 'A') {
      if (teamA.length >= 2) return;
      setTeamA((prev) => [...prev, player]);
      setTeamB((prev) => prev.filter((p) => p.id !== player.id));
    } else {
      if (teamB.length >= 2) return;
      setTeamB((prev) => [...prev, player]);
      setTeamA((prev) => prev.filter((p) => p.id !== player.id));
    }
  }

  function removeFromTeam(playerId: string) {
    setTeamA((prev) => prev.filter((p) => p.id !== playerId));
    setTeamB((prev) => prev.filter((p) => p.id !== playerId));
  }

  function updateResultScore(team: 'A' | 'B', value: string) {
    const nextScoreA = team === 'A' ? value : scoreA;
    const nextScoreB = team === 'B' ? value : scoreB;

    if (team === 'A') setScoreA(value);
    if (team === 'B') setScoreB(value);

    const inferredWinner = inferWinnerFromScores(nextScoreA, nextScoreB);
    setWinner(inferredWinner);
  }

  async function updatePlayerStats(playerId: string, won: boolean) {
    const sessionEnvironment = sessions.find((s) => s.id === selectedSession)?.environment || 'prod';
    const { data: existing } = await supabase
      .from('player_stats')
      .select('*')
      .eq('player_id', playerId)
      .eq('environment', sessionEnvironment)
      .maybeSingle();

    if (existing) {
      await supabase.from('player_stats').update({
        wins: existing.wins + (won ? 1 : 0),
        losses: existing.losses + (won ? 0 : 1),
        total_matches: existing.total_matches + 1,
        updated_at: new Date().toISOString(),
      }).eq('player_id', playerId);
    } else {
      await supabase.from('player_stats').insert({
        player_id: playerId,
        wins: won ? 1 : 0,
        losses: won ? 0 : 1,
        total_matches: 1,
        environment: sessionEnvironment,
      });
    }
  }

  async function createActiveMatch(courtId: string, teamAIds: string[], teamBIds: string[], teamANameValue = '', teamBNameValue = '') {
    if (teamAIds.length !== 2 || teamBIds.length !== 2) {
      throw new Error('A match needs 2 players in each team.');
    }

    let matchId = '';
    let teamIds: string[] = [];
    try {
      const { data: match, error: matchError } = await supabase
        .from('matches')
        .insert({ session_id: selectedSession, court_id: courtId, status: 'active', created_by: user!.id })
        .select()
        .single();

      if (matchError) throw matchError;
      if (!match) throw new Error('Match was not created.');
      matchId = match.id;

      const [{ data: tA, error: tAError }, { data: tB, error: tBError }] = await Promise.all([
        supabase.from('match_teams').insert({ match_id: match.id, team_label: 'A', team_name: teamANameValue }).select().single(),
        supabase.from('match_teams').insert({ match_id: match.id, team_label: 'B', team_name: teamBNameValue }).select().single(),
      ]);
      if (tAError) throw tAError;
      if (tBError) throw tBError;
      if (!tA || !tB) throw new Error('Match teams were not created.');
      teamIds = [tA.id, tB.id];

      const playerRows = [
        ...teamAIds.map((playerId) => ({ match_team_id: tA.id, player_id: playerId })),
        ...teamBIds.map((playerId) => ({ match_team_id: tB.id, player_id: playerId })),
      ];
      const { error: playersError } = await supabase.from('match_team_players').insert(playerRows);
      if (playersError) throw playersError;

      const { error: courtError } = await supabase.from('courts').update({ status: 'in_use' }).eq('id', courtId);
      if (courtError) throw courtError;

      return match;
    } catch (error) {
      if (teamIds.length > 0) {
        await supabase.from('match_team_players').delete().in('match_team_id', teamIds);
        await supabase.from('match_teams').delete().in('id', teamIds);
      }
      if (matchId) {
        await supabase.from('matches').delete().eq('id', matchId);
      }
      throw error;
    }
  }

  async function createMatch() {
    if (!selectedCourt || teamA.length < 2 || teamB.length < 2) return;
    setLoading(true);
    setActionError('');

    try {
      await createActiveMatch(selectedCourt, teamA.map((p) => p.id), teamB.map((p) => p.id), teamAName, teamBName);
      if (isAdmin) {
        const { error: sessionError } = await supabase.from('sessions').update({ status: 'in_progress' }).eq('id', selectedSession);
        if (sessionError) throw sessionError;
      }

      setShowCreate(false);
      setTeamA([]);
      setTeamB([]);
      setTeamAName('');
      setTeamBName('');
      setSelectedCourt('');
      await loadSessionData(selectedSession);
    } catch (error: any) {
      setActionError(error?.message || 'Could not create match. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function createQuickMatch(courtId: string, teamAIds: string[], teamBIds: string[]) {
    setLoading(true);
    setActionError('');

    try {
      await createActiveMatch(courtId, teamAIds, teamBIds);
      if (isAdmin) {
        const { error: sessionError } = await supabase.from('sessions').update({ status: 'in_progress' }).eq('id', selectedSession);
        if (sessionError) throw sessionError;
      }
      setShowQuickMatch(false);
      await loadSessionData(selectedSession);
    } catch (error: any) {
      setActionError(error?.message || 'Could not start quick match.');
    } finally {
      setLoading(false);
    }
  }

  async function logCompletedMatch(courtId: string, teamAIds: string[], teamBIds: string[], winnerTeam: 'A' | 'B', scoreAValue: number, scoreBValue: number) {
    setLoading(true);
    setActionError('');

    try {
      const { data: match, error: matchError } = await supabase
        .from('matches')
        .insert({
          session_id: selectedSession,
          court_id: courtId,
          status: 'completed',
          winner_team: winnerTeam,
          score_a: scoreAValue,
          score_b: scoreBValue,
          created_by: user!.id,
          ended_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (matchError) throw matchError;
      if (!match) throw new Error('Completed match was not created.');

      const [{ data: tA, error: tAError }, { data: tB, error: tBError }] = await Promise.all([
        supabase.from('match_teams').insert({ match_id: match.id, team_label: 'A' }).select().single(),
        supabase.from('match_teams').insert({ match_id: match.id, team_label: 'B' }).select().single(),
      ]);
      if (tAError) throw tAError;
      if (tBError) throw tBError;
      if (!tA || !tB) throw new Error('Completed match teams were not created.');

      const { error: playersError } = await supabase.from('match_team_players').insert([
        ...teamAIds.map((playerId) => ({ match_team_id: tA.id, player_id: playerId })),
        ...teamBIds.map((playerId) => ({ match_team_id: tB.id, player_id: playerId })),
      ]);
      if (playersError) throw playersError;

      await Promise.all([
        ...teamAIds.map((playerId) => updatePlayerStats(playerId, winnerTeam === 'A')),
        ...teamBIds.map((playerId) => updatePlayerStats(playerId, winnerTeam === 'B')),
      ]);

      if (isAdmin) {
        await supabase.from('sessions').update({ status: 'in_progress' }).eq('id', selectedSession);
      }

      setShowLogMatch(false);
      await loadSessionData(selectedSession);
    } catch (error: any) {
      setActionError(error?.message || 'Could not log completed match.');
    } finally {
      setLoading(false);
    }
  }
// -----------------------------------------------------------------------------
  async function recordResult() {
    if (!resultMatch || !winner) return;
    setLoading(true);
    setActionError('');

    try {

    const winnerTeam = resultMatch.teams.find((t) => t.team_label === winner);
    const loserTeam = resultMatch.teams.find((t) => t.team_label !== winner);

    if (!winnerTeam || !loserTeam) {
      throw new Error('The selected match teams could not be loaded. Refresh and try again.');
    }

    const { error: resultError } = await supabase.from('matches').update({
      status: 'completed',
      winner_team: winner,
      score_a: parseInt(scoreA) || 0,
      score_b: parseInt(scoreB) || 0,
      ended_at: new Date().toISOString(),
    }).eq('id', resultMatch.id);
    if (resultError) throw resultError;

    const { error: courtError } = await supabase.from('courts').update({ status: 'available' }).eq('id', resultMatch.court_id);
    if (courtError) throw courtError;

    await Promise.all([
      ...(winnerTeam?.players || []).map((p) => updatePlayerStats(p.player_id, true)),
      ...(loserTeam?.players || []).map((p) => updatePlayerStats(p.player_id, false)),
    ]);

    const { data: queueRows } = await supabase
      .from('court_queues')
      .select('*')
      .eq('court_id', resultMatch.court_id)
      .order('position');

    if (queueRows && queueRows.length >= 4) {
      const queue = queueRows as CourtQueue[];
      const totalCourtPlayers = queue.length;
      const winnerIds = (winnerTeam.players || []).map((p) => p.player_id);
      const loserIds = (loserTeam.players || []).map((p) => p.player_id);
      const gamesPlayed = (playerId: string) => sessionGameCounts[playerId]?.count || 0;

      const { data: allCompleted } = await supabase
        .from('matches')
        .select(`*, court:courts(*), teams:match_teams(*, players:match_team_players(*, profile:profiles(*)))`)
        .eq('session_id', selectedSession)
        .eq('status', 'completed');

      const completedBeforeThisResult = ((allCompleted as MatchWithDetails[]) || [])
        .filter((m) => m.id !== resultMatch.id);
      const isFirstCompletedMatchOfSession = completedBeforeThisResult.length === 0;

      const createNextMatch = async (teamAIds: string[], teamBIds: string[]) => {
        if (teamAIds.length !== 2 || teamBIds.length !== 2) return;

        const { data: nextMatch } = await supabase
          .from('matches')
          .insert({ session_id: selectedSession, court_id: resultMatch.court_id, status: 'active', created_by: user!.id })
          .select()
          .single();

        if (!nextMatch) return;

        const [{ data: ntA }, { data: ntB }] = await Promise.all([
          supabase.from('match_teams').insert({ match_id: nextMatch.id, team_label: 'A' }).select().single(),
          supabase.from('match_teams').insert({ match_id: nextMatch.id, team_label: 'B' }).select().single(),
        ]);
        if (ntA && ntB) {
          await Promise.all([
            ...teamAIds.map((playerId) => supabase.from('match_team_players').insert({ match_team_id: ntA.id, player_id: playerId })),
            ...teamBIds.map((playerId) => supabase.from('match_team_players').insert({ match_team_id: ntB.id, player_id: playerId })),
          ]);
        }
        await supabase.from('courts').update({ status: 'in_use' }).eq('id', resultMatch.court_id);
      };

      const persistQueue = async (playingIds: string[], restingIds: string[] = []) => {
        const waitingIds = queue
          .map((q) => q.player_id)
          .filter((id) => !playingIds.includes(id) && !restingIds.includes(id));
        const orderedIds = [...playingIds, ...waitingIds, ...restingIds];

        await Promise.all(
          queue.map((q) => {
            const justCompletedGame = winnerIds.includes(q.player_id) || loserIds.includes(q.player_id);
            const nextStatus = playingIds.includes(q.player_id)
              ? 'playing'
              : restingIds.includes(q.player_id)
                ? 'resting'
                : 'waiting';
            let nextConsecutive = q.consecutive_games;

            if (justCompletedGame) nextConsecutive += 1;
            if (nextStatus !== 'playing') nextConsecutive = 0;
            if (playingIds.includes(q.player_id) && !justCompletedGame) nextConsecutive = 0;

            return supabase.from('court_queues').update({
              status: nextStatus,
              consecutive_games: nextConsecutive,
              position: orderedIds.indexOf(q.player_id),
              updated_at: new Date().toISOString(),
            }).eq('id', q.id);
          })
        );
      };

      const fetchOtherWaitingPlayers = async (excludePlayerIds: Set<string>, limit: number) => {
        const { data } = await supabase
          .from('court_queues')
          .select('*')
          .eq('session_id', selectedSession)
          .neq('court_id', resultMatch.court_id)
          .in('status', ['waiting', 'resting'])
          .order('position');

        return ((data as CourtQueue[]) || [])
          .filter((q) => !excludePlayerIds.has(q.player_id))
          .sort((a, b) =>
            gamesPlayed(a.player_id) - gamesPlayed(b.player_id) ||
            a.consecutive_games - b.consecutive_games ||
            a.position - b.position
          )
          .slice(0, limit);
      };

      const pickSessionWaitingPlayers = async (
        localWaitingRows: CourtQueue[],
        excludePlayerIds: Set<string>,
        limit: number
      ) => {
        const otherWaitingRows = await fetchOtherWaitingPlayers(excludePlayerIds, Math.max(limit, 8));
        const picked = [...localWaitingRows, ...otherWaitingRows]
          .filter((q) => !excludePlayerIds.has(q.player_id))
          .sort((a, b) =>
            gamesPlayed(a.player_id) - gamesPlayed(b.player_id) ||
            a.consecutive_games - b.consecutive_games ||
            a.position - b.position
          )
          .slice(0, limit);

        return {
          picked,
          borrowed: picked.filter((q) => q.court_id !== resultMatch.court_id),
        };
      };

      const sortPlayersToRest = (players: CourtQueue[]) =>
        [...players].sort((a, b) => {
          const aConsec = a.consecutive_games + 1;
          const bConsec = b.consecutive_games + 1;
          const aRestScore = Math.max(0, aConsec - 1) * 100 + gamesPlayed(a.player_id) * 10;
          const bRestScore = Math.max(0, bConsec - 1) * 100 + gamesPlayed(b.player_id) * 10;
          if (bRestScore !== aRestScore) return bRestScore - aRestScore;

          const aIsLoser = loserIds.includes(a.player_id) ? 1 : 0;
          const bIsLoser = loserIds.includes(b.player_id) ? 1 : 0;
          if (bIsLoser !== aIsLoser) return bIsLoser - aIsLoser;

          return a.position - b.position;
        });

      const moveBorrowedPlayersToThisCourt = async (borrowedRows: CourtQueue[], playingIds: string[]) => {
        if (borrowedRows.length === 0) return;

        await supabase
          .from('court_queues')
          .delete()
          .in('id', borrowedRows.map((q) => q.id));

        await supabase.from('court_queues').insert(
          borrowedRows.map((q) => ({
            session_id: selectedSession,
            court_id: resultMatch.court_id,
            player_id: q.player_id,
            position: playingIds.indexOf(q.player_id),
            consecutive_games: 0,
            status: 'playing' as const,
          }))
        );
      };

      if (isFirstCompletedMatchOfSession) {
        const waitingNow = queue
          .filter((q) => q.status === 'waiting' || q.status === 'resting')
          .sort((a, b) =>
            gamesPlayed(a.player_id) - gamesPlayed(b.player_id) ||
            a.consecutive_games - b.consecutive_games ||
            a.position - b.position
          );
        const nextTeamAIds = winnerIds;
        let nextTeamBIds: string[] = [];

        if (waitingNow.length >= 2) {
          nextTeamBIds = waitingNow.slice(0, 2).map((q) => q.player_id);
        } else if (waitingNow.length === 1) {
          const loserRows = loserIds
            .map((id) => queue.find((q) => q.player_id === id))
            .filter(Boolean) as CourtQueue[];
          const loserToStay = loserRows.sort((a, b) => a.consecutive_games - b.consecutive_games)[0]?.player_id || loserIds[0];
          nextTeamBIds = [waitingNow[0].player_id, loserToStay];
        } else {
          nextTeamBIds = loserIds;
        }

        const nextPlayingIds = [...nextTeamAIds, ...nextTeamBIds];
        if (nextPlayingIds.length === 4) {
          const { partnerHistory, opponentHistory } = extractPairHistory(completedBeforeThisResult);
          const { teamA: pairedTeamAIds, teamB: pairedTeamBIds } = waitingNow.length === 0
            ? buildTeams(nextPlayingIds as [string, string, string, string], partnerHistory, opponentHistory)
            : { teamA: nextTeamAIds as [string, string], teamB: nextTeamBIds as [string, string] };
          await persistQueue(nextPlayingIds);
          await createNextMatch(pairedTeamAIds, pairedTeamBIds);
        }
      } else if (totalCourtPlayers === 5) {
        const playingNow = queue.filter((q) => q.status === 'playing');
        const waitingNow = queue
          .filter((q) => q.status === 'waiting' || q.status === 'resting')
          .sort((a, b) => gamesPlayed(a.player_id) - gamesPlayed(b.player_id) || a.position - b.position);

        if (waitingNow.length > 0 && playingNow.length === 4) {
          const unavailableIds = new Set(playingNow.map((q) => q.player_id));
          const { picked: incomingRows, borrowed: borrowedWaiting } = await pickSessionWaitingPlayers(waitingNow, unavailableIds, 2);
          const incomingPlayerIds = incomingRows.map((q) => q.player_id);
          const restCount = incomingPlayerIds.length;
          const playersToRest = sortPlayersToRest(playingNow).slice(0, restCount);
          const restingIds = playersToRest.map((q) => q.player_id);

          const nextPlayingIds = [
            ...playingNow.filter((q) => !restingIds.includes(q.player_id)).map((q) => q.player_id),
            ...incomingPlayerIds,
          ];
          const { partnerHistory, opponentHistory } = extractPairHistory(completedBeforeThisResult);
          const { teamA: nextTeamAIds, teamB: nextTeamBIds } = buildTeams(
            nextPlayingIds as [string, string, string, string],
            partnerHistory,
            opponentHistory
          );

          await persistQueue(nextPlayingIds, restingIds);
          await moveBorrowedPlayersToThisCourt(borrowedWaiting, nextPlayingIds);
          await createNextMatch(nextTeamAIds, nextTeamBIds);
        }
      } else if (totalCourtPlayers === 4) {
        const playingNow = queue.filter((q) => q.status === 'playing');

        if (playingNow.length === 4) {
          const unavailableIds = new Set(queue.map((q) => q.player_id));
          const { picked: borrowedWaiting } = await pickSessionWaitingPlayers([], unavailableIds, 2);
          const incomingPlayerIds = borrowedWaiting.map((q) => q.player_id);
          const restCount = incomingPlayerIds.length;
          const playersToRest = restCount > 0
            ? sortPlayersToRest(playingNow).slice(0, restCount)
            : [];
          const restingIds = playersToRest.map((q) => q.player_id);
          const nextPlayingIds = [
            ...playingNow.filter((q) => !restingIds.includes(q.player_id)).map((q) => q.player_id),
            ...incomingPlayerIds,
          ];

          if (nextPlayingIds.length === 4) {
            const { partnerHistory, opponentHistory } = extractPairHistory(completedBeforeThisResult);
            const { teamA: nextTeamAIds, teamB: nextTeamBIds } = buildTeams(
              nextPlayingIds as [string, string, string, string],
              partnerHistory,
              opponentHistory
            );

            await persistQueue(nextPlayingIds, restingIds);
            await moveBorrowedPlayersToThisCourt(borrowedWaiting, nextPlayingIds);
            await createNextMatch(nextTeamAIds, nextTeamBIds);
          }
        }
      } else {
        const playingNow = queue.filter((q) => q.status === 'playing');
        const waitingNow = queue.filter((q) => q.status === 'waiting');
        const restingNow = queue.filter((q) => q.status === 'resting');
        const playingIds = new Set(playingNow.map((q) => q.player_id));
        const { picked: incomingRows, borrowed: borrowedWaiting } = await pickSessionWaitingPlayers(
          [...restingNow, ...waitingNow],
          playingIds,
          4
        );
        const nextRows = [...incomingRows, ...playingNow]
          .sort((a, b) => {
            const aPlayPenalty = playingIds.has(a.player_id)
              ? gamesPlayed(a.player_id) * 10 + Math.max(0, a.consecutive_games) * 100
              : gamesPlayed(a.player_id) * 10;
            const bPlayPenalty = playingIds.has(b.player_id)
              ? gamesPlayed(b.player_id) * 10 + Math.max(0, b.consecutive_games) * 100
              : gamesPlayed(b.player_id) * 10;
            if (aPlayPenalty !== bPlayPenalty) return aPlayPenalty - bPlayPenalty;

            const aIsIncoming = playingIds.has(a.player_id) ? 1 : 0;
            const bIsIncoming = playingIds.has(b.player_id) ? 1 : 0;
            if (aIsIncoming !== bIsIncoming) return aIsIncoming - bIsIncoming;

            return a.consecutive_games - b.consecutive_games || a.position - b.position;
          })
          .slice(0, 4);
        const nextPlayingIds = nextRows.map((q) => q.player_id);
        const restingIds = playingNow
          .filter((q) => !nextPlayingIds.includes(q.player_id))
          .map((q) => q.player_id);

        if (nextPlayingIds.length === 4) {
          const { partnerHistory, opponentHistory } = extractPairHistory(completedBeforeThisResult);
          const { teamA: nextTeamAIds, teamB: nextTeamBIds } = buildTeams(
            nextPlayingIds as [string, string, string, string],
            partnerHistory,
            opponentHistory
          );
          await persistQueue(nextPlayingIds, restingIds);
          await moveBorrowedPlayersToThisCourt(borrowedWaiting, nextPlayingIds);
          await createNextMatch(nextTeamAIds, nextTeamBIds);
        }
      }
    }

    setResultMatch(null);
    setScoreA('');
    setScoreB('');
    setWinner('');
    await loadSessionData(selectedSession);
    } catch (error: any) {
      console.error('Could not record match result.', error);
      setActionError(error?.message || 'Could not record the match result. Your login remains active; please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function resumeQueuedMatches() {
    if (!selectedSession || !user) return;
    setLoading(true);
    setActionError('');

    try {
      const activeCourtIds = new Set(activeMatches.map((match) => match.court_id));
      const playableCourtIds = courts
        .map((court) => court.id)
        .filter((courtId) => !activeCourtIds.has(courtId) && courtQueues.filter((q) => q.court_id === courtId && q.status === 'playing').length >= 4);

      if (playableCourtIds.length === 0) {
        setActionError('No queued court has 4 players ready to resume.');
        return;
      }

      const { data: allCompleted } = await supabase
        .from('matches')
        .select(`*, court:courts(*), teams:match_teams(*, players:match_team_players(*, profile:profiles(*)))`)
        .eq('session_id', selectedSession)
        .eq('status', 'completed');
      const { partnerHistory, opponentHistory } = extractPairHistory((allCompleted as MatchWithDetails[]) || []);

      for (const courtId of playableCourtIds) {
        const nextFour = courtQueues
          .filter((q) => q.court_id === courtId && q.status === 'playing')
          .sort((a, b) => a.position - b.position)
          .slice(0, 4)
          .map((q) => q.player_id);

        if (nextFour.length !== 4) continue;
        const { teamA: nextTeamAIds, teamB: nextTeamBIds } = buildTeams(
          nextFour as [string, string, string, string],
          partnerHistory,
          opponentHistory
        );

        const { data: nextMatch, error: matchError } = await supabase
          .from('matches')
          .insert({ session_id: selectedSession, court_id: courtId, status: 'active', created_by: user.id })
          .select()
          .single();
        if (matchError || !nextMatch) throw matchError || new Error('Could not resume queued match.');

        const [{ data: teamA }, { data: teamB }] = await Promise.all([
          supabase.from('match_teams').insert({ match_id: nextMatch.id, team_label: 'A' }).select().single(),
          supabase.from('match_teams').insert({ match_id: nextMatch.id, team_label: 'B' }).select().single(),
        ]);

        if (teamA && teamB) {
          await Promise.all([
            ...nextTeamAIds.map((playerId) => supabase.from('match_team_players').insert({ match_team_id: teamA.id, player_id: playerId })),
            ...nextTeamBIds.map((playerId) => supabase.from('match_team_players').insert({ match_team_id: teamB.id, player_id: playerId })),
          ]);
        }

        await supabase.from('courts').update({ status: 'in_use' }).eq('id', courtId);
      }

      await supabase.from('sessions').update({ status: 'in_progress' }).eq('id', selectedSession);
      await loadSessionData(selectedSession);
    } catch (err: any) {
      setActionError(err.message || 'Could not resume queued match.');
    } finally {
      setLoading(false);
    }
  }

  async function abandonMatch(matchId: string) {
    const match = activeMatches.find((m) => m.id === matchId);
    if (!match) return;
    await supabase.from('matches').update({ status: 'abandoned', ended_at: new Date().toISOString() }).eq('id', matchId);
    await supabase.from('courts').update({ status: 'available' }).eq('id', match.court_id);
    setAbandonConfirm(null);
    loadSessionData(selectedSession);
  }

  async function reverseStatsForDeletedMatch(match: MatchWithDetails) {
    if (match.status !== 'completed' || !match.winner_team) return;
    const sessionEnvironment = sessions.find((s) => s.id === selectedSession)?.environment || 'prod';

    for (const team of match.teams || []) {
      const didWin = team.team_label === match.winner_team;
      for (const player of team.players || []) {
        const { data: existing } = await supabase
          .from('player_stats')
          .select('*')
          .eq('player_id', player.player_id)
          .eq('environment', sessionEnvironment)
          .maybeSingle();

        if (!existing) continue;

        await supabase
          .from('player_stats')
          .update({
            wins: Math.max(0, existing.wins - (didWin ? 1 : 0)),
            losses: Math.max(0, existing.losses - (didWin ? 0 : 1)),
            total_matches: Math.max(0, existing.total_matches - 1),
            updated_at: new Date().toISOString(),
          })
          .eq('player_id', player.player_id)
          .eq('environment', sessionEnvironment);
      }
    }
  }

  async function deleteMatch(match: MatchWithDetails) {
    const matchSession = sessions.find((session) => session.id === match.session_id);
    const canDeleteThisMatch = Boolean(
      user &&
      matchSession &&
      (
        isSuperAdmin ||
        matchSession.created_by === user.id ||
        matchSession.group?.created_by === user.id
      )
    );

    if (!canDeleteThisMatch) {
      setActionError('Only the session organiser can delete matches.');
      setDeleteMatchConfirm(null);
      return;
    }

    setLoading(true);
    setActionError('');

    try {
      const teamIds = (match.teams || []).map((team) => team.id).filter(Boolean);
      if (teamIds.length > 0) {
        const { error: playersError } = await supabase.from('match_team_players').delete().in('match_team_id', teamIds);
        if (playersError) throw playersError;

        const { error: teamsError } = await supabase.from('match_teams').delete().in('id', teamIds);
        if (teamsError) throw teamsError;
      }

      const { error: matchError } = await supabase.from('matches').delete().eq('id', match.id);
      if (matchError) throw matchError;

      await reverseStatsForDeletedMatch(match);

      if (match.status === 'active') {
        await supabase.from('courts').update({ status: 'available' }).eq('id', match.court_id);
      }

      setDeleteMatchConfirm(null);
      setResultMatch(null);
      setAbandonConfirm(null);
      await loadSessionData(selectedSession);
    } catch (error: any) {
      setActionError(error?.message || 'Could not delete match.');
    } finally {
      setLoading(false);
    }
  }

  function openActiveMatchEditor(match: MatchWithDetails) {
    const teamA = match.teams?.find((t) => t.team_label === 'A');
    const teamB = match.teams?.find((t) => t.team_label === 'B');
    const playersA = (teamA?.players || []).map((p) => p.profile).filter(Boolean) as Profile[];
    const playersB = (teamB?.players || []).map((p) => p.profile).filter(Boolean) as Profile[];
    const courtNames = Object.fromEntries(courts.map((court) => [court.id, court.name]));
    const activeMatchPlayerIds = new Set<string>();
    for (const activeMatch of activeMatches) {
      for (const team of activeMatch.teams || []) {
        for (const player of team.players || []) activeMatchPlayerIds.add(player.player_id);
      }
    }
    const waiting = courtQueues
      .filter((q) =>
        (q.status === 'waiting' || q.status === 'resting') &&
        !activeMatchPlayerIds.has(q.player_id)
      )
      .sort((a, b) =>
        (courtNames[a.court_id] || '').localeCompare(courtNames[b.court_id] || '') ||
        a.position - b.position
      );

    if (playersA.length !== 2 || playersB.length !== 2) return;

    setEditingActiveMatch({
      match,
      teamA: [playersA[0], playersA[1]],
      teamB: [playersB[0], playersB[1]],
      waiting,
      courtNames,
    });
    setSelectedActiveEditPlayer(null);
  }

  function selectActiveEditPlayer(area: 'A' | 'B' | 'waiting', playerId: string) {
    if (!editingActiveMatch) return;
    if (!selectedActiveEditPlayer) {
      setSelectedActiveEditPlayer({ area, playerId });
      return;
    }

    if (selectedActiveEditPlayer.area === area && selectedActiveEditPlayer.playerId === playerId) {
      setSelectedActiveEditPlayer(null);
      return;
    }

    setEditingActiveMatch((current) => {
      if (!current) return current;
      const slots: TeamEditSlot[] = [
        { area: 'A', index: 0, player: current.teamA[0] },
        { area: 'A', index: 1, player: current.teamA[1] },
        { area: 'B', index: 0, player: current.teamB[0] },
        { area: 'B', index: 1, player: current.teamB[1] },
        ...current.waiting.map((q, index) => ({ area: 'waiting' as const, index, player: q.profile, queue: q })),
      ];
      const first = slots.find((slot) => slot.area === selectedActiveEditPlayer.area && slot.player.id === selectedActiveEditPlayer.playerId);
      const second = slots.find((slot) => slot.area === area && slot.player.id === playerId);
      if (!first || !second) return current;

      const nextTeamA = [...current.teamA] as [Profile, Profile];
      const nextTeamB = [...current.teamB] as [Profile, Profile];
      const nextWaiting = [...current.waiting];
      const setSlot = (slot: TeamEditSlot, player: Profile) => {
        if (slot.area === 'A') nextTeamA[slot.index] = player;
        if (slot.area === 'B') nextTeamB[slot.index] = player;
        if (slot.area === 'waiting' && slot.queue) nextWaiting[slot.index] = { ...slot.queue, player_id: player.id, profile: player };
      };

      setSlot(first, second.player);
      setSlot(second, first.player);

      return { ...current, teamA: nextTeamA, teamB: nextTeamB, waiting: nextWaiting };
    });
    setSelectedActiveEditPlayer(null);
  }

  async function saveActiveMatchEdit() {
    if (!editingActiveMatch) return;
    setLoading(true);

    const teamA = editingActiveMatch.match.teams?.find((t) => t.team_label === 'A');
    const teamB = editingActiveMatch.match.teams?.find((t) => t.team_label === 'B');

    if (!teamA || !teamB) {
      setLoading(false);
      return;
    }

    const nextPlayingIds = [
      ...editingActiveMatch.teamA.map((p) => p.id),
      ...editingActiveMatch.teamB.map((p) => p.id),
    ];
    const queueRowByPlayerId = new Map(courtQueues.map((q) => [q.player_id, q]));

    await supabase
      .from('match_team_players')
      .delete()
      .in('match_team_id', [teamA.id, teamB.id]);

    await Promise.all([
      ...editingActiveMatch.teamA.map((p) => supabase.from('match_team_players').insert({ match_team_id: teamA.id, player_id: p.id })),
      ...editingActiveMatch.teamB.map((p) => supabase.from('match_team_players').insert({ match_team_id: teamB.id, player_id: p.id })),
      ...nextPlayingIds
        .map((playerId, index) => ({ playerId, index, row: queueRowByPlayerId.get(playerId) }))
        .filter((item) => item.row)
        .map(({ index, row }) =>
          supabase.from('court_queues').update({
          court_id: editingActiveMatch.match.court_id,
          status: 'playing',
          position: index,
          updated_at: new Date().toISOString(),
        })
          .eq('id', row!.id)
      ),
      ...editingActiveMatch.waiting.map((q) =>
        {
          const row = queueRowByPlayerId.get(q.player_id);
          if (!row) return Promise.resolve();
          return supabase.from('court_queues').update({
            court_id: q.court_id,
            status: q.status,
            position: q.position,
            updated_at: new Date().toISOString(),
          }).eq('id', row.id);
        }
      ),
    ]);

    setEditingActiveMatch(null);
    setSelectedActiveEditPlayer(null);
    await loadSessionData(selectedSession);
    setLoading(false);
  }

  async function clearCourtQueue(courtId: string) {
    await supabase.from('court_queues').delete().eq('court_id', courtId);
    loadSessionData(selectedSession);
  }

  const freePool = freePlayers();
  const availCourts = courts.filter((c) => c.status === 'available');
  const queuedPlayingCounts = courtQueues.reduce<Record<string, number>>((counts, q) => {
    if (q.status === 'playing') counts[q.court_id] = (counts[q.court_id] || 0) + 1;
    return counts;
  }, {});
  const hasPlayableQueuedCourt = activeMatches.length === 0 && Object.values(queuedPlayingCounts).some((count) => count >= 4);
  const canStartMatch = availCourts.length > 0 && freePool.length >= 4;
  const matchStartHint = availCourts.length === 0
    ? 'Add or free up a court before starting a match.'
    : freePool.length < 4
      ? 'At least 4 unassigned players are needed to start a match.'
      : '';

  // Build court-with-queue view
  const courtsWithQueues: CourtWithQueue[] = courts.map((court) => ({
    court,
    playing: courtQueues.filter((q) => q.court_id === court.id && q.status === 'playing'),
    waiting: courtQueues.filter((q) => q.court_id === court.id && (q.status === 'waiting' || q.status === 'resting')),
  }));

  const activeTeamByPlayer = new Map<string, 'A' | 'B'>();
  for (const match of activeMatches) {
    for (const team of match.teams || []) {
      for (const player of team.players || []) {
        activeTeamByPlayer.set(`${match.court_id}:${player.player_id}`, team.team_label as 'A' | 'B');
      }
    }
  }

  const hasQueues = courtQueues.length > 0;
  const selectedSessionDetails = sessions.find((session) => session.id === selectedSession);
  const canDeleteMatches = Boolean(
    user &&
    selectedSessionDetails &&
    (
      isSuperAdmin ||
      selectedSessionDetails.created_by === user.id ||
      selectedSessionDetails.group?.created_by === user.id
    )
  );

  if (loadingSessions) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <RefreshCw className="w-8 h-8 text-emerald-500 mx-auto mb-3 animate-spin" />
          <h1 className="text-gray-900 font-bold text-xl">Loading match management</h1>
          <p className="text-gray-500 text-sm mt-2">Finding open sessions you can manage.</p>
        </div>
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h1 className="text-red-700 font-bold text-xl">Match Manager could not load</h1>
          <p className="text-red-600 text-sm mt-2 break-words">{pageError}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 inline-flex items-center gap-2 bg-red-500 hover:bg-red-400 text-white px-4 py-2 rounded-xl text-sm font-semibold"
          >
            <RefreshCw className="w-4 h-4" /> Reload
          </button>
        </div>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
          <AlertTriangle className="w-10 h-10 text-amber-500 mx-auto mb-3" />
          <h1 className="text-gray-900 font-bold text-xl">No manageable sessions</h1>
          {isAdmin ? (
            <p className="text-gray-500 text-sm mt-2">Open a session from Sessions & Courts to manage its matches.</p>
          ) : (
            <p className="text-gray-500 text-sm mt-2">You can manage matches only when you are selected for a session and the session is currently within its scheduled date and time.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl px-4 py-3 text-sm font-medium">
          {actionError}
        </div>
      )}

      {/* Session selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-gray-500 text-sm">Session:</label>
        <select
          value={selectedSession}
          onChange={(e) => setSelectedSession(e.target.value)}
          className="bg-gray-100 border border-gray-200 text-gray-900 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-emerald-500"
        >
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>{s.title} - {formatDate(s.session_date)}</option>
          ))}
        </select>
        <button onClick={() => loadSessionData(selectedSession)} disabled={!selectedSession} className="text-gray-400 hover:text-gray-900 disabled:opacity-40 p-1.5 rounded-lg hover:bg-gray-100 transition-all">
          <RefreshCw className="w-4 h-4" />
        </button>
        {selectedSessionDetails && !isAdmin && (
          <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-2.5 py-1 rounded-lg font-medium">
            Available until {selectedSessionDetails.end_time.slice(0, 5)}
          </span>
        )}
        {selectedSessionDetails && isAdmin && (
          <span className="text-xs text-blue-700 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-lg font-medium">
            Admin access
          </span>
        )}
      </div>

      {/* Session game counter */}
      {Object.keys(sessionGameCounts).length > 0 && (
        <div className="bg-sky-50 border border-sky-100 rounded-2xl p-4">
          <h3 className="text-gray-800 font-semibold flex items-center gap-2 text-sm mb-3">
            <Hash className="w-4 h-4 text-sky-500" /> Games Played This Session
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-2">
            {Object.entries(sessionGameCounts)
              .sort((a, b) => b[1].count - a[1].count)
              .map(([id, { name, count, skill }]) => (
                <div key={id} className="flex items-center gap-2 bg-white border border-sky-100 rounded-xl px-3 py-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${skillLevelColor(skill)}`}>
                    {name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="text-gray-800 text-xs font-medium truncate">{name.split(' ')[0]}</p>
                    <p className="text-gray-400 text-xs">{skillLevelShortLabel(skill)}</p>
                  </div>
                  <div className={`ml-auto text-base font-bold flex-shrink-0 ${
                    count >= 4 ? 'text-emerald-600' : count >= 2 ? 'text-amber-600' : 'text-gray-400'
                  }`}>
                    {count}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Court queues overview */}
      {hasQueues && (
        <div className="space-y-3">
          <h3 className="text-gray-800 font-semibold flex items-center gap-2 text-sm">
            <RotateCcw className="w-4 h-4 text-emerald-600" /> Court Rotations
          </h3>
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {courtsWithQueues.filter((cq) => cq.playing.length > 0 || cq.waiting.length > 0).map(({ court, playing, waiting }) => (
              <div key={court.id} className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-gray-800 font-semibold text-sm">{court.name}</span>
                  <button onClick={() => clearCourtQueue(court.id)} className="text-gray-300 hover:text-red-500 text-xs transition-all">
                    Clear
                  </button>
                </div>
                {playing.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs text-emerald-700 font-semibold mb-1.5 uppercase tracking-wide">Playing</p>
                    <div className="grid grid-cols-2 gap-1">
                      {playing.map((q) => {
                        const teamLabel = activeTeamByPlayer.get(`${court.id}:${q.player_id}`);
                        const isTeamA = teamLabel !== 'B';
                        return (
                        <div key={q.id} className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs ${isTeamA ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}`}>
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isTeamA ? 'bg-sky-200 text-sky-700' : 'bg-rose-200 text-rose-700'}`}>
                            {q.profile?.full_name?.charAt(0)?.toUpperCase()}
                          </span>
                          <span className="truncate font-medium">{q.profile?.full_name?.split(' ')[0]}</span>
                          {q.consecutive_games > 0 && (
                            <span className="ml-auto text-amber-600 font-bold">{q.consecutive_games}</span>
                          )}
                        </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {waiting.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 font-semibold mb-1.5 uppercase tracking-wide">Up Next</p>
                    <div className="flex flex-wrap gap-1">
                      {waiting.map((q) => (
                        <div key={q.id} className={`flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium ${q.status === 'resting' ? 'bg-amber-100 text-amber-700' : 'bg-white text-gray-600 border border-emerald-100'}`}>
                          <span className="truncate">{q.profile?.full_name?.split(' ')[0]}</span>
                          {q.status === 'resting' && <span className="text-amber-600 text-xs ml-0.5">rest</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active matches */}
      {activeMatches.length > 0 && (
        <div>
          <h3 className="text-gray-800 font-semibold mb-3 flex items-center gap-2 text-sm">
            <Play className="w-4 h-4 text-emerald-600" /> Active Matches
          </h3>
          <div className="grid sm:grid-cols-2 gap-4">
            {activeMatches.map((match) => (
              <ActiveMatchCard
                key={match.id}
                match={match}
                onResult={() => { setResultMatch(match); setScoreA(''); setScoreB(''); setWinner(''); }}
                onEdit={() => openActiveMatchEditor(match)}
                onAbandon={() => setAbandonConfirm(match.id)}
                onDelete={canDeleteMatches ? () => setDeleteMatchConfirm(match) : undefined}
              />
            ))}
          </div>
        </div>
      )}

      {/* Action buttons */}
      {!showCreate && !showQuickMatch && !showLogMatch && smartAssignments.length === 0 && (
        <div className="flex gap-3 flex-wrap">
          {hasPlayableQueuedCourt && (
            <button
              onClick={resumeQueuedMatches}
              disabled={loading}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-400 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all shadow-sm shadow-blue-500/20"
            >
              <Play className="w-4 h-4" />
              Resume queued match
            </button>
          )}
          <button
            onClick={smartAssignAll}
            disabled={!canStartMatch}
            title={matchStartHint || 'Review and start smart assignments'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              canStartMatch
                ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-sm shadow-emerald-500/20'
                : 'bg-amber-50 text-amber-700 border border-amber-200 cursor-not-allowed'
            }`}
          >
            <Zap className="w-4 h-4" />
            Smart Assign ({freePool.length} players, {availCourts.length} courts)
          </button>
          <button
            onClick={() => { setShowQuickMatch(true); setActionError(''); }}
            disabled={!canStartMatch}
            title={matchStartHint || 'Fast court-side match starter'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              canStartMatch
                ? 'bg-sky-500 hover:bg-sky-400 text-white shadow-sm shadow-sky-500/20'
                : 'bg-sky-50 text-sky-300 border border-sky-100 cursor-not-allowed'
            }`}
          >
            <Zap className="w-4 h-4" /> Quick Match
          </button>
          <button
            onClick={() => { setShowLogMatch(true); setActionError(''); }}
            disabled={courts.length === 0 || freePool.length < 4}
            title={courts.length === 0 ? 'Add a court before logging a match' : freePool.length < 4 ? 'At least 4 unassigned players are needed' : 'Log a finished casual match'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
              courts.length > 0 && freePool.length >= 4
                ? 'bg-amber-500 hover:bg-amber-400 text-white shadow-sm shadow-amber-500/20'
                : 'bg-amber-50 text-amber-300 border border-amber-100 cursor-not-allowed'
            }`}
          >
            <Trophy className="w-4 h-4" /> Log Completed Match
          </button>
          {!canStartMatch && !hasPlayableQueuedCourt && matchStartHint && (
            <div className="flex items-center text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
              {matchStartHint}
            </div>
          )}
        </div>
      )}

      {smartAssignments.length > 0 && (
        <SmartAssignPreview
          assignments={smartAssignments}
          selectedPlayer={selectedSmartPlayer}
          onSelectPlayer={selectSmartPlayer}
          onStart={startSmartAssignments}
          onCancel={cancelSmartAssignments}
          loading={loading}
        />
      )}

      {/* Manual create form */}
      {showCreate && (
        <CreateMatchForm
          courts={availCourts}
          freePool={freePool}
          teamA={teamA}
          teamB={teamB}
          teamAName={teamAName}
          teamBName={teamBName}
          selectedCourt={selectedCourt}
          onSelectCourt={setSelectedCourt}
          onTeamAName={setTeamAName}
          onTeamBName={setTeamBName}
          onShuffle={shuffleTeams}
          onMoveToTeam={moveToTeam}
          onRemoveFromTeam={removeFromTeam}
          onCreate={createMatch}
          onCancel={() => { setShowCreate(false); setTeamA([]); setTeamB([]); }}
          loading={loading}
        />
      )}

      {showQuickMatch && (
        <QuickMatchPanel
          mode="start"
          courts={availCourts}
          players={freePool}
          loading={loading}
          onCancel={() => setShowQuickMatch(false)}
          onStart={createQuickMatch}
        />
      )}

      {showLogMatch && (
        <QuickMatchPanel
          mode="log"
          courts={courts}
          players={freePool}
          loading={loading}
          onCancel={() => setShowLogMatch(false)}
          onLog={logCompletedMatch}
        />
      )}

      {/* Waiting players (not in any queue) */}
      {freePool.length > 0 && !showCreate && !showQuickMatch && !showLogMatch && smartAssignments.length === 0 && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
          <h3 className="text-gray-800 font-semibold mb-3 flex items-center gap-2 text-sm">
            <Users className="w-4 h-4 text-amber-500" /> Unassigned Players ({freePool.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {freePool.map((p) => (
              <div key={p.id} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-sm ${skillLevelColor(p.skill_level)}`}>
                <span className="font-medium">{p.full_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Match History - bottom of page */}
      {completedMatches.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <h3 className="text-gray-800 font-semibold mb-4 flex items-center gap-2 text-sm">
            <ClipboardList className="w-4 h-4 text-gray-400" /> Match History ({completedMatches.length})
          </h3>
          <div className="space-y-2">
            {completedMatches.map((m) => {
              const tA = m.teams?.find((t) => t.team_label === 'A');
              const tB = m.teams?.find((t) => t.team_label === 'B');
              const winnerLabel = m.winner_team;
              const namesA = tA?.players?.map((p) => p.profile?.full_name?.split(' ')[0]).join(' & ') || '-';
              const namesB = tB?.players?.map((p) => p.profile?.full_name?.split(' ')[0]).join(' & ') || '-';
              const endTime = m.ended_at ? new Date(m.ended_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
              return (
                <div key={m.id} className="bg-gray-50 border border-gray-100 rounded-xl p-3 sm:px-4 sm:py-3">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium text-gray-500 flex-shrink-0">{m.court?.name}</span>
                      <span className="text-gray-300 text-xs">-</span>
                      <span className="text-xs text-gray-400 font-medium tabular-nums truncate">{endTime}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {winnerLabel && (
                        <div className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-lg font-medium">
                          <Trophy className="w-3 h-3" />
                          <span>{winnerLabel === 'A' ? 'Team A' : 'Team B'}</span>
                        </div>
                      )}
                      {canDeleteMatches && (
                        <button
                          onClick={() => setDeleteMatchConfirm(m)}
                          className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                          title="Delete match"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
                    <div className={`rounded-xl border p-2 min-w-0 ${winnerLabel === 'A' ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
                      <p className={`text-xs font-semibold mb-1 ${winnerLabel === 'A' ? 'text-emerald-700' : 'text-gray-400'}`}>Team A</p>
                      <p className={`text-sm font-semibold leading-snug break-words ${winnerLabel === 'A' ? 'text-emerald-800' : 'text-gray-700'}`}>{namesA}</p>
                    </div>
                    <div className="flex flex-col items-center justify-center px-1">
                      <span className={`text-sm font-bold tabular-nums px-2 py-1 rounded-lg ${winnerLabel === 'A' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>{m.score_a}</span>
                      <span className="text-gray-300 text-xs font-bold my-0.5">-</span>
                      <span className={`text-sm font-bold tabular-nums px-2 py-1 rounded-lg ${winnerLabel === 'B' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>{m.score_b}</span>
                    </div>
                    <div className={`rounded-xl border p-2 min-w-0 ${winnerLabel === 'B' ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
                      <p className={`text-xs font-semibold mb-1 ${winnerLabel === 'B' ? 'text-emerald-700' : 'text-gray-400'}`}>Team B</p>
                      <p className={`text-sm font-semibold leading-snug break-words ${winnerLabel === 'B' ? 'text-emerald-800' : 'text-gray-700'}`}>{namesB}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editingActiveMatch && (
        <ActiveMatchEditModal
          editState={editingActiveMatch}
          selectedPlayer={selectedActiveEditPlayer}
          onSelectPlayer={selectActiveEditPlayer}
          onSave={saveActiveMatchEdit}
          onClose={() => { setEditingActiveMatch(null); setSelectedActiveEditPlayer(null); }}
          loading={loading}
        />
      )}

      {/* Result Modal */}
      {resultMatch && (
        <Modal title="Record Result" onClose={() => setResultMatch(null)}>
          <div className="space-y-4 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[...resultMatch.teams].sort((a, b) => a.team_label.localeCompare(b.team_label)).map((team) => {
                const teamLabel = team.team_label as 'A' | 'B';
                const isTeamA = teamLabel === 'A';
                const selected = winner === teamLabel;
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => setWinner(teamLabel)}
                    className={`text-left rounded-xl p-3 border min-w-0 transition-all ${
                      selected
                        ? isTeamA
                          ? 'bg-sky-100 border-sky-400 ring-2 ring-sky-200'
                          : 'bg-rose-100 border-rose-400 ring-2 ring-rose-200'
                        : isTeamA
                        ? 'bg-sky-50 border-sky-200 hover:border-sky-300'
                        : 'bg-rose-50 border-rose-200 hover:border-rose-300'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className={`text-xs font-semibold ${isTeamA ? 'text-sky-600' : 'text-rose-600'}`}>
                        Team {teamLabel} {team.team_name ? `- ${team.team_name}` : ''}
                      </p>
                      {selected && (
                        <span className={`flex items-center gap-1 text-xs font-bold ${isTeamA ? 'text-sky-700' : 'text-rose-700'}`}>
                          <Trophy className="w-3.5 h-3.5" /> Winner
                        </span>
                      )}
                    </div>
                    {team.players?.map((p) => (
                      <p key={p.id} className="text-gray-800 text-sm truncate">{p.profile?.full_name}</p>
                    ))}
                  </button>
                );
              })}
            </div>
            <p className="text-gray-400 text-xs">Enter a 21+ winning score to auto-select the winner, or tap a team panel if no score is needed.</p>
            <div>
              <label className="text-gray-500 text-sm mb-2 block">Score</label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
                <input
                  type="number"
                  placeholder="Team A"
                  value={scoreA}
                  onChange={(e) => updateResultScore('A', e.target.value)}
                  className="min-w-0 w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-2 sm:px-3 py-2 text-sm text-center focus:outline-none focus:border-emerald-500"
                />
                <span className="text-gray-400 font-bold text-xs sm:text-sm">vs</span>
                <input
                  type="number"
                  placeholder="Team B"
                  value={scoreB}
                  onChange={(e) => updateResultScore('B', e.target.value)}
                  className="min-w-0 w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-2 sm:px-3 py-2 text-sm text-center focus:outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={recordResult}
                disabled={!winner || loading}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-all"
              >
                {loading ? 'Saving...' : 'Record & Next Game'}
              </button>
              <button onClick={() => setResultMatch(null)} className="px-4 py-2.5 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Abandon Confirm */}
      {abandonConfirm && (
        <Modal title="Abandon Match?" onClose={() => setAbandonConfirm(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-amber-700 text-sm">This will abandon the match and discard all results. The court will be freed up.</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => abandonMatch(abandonConfirm)} className="flex-1 bg-red-500 hover:bg-red-400 text-white py-2.5 rounded-xl text-sm font-semibold transition-all">
                Yes, Abandon
              </button>
              <button onClick={() => setAbandonConfirm(null)} className="px-4 py-2.5 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">
                Keep Playing
              </button>
            </div>
          </div>
        </Modal>
      )}

      {deleteMatchConfirm && (
        <Modal title="Delete Match?" onClose={() => setDeleteMatchConfirm(null)}>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-3">
              <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-700 text-sm font-semibold">This will permanently delete the match.</p>
                <p className="text-red-600/80 text-xs mt-1">
                  Completed match stats will be reversed, and the match will be removed from history.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => deleteMatch(deleteMatchConfirm)}
                disabled={loading}
                className="flex-1 bg-red-500 hover:bg-red-400 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-all"
              >
                {loading ? 'Deleting...' : 'Yes, delete'}
              </button>
              <button onClick={() => setDeleteMatchConfirm(null)} className="px-4 py-2.5 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
// -----------------------------------------------------------------------------

function SmartAssignPreview({
  assignments,
  selectedPlayer,
  onSelectPlayer,
  onStart,
  onCancel,
  loading,
}: {
  assignments: SmartAssignment[];
  selectedPlayer: { courtId: string; playerId: string } | null;
  onSelectPlayer: (courtId: string, playerId: string) => void;
  onStart: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const renderPlayer = (courtId: string, player: Profile, tone: 'sky' | 'rose' | 'gray') => {
    const isSelected = selectedPlayer?.courtId === courtId && selectedPlayer.playerId === player.id;
    const toneClass =
      tone === 'sky'
        ? 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
        : tone === 'rose'
          ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
          : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100';

    return (
      <button
        key={player.id}
        onClick={() => onSelectPlayer(courtId, player.id)}
        className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-all ${toneClass} ${
          isSelected ? 'ring-2 ring-emerald-400 border-emerald-400' : ''
        }`}
      >
        <span className="w-7 h-7 rounded-full bg-white/70 flex items-center justify-center text-xs font-bold flex-shrink-0">
          {player.full_name?.charAt(0)?.toUpperCase()}
        </span>
        <span className="font-medium truncate">{player.full_name}</span>
      </button>
    );
  };

  return (
    <div className="bg-white border border-emerald-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-gray-900 font-semibold flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-600" />
            Review Smart Assign
          </h3>
          <p className="text-gray-400 text-xs mt-1">Tap any two players on the same court to swap them before starting.</p>
        </div>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-900">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        {assignments.map((assignment) => (
          <div key={assignment.court.id} className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-gray-900 font-semibold text-sm">{assignment.court.name}</p>
              <span className="text-xs text-gray-400">{4 + assignment.waiting.length} players</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-sky-600 mb-1.5">Team A</p>
                <div className="space-y-1.5">
                  {assignment.teamA.map((player) => renderPlayer(assignment.court.id, player, 'sky'))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-rose-600 mb-1.5">Team B</p>
                <div className="space-y-1.5">
                  {assignment.teamB.map((player) => renderPlayer(assignment.court.id, player, 'rose'))}
                </div>
              </div>
            </div>
            {assignment.waiting.length > 0 && (
              <div className="mt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">Waiting</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {assignment.waiting.map((player) => renderPlayer(assignment.court.id, player, 'gray'))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onStart}
          disabled={loading}
          className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
        >
          <Play className="w-4 h-4" /> {loading ? 'Starting...' : 'Start Smart Matches'}
        </button>
        <button onClick={onCancel} className="px-4 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">
          Cancel
        </button>
      </div>
    </div>
  );
}
// -----------------------------------------------------------------------------

function ActiveMatchEditModal({
  editState,
  selectedPlayer,
  onSelectPlayer,
  onSave,
  onClose,
  loading,
}: {
  editState: ActiveMatchEditState;
  selectedPlayer: { area: 'A' | 'B' | 'waiting'; playerId: string } | null;
  onSelectPlayer: (area: 'A' | 'B' | 'waiting', playerId: string) => void;
  onSave: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  const renderPlayer = (area: 'A' | 'B' | 'waiting', player: Profile, status?: CourtQueue['status']) => {
    const isSelected = selectedPlayer?.area === area && selectedPlayer.playerId === player.id;
    const toneClass = area === 'A'
      ? 'bg-sky-50 border-sky-200 text-sky-700 hover:bg-sky-100'
      : area === 'B'
        ? 'bg-rose-50 border-rose-200 text-rose-700 hover:bg-rose-100'
        : 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100';

    return (
      <button
        key={player.id}
        onClick={() => onSelectPlayer(area, player.id)}
        className={`w-full flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition-all ${toneClass} ${
          isSelected ? 'ring-2 ring-emerald-400 border-emerald-400' : ''
        }`}
      >
        <span className="w-7 h-7 rounded-full bg-white/70 flex items-center justify-center text-xs font-bold flex-shrink-0">
          {player.full_name?.charAt(0)?.toUpperCase()}
        </span>
        <span className="font-medium truncate">{player.full_name}</span>
        {status === 'resting' && <span className="ml-auto text-xs font-semibold">rest</span>}
      </button>
    );
  };

  return (
    <Modal title={`Edit ${editState.match.court?.name || 'Match'}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-gray-400 text-xs">Tap any two players to swap teams or order, then save.</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-sky-600 mb-1.5">Team A</p>
            <div className="space-y-1.5">
              {editState.teamA.map((player) => renderPlayer('A', player))}
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-600 mb-1.5">Team B</p>
            <div className="space-y-1.5">
              {editState.teamB.map((player) => renderPlayer('B', player))}
            </div>
          </div>
        </div>
        {editState.waiting.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-1.5">Available From Queues</p>
            <div className="grid grid-cols-2 gap-1.5">
              {editState.waiting.map((q) => (
                <div key={q.id} className="space-y-1">
                  {renderPlayer('waiting', q.profile, q.status)}
                  <p className="text-[10px] text-gray-400 px-1">{editState.courtNames[q.court_id] || 'Court queue'}</p>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button
            onClick={onSave}
            disabled={loading}
            className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-all"
          >
            {loading ? 'Saving...' : 'Save Teams'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
// -----------------------------------------------------------------------------

function ActiveMatchCard({ match, onResult, onEdit, onAbandon, onDelete }: {
  match: MatchWithDetails;
  onResult: () => void;
  onEdit: () => void;
  onAbandon: () => void;
  onDelete?: () => void;
}) {
  const [elapsed, setElapsed] = useState(
    Math.floor((Date.now() - new Date(match.started_at).getTime()) / 60000)
  );
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - new Date(match.started_at).getTime()) / 60000)), 30000);
    return () => clearInterval(t);
  }, [match.started_at]);

  const teamA = match.teams?.find((t) => t.team_label === 'A');
  const teamB = match.teams?.find((t) => t.team_label === 'B');

  return (
    <div className="bg-white border-2 border-emerald-100 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-gray-900 font-semibold text-sm">{match.court?.name}</span>
          <span className="flex items-center gap-1 text-amber-600 text-xs bg-amber-50 px-2 py-0.5 rounded-full">
            <Clock className="w-3 h-3" />{elapsed}m
          </span>
        </div>
        <div className="flex gap-1.5">
          <button onClick={onEdit} className="flex items-center gap-1 bg-sky-50 hover:bg-sky-100 text-sky-600 text-xs px-2.5 py-1.5 rounded-lg transition-all border border-sky-200">
            <Shuffle className="w-3 h-3" /> Edit
          </button>
          <button onClick={onResult} className="flex items-center gap-1 bg-emerald-500 hover:bg-emerald-400 text-white text-xs px-2.5 py-1.5 rounded-lg transition-all">
            <Trophy className="w-3 h-3" /> Result
          </button>
          <button onClick={onAbandon} className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-500 text-xs px-2 py-1.5 rounded-lg transition-all border border-red-200">
            <X className="w-3 h-3" />
          </button>
          {onDelete && (
            <button onClick={onDelete} className="flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-500 text-xs px-2 py-1.5 rounded-lg transition-all border border-red-200" title="Delete match">
              <Trash2 className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[teamA, teamB].map((team, i) => team && (
          <div key={team.id} className={`rounded-xl p-2.5 ${i === 0 ? 'bg-sky-50 border border-sky-200' : 'bg-rose-50 border border-rose-200'}`}>
            <p className={`text-xs font-semibold mb-1.5 ${i === 0 ? 'text-sky-600' : 'text-rose-600'}`}>
              {team.team_name || `Team ${team.team_label}`}
            </p>
            {team.players?.map((p) => (
              <p key={p.id} className="text-gray-800 text-xs py-0.5">{p.profile?.full_name}</p>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
// -----------------------------------------------------------------------------

function QuickMatchPanel({
  mode,
  courts,
  players,
  loading,
  onCancel,
  onStart,
  onLog,
}: {
  mode: 'start' | 'log';
  courts: Court[];
  players: AvailablePlayer[];
  loading: boolean;
  onCancel: () => void;
  onStart?: (courtId: string, teamAIds: string[], teamBIds: string[]) => void;
  onLog?: (courtId: string, teamAIds: string[], teamBIds: string[], winner: 'A' | 'B', scoreA: number, scoreB: number) => void;
}) {
  const [selectedCourt, setSelectedCourt] = useState(courts[0]?.id || '');
  const [teamA, setTeamA] = useState<AvailablePlayer[]>([]);
  const [teamB, setTeamB] = useState<AvailablePlayer[]>([]);
  const [search, setSearch] = useState('');
  const [winner, setWinner] = useState<'A' | 'B' | ''>('');
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');

  useEffect(() => {
    if (!selectedCourt && courts[0]) setSelectedCourt(courts[0].id);
    if (selectedCourt && !courts.some((court) => court.id === selectedCourt)) setSelectedCourt(courts[0]?.id || '');
  }, [courts, selectedCourt]);

  const selectedIds = new Set([...teamA, ...teamB].map((player) => player.id));
  const searchTerm = search.trim().toLowerCase();
  const filteredPlayers = players.filter((player) => {
    if (selectedIds.has(player.id)) return false;
    if (!searchTerm) return true;
    return (
      player.full_name.toLowerCase().includes(searchTerm) ||
      player.phone?.includes(searchTerm) ||
      skillLevelShortLabel(player.skill_level).toLowerCase().includes(searchTerm)
    );
  });

  const canSubmit = selectedCourt && teamA.length === 2 && teamB.length === 2 && (mode === 'start' || winner);

  function addPlayer(player: AvailablePlayer) {
    if (teamA.length < 2) {
      setTeamA((prev) => [...prev, player]);
      return;
    }
    if (teamB.length < 2) setTeamB((prev) => [...prev, player]);
  }

  function removePlayer(playerId: string) {
    setTeamA((prev) => prev.filter((player) => player.id !== playerId));
    setTeamB((prev) => prev.filter((player) => player.id !== playerId));
  }

  function movePlayer(player: AvailablePlayer, team: 'A' | 'B') {
    if (team === 'A') {
      if (teamA.some((p) => p.id === player.id) || teamA.length >= 2) return;
      setTeamB((prev) => prev.filter((p) => p.id !== player.id));
      setTeamA((prev) => [...prev, player]);
      return;
    }
    if (teamB.some((p) => p.id === player.id) || teamB.length >= 2) return;
    setTeamA((prev) => prev.filter((p) => p.id !== player.id));
    setTeamB((prev) => [...prev, player]);
  }

  function updateLogScore(team: 'A' | 'B', value: string) {
    const nextScoreA = team === 'A' ? value : scoreA;
    const nextScoreB = team === 'B' ? value : scoreB;

    if (team === 'A') setScoreA(value);
    if (team === 'B') setScoreB(value);

    const inferredWinner = inferWinnerFromScores(nextScoreA, nextScoreB);
    setWinner(inferredWinner);
  }

  function shuffleSelected() {
    if (players.length < 4) return;
    const shuffled = [...players].sort(() => Math.random() - 0.5).slice(0, 4);
    setTeamA([shuffled[0], shuffled[1]]);
    setTeamB([shuffled[2], shuffled[3]]);
  }

  function submit() {
    if (!canSubmit) return;
    const teamAIds = teamA.map((player) => player.id);
    const teamBIds = teamB.map((player) => player.id);
    if (mode === 'start') {
      onStart?.(selectedCourt, teamAIds, teamBIds);
      return;
    }
    onLog?.(
      selectedCourt,
      teamAIds,
      teamBIds,
      winner as 'A' | 'B',
      parseInt(scoreA) || 0,
      parseInt(scoreB) || 0
    );
  }

  const title = mode === 'start' ? 'Quick Match' : 'Log Completed Match';
  const subtitle = mode === 'start'
    ? 'Tap 4 players, adjust teams if needed, and start.'
    : 'For games already played on court. Save directly to history.';

  return (
    <div className="bg-white border border-sky-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-gray-900 font-semibold flex items-center gap-2">
            {mode === 'start' ? <Zap className="w-4 h-4 text-sky-600" /> : <Trophy className="w-4 h-4 text-amber-600" />}
            {title}
          </h3>
          <p className="text-gray-400 text-xs mt-1">{subtitle}</p>
        </div>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
      </div>

      <div className="grid lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
        <div className="space-y-3">
          <div>
            <label className="text-gray-500 text-xs mb-1.5 block">Court</label>
            <div className="grid grid-cols-2 gap-2">
              {courts.map((court) => (
                <button
                  key={court.id}
                  onClick={() => setSelectedCourt(court.id)}
                  className={`py-2 px-3 rounded-xl text-sm border transition-all ${
                    selectedCourt === court.id
                      ? 'bg-emerald-50 border-emerald-400 text-emerald-700'
                      : 'bg-gray-50 border-gray-200 text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {court.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={shuffleSelected}
              disabled={players.length < 4}
              className="flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-600 text-xs font-semibold rounded-xl py-2"
            >
              <Shuffle className="w-3.5 h-3.5" /> Shuffle
            </button>
            <button
              type="button"
              onClick={() => { setTeamA(teamB); setTeamB(teamA); setWinner(winner === 'A' ? 'B' : winner === 'B' ? 'A' : ''); }}
              disabled={teamA.length + teamB.length === 0}
              className="bg-gray-100 hover:bg-gray-200 disabled:opacity-40 text-gray-600 text-xs font-semibold rounded-xl py-2"
            >
              Swap sides
            </button>
          </div>

          {mode === 'log' && (
            <p className="text-gray-500 text-xs font-medium leading-relaxed">
              Enter a 21+ winning score to auto-select the winner, or tap a team card if no score is needed.
            </p>
          )}
        </div>

        <div className="space-y-4 min-w-0">
          <div className="grid sm:grid-cols-2 gap-3">
            <QuickTeamCard
              label="A"
              players={teamA}
              color="sky"
              selected={mode === 'log' && winner === 'A'}
              onSelect={mode === 'log' ? () => setWinner('A') : undefined}
              onRemove={removePlayer}
              onMove={(player) => movePlayer(player, 'B')}
            />
            <QuickTeamCard
              label="B"
              players={teamB}
              color="rose"
              selected={mode === 'log' && winner === 'B'}
              onSelect={mode === 'log' ? () => setWinner('B') : undefined}
              onRemove={removePlayer}
              onMove={(player) => movePlayer(player, 'A')}
            />
          </div>

          {mode === 'log' && (
            <div className="bg-gray-50 border border-gray-200 rounded-2xl p-3">
              <label className="text-gray-500 text-xs font-semibold uppercase tracking-wide block mb-2">Final Score</label>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 max-w-xl">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-sky-700 mb-1">Team A</p>
                  <input
                    type="number"
                    placeholder="0"
                    value={scoreA}
                    onChange={(e) => updateLogScore('A', e.target.value)}
                    className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-sm text-center focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <span className="text-gray-300 text-xs font-bold pt-5">vs</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-rose-700 mb-1">Team B</p>
                  <input
                    type="number"
                    placeholder="0"
                    value={scoreB}
                    onChange={(e) => updateLogScore('B', e.target.value)}
                    className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-sm text-center focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-gray-500 text-xs font-semibold uppercase tracking-wide">Tap players ({teamA.length + teamB.length}/4)</p>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search"
                className="w-36 bg-gray-50 border border-gray-200 text-gray-900 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2 max-h-64 overflow-y-auto pr-1">
              {filteredPlayers.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => addPlayer(player)}
                  disabled={teamA.length + teamB.length >= 4}
                  className={`text-left rounded-xl border px-3 py-2 transition-all disabled:opacity-40 ${skillLevelColor(player.skill_level)}`}
                >
                  <span className="block text-sm font-semibold truncate">{player.full_name}</span>
                  <span className="block text-xs opacity-70">{skillLevelShortLabel(player.skill_level)}</span>
                </button>
              ))}
              {filteredPlayers.length === 0 && (
                <p className="col-span-full text-center text-gray-400 text-sm py-6">No players available.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:justify-end border-t border-gray-100 pt-4">
        <button onClick={onCancel} className="px-4 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-200">Cancel</button>
        <button
          onClick={submit}
          disabled={!canSubmit || loading}
          className={`px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 ${
            mode === 'start' ? 'bg-sky-500 hover:bg-sky-400' : 'bg-amber-500 hover:bg-amber-400'
          }`}
        >
          {loading ? 'Saving...' : mode === 'start' ? 'Start Quick Match' : 'Save Completed Match'}
        </button>
      </div>
    </div>
  );
}

function QuickTeamCard({
  label,
  players,
  color,
  selected = false,
  onSelect,
  onRemove,
  onMove,
}: {
  label: 'A' | 'B';
  players: AvailablePlayer[];
  color: 'sky' | 'rose';
  selected?: boolean;
  onSelect?: () => void;
  onRemove: (playerId: string) => void;
  onMove: (player: AvailablePlayer) => void;
}) {
  const isSky = color === 'sky';
  return (
    <div
      onClick={onSelect}
      role={onSelect ? 'button' : undefined}
      tabIndex={onSelect ? 0 : undefined}
      onKeyDown={(event) => {
        if (!onSelect) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className={`rounded-2xl border p-3 min-h-32 transition-all ${
        onSelect ? 'cursor-pointer hover:shadow-sm' : ''
      } ${
        selected
          ? isSky
            ? 'bg-sky-100 border-sky-400 ring-2 ring-sky-200'
            : 'bg-rose-100 border-rose-400 ring-2 ring-rose-200'
          : isSky
          ? 'bg-sky-50 border-sky-200'
          : 'bg-rose-50 border-rose-200'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className={`text-xs font-semibold ${isSky ? 'text-sky-700' : 'text-rose-700'}`}>Team {label}</p>
        {selected && (
          <span className={`flex items-center gap-1 text-xs font-bold ${isSky ? 'text-sky-700' : 'text-rose-700'}`}>
            <Trophy className="w-3.5 h-3.5" /> Winner
          </span>
        )}
      </div>
      <div className="space-y-2">
        {players.map((player) => (
          <div key={player.id} className="bg-white/80 rounded-xl px-3 py-2 flex items-center gap-2">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${isSky ? 'bg-sky-100 text-sky-700' : 'bg-rose-100 text-rose-700'}`}>
              {player.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-gray-900 text-sm font-semibold truncate">{player.full_name}</p>
              <p className="text-gray-400 text-xs">{skillLevelShortLabel(player.skill_level)}</p>
            </div>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMove(player);
              }}
              title={`Move to Team ${label === 'A' ? 'B' : 'A'}`}
              className="text-gray-400 hover:text-gray-900 p-1.5 rounded-lg hover:bg-gray-100 flex-shrink-0"
            >
              <ArrowRightLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onRemove(player.id);
              }}
              className="text-gray-300 hover:text-red-500"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
        {players.length < 2 && (
          <div className="border border-dashed border-white/80 rounded-xl py-3 text-center text-xs text-gray-400">
            Add {2 - players.length} player{2 - players.length === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------

function CreateMatchForm({
  courts, freePool, teamA, teamB, teamAName, teamBName, selectedCourt,
  onSelectCourt, onTeamAName, onTeamBName, onShuffle, onMoveToTeam, onRemoveFromTeam,
  onCreate, onCancel, loading,
}: {
  courts: Court[];
  freePool: AvailablePlayer[];
  teamA: AvailablePlayer[];
  teamB: AvailablePlayer[];
  teamAName: string;
  teamBName: string;
  selectedCourt: string;
  onSelectCourt: (id: string) => void;
  onTeamAName: (v: string) => void;
  onTeamBName: (v: string) => void;
  onShuffle: () => void;
  onMoveToTeam: (p: AvailablePlayer, team: 'A' | 'B') => void;
  onRemoveFromTeam: (id: string) => void;
  onCreate: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  const canCreate = selectedCourt && teamA.length === 2 && teamB.length === 2;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-gray-900 font-semibold">Create Match</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
      </div>

      <div>
        <label className="text-gray-500 text-xs mb-1.5 block">Court</label>
        <div className="grid grid-cols-3 gap-2">
          {courts.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelectCourt(c.id)}
              className={`py-2 rounded-xl text-sm border transition-all ${
                selectedCourt === c.id
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-600'
                  : 'bg-gray-100 border-gray-200 text-gray-500 hover:text-gray-800'
              }`}
            >
              {c.name}
            </button>
          ))}
          {courts.length === 0 && <p className="col-span-3 text-red-500 text-xs">No courts available</p>}
        </div>
      </div>

      <button
        onClick={onShuffle}
        disabled={freePool.length < 4}
        className="flex items-center gap-2 bg-gray-200 hover:bg-gray-300 disabled:opacity-40 text-gray-700 text-sm px-4 py-2 rounded-xl transition-all w-full justify-center"
      >
        <Shuffle className="w-4 h-4" /> Shuffle
      </button>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <input
            placeholder="Team A name (optional)"
            value={teamAName}
            onChange={(e) => onTeamAName(e.target.value)}
            className="w-full bg-gray-50 border border-sky-200 text-gray-900 rounded-xl px-3 py-1.5 text-xs mb-2 focus:outline-none focus:border-sky-400"
          />
          <div className="space-y-1.5 min-h-[80px] bg-sky-50 border border-sky-200 rounded-xl p-2">
            {teamA.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-1 bg-sky-100 rounded-lg px-2 py-1">
                <span className="text-sky-700 text-xs">{p.full_name}</span>
                <button onClick={() => onRemoveFromTeam(p.id)} className="text-sky-400 hover:text-red-500">
                  <UserMinus className="w-3 h-3" />
                </button>
              </div>
            ))}
            {teamA.length < 2 && <p className="text-sky-400 text-xs text-center py-2">Add {2 - teamA.length} more</p>}
          </div>
        </div>
        <div>
          <input
            placeholder="Team B name (optional)"
            value={teamBName}
            onChange={(e) => onTeamBName(e.target.value)}
            className="w-full bg-gray-50 border border-rose-200 text-gray-900 rounded-xl px-3 py-1.5 text-xs mb-2 focus:outline-none focus:border-rose-400"
          />
          <div className="space-y-1.5 min-h-[80px] bg-rose-50 border border-rose-200 rounded-xl p-2">
            {teamB.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-1 bg-rose-100 rounded-lg px-2 py-1">
                <span className="text-rose-700 text-xs">{p.full_name}</span>
                <button onClick={() => onRemoveFromTeam(p.id)} className="text-rose-400 hover:text-red-500">
                  <UserMinus className="w-3 h-3" />
                </button>
              </div>
            ))}
            {teamB.length < 2 && <p className="text-rose-400 text-xs text-center py-2">Add {2 - teamB.length} more</p>}
          </div>
        </div>
      </div>

      {freePool.length > 0 && (
        <div>
          <p className="text-gray-400 text-xs mb-2">Click to assign:</p>
          <div className="flex flex-wrap gap-2">
            {freePool.map((p) => (
              <div key={p.id} className="flex items-center gap-0.5">
                <button onClick={() => onMoveToTeam(p, 'A')} disabled={teamA.length >= 2}
                  className="px-2 py-1 bg-sky-50 hover:bg-sky-100 disabled:opacity-30 text-sky-600 text-xs rounded-l-lg border border-sky-200 transition-all" title="Add to Team A">A</button>
                <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs border-y border-gray-200">{p.full_name}</span>
                <button onClick={() => onMoveToTeam(p, 'B')} disabled={teamB.length >= 2}
                  className="px-2 py-1 bg-rose-50 hover:bg-rose-100 disabled:opacity-30 text-rose-600 text-xs rounded-r-lg border border-rose-200 transition-all" title="Add to Team B">B</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCreate}
          disabled={!canCreate || loading}
          className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2"
        >
          <Play className="w-4 h-4" /> Start Match
        </button>
        <button onClick={onCancel} className="px-4 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">Cancel</button>
      </div>
    </div>
  );
}
// -----------------------------------------------------------------------------

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70">
      <div className="bg-white border border-gray-200 rounded-2xl w-full max-w-md max-h-[calc(100vh-1.5rem)] overflow-hidden shadow-xl">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 sm:py-4 border-b border-gray-200">
          <h3 className="text-gray-900 font-semibold truncate">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-900"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 sm:p-5 overflow-y-auto max-h-[calc(100vh-5.5rem)]">{children}</div>
      </div>
    </div>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}


