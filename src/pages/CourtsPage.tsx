import { useEffect, useState, useCallback } from 'react';
import { supabase, Match, Court, Session, Profile, MatchTeamWithPlayers, Environment, CompetitionFixture, CompetitionGroup } from '../lib/supabase';
import { skillLevelColor, skillLevelLabel, skillLevelTextColor } from '../lib/skillLevels';
import { useAuth } from '../context/AuthContext';
import { Monitor, Clock, Users, Wifi, WifiOff, Hash } from 'lucide-react';

interface MatchWithDetails extends Match {
  court: Court;
  teams: MatchTeamWithPlayers[];
}

interface CourtQueue {
  id: string;
  court_id: string;
  player_id: string;
  position: number;
  consecutive_games: number;
  status: 'playing' | 'waiting' | 'resting';
  profile: Profile;
}

interface CourtView {
  court: Court;
  match: MatchWithDetails | null;
  waiting: CourtQueue[];
  resting: CourtQueue[];
  fixtures: CompetitionFixture[];
  teamNames: { A: string; B: string };
}

interface PlayerGameCount {
  id: string;
  name: string;
  skill: string;
  count: number;
  status: 'playing' | 'waiting' | 'resting' | 'idle';
}

interface PlayerNextGame {
  state: 'playing' | 'waiting' | 'resting' | 'ready' | 'none';
  title: string;
  detail: string;
  courtName?: string;
  positionLabel?: string;
  tone: 'emerald' | 'amber' | 'sky' | 'gray';
}

interface NextUpItem {
  id: string;
  playerName: string;
  courtName: string;
  status: 'waiting' | 'resting';
  queueNumber: number;
  label: string;
}

function getPlayerNextGame(playerId: string | undefined, courtViews: CourtView[], playerGameCounts: PlayerGameCount[], isChallenge: boolean): PlayerNextGame | null {
  if (!playerId) return null;

  for (const cv of courtViews) {
    const teams = cv.match?.teams || [];
    for (const team of teams) {
      const isPlaying = team.players?.some((p) => p.player_id === playerId);
      if (isPlaying) {
        const partner = team.players
          ?.filter((p) => p.player_id !== playerId)
          .map((p) => p.profile?.full_name?.split(' ')[0])
          .filter(Boolean)
          .join(' & ');
        return {
          state: 'playing',
          title: 'You are playing now',
          detail: partner ? `Partner: ${partner}` : 'Current match in progress',
          courtName: cv.court.name,
          positionLabel: 'Now',
          tone: 'emerald',
        };
      }
    }
  }

  if (isChallenge) {
    const next = courtViews.flatMap((cv) => cv.fixtures.map((fixture) => ({ cv, fixture })))
      .filter(({ fixture }) => fixture.players?.some((player) => player.player_id === playerId))
      .sort((a, b) => a.fixture.scheduled_at.localeCompare(b.fixture.scheduled_at))[0];
    if (next) {
      const side = next.fixture.players?.find((player) => player.player_id === playerId)?.side;
      const partner = next.fixture.players?.find((player) => player.side === side && player.player_id !== playerId)?.profile?.full_name;
      return {
        state: 'waiting', title: 'Your next challenge match',
        detail: `${new Date(next.fixture.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}${partner ? ` · Partner: ${partner}` : ''}`,
        courtName: next.cv.court.name, positionLabel: `Round ${next.fixture.round_number}`, tone: 'sky',
      };
    }
    return { state: 'none', title: 'No upcoming challenge match', detail: 'You have no remaining scheduled fixtures in this challenge', tone: 'gray' };
  }

  for (const cv of courtViews) {
    const waitingIndex = cv.waiting.findIndex((q) => q.player_id === playerId);
    if (waitingIndex >= 0) {
      const queueNumber = waitingIndex + 1;
      const nextWave = waitingIndex < 4;
      return {
        state: 'waiting',
        title: nextWave ? 'You are up next' : 'You are in the queue',
        detail: cv.match ? (nextWave ? 'Expected after the current game finishes' : `${Math.ceil(queueNumber / 4)} rotations away`) : 'Court is available now',
        courtName: cv.court.name,
        positionLabel: `Queue #${queueNumber}`,
        tone: 'amber',
      };
    }

    const restingIndex = cv.resting.findIndex((q) => q.player_id === playerId);
    if (restingIndex >= 0) {
      return {
        state: 'resting',
        title: 'You are resting this game',
        detail: 'You should return to the queue after this match',
        courtName: cv.court.name,
        positionLabel: 'Resting',
        tone: 'sky',
      };
    }
  }

  const gameCount = playerGameCounts.find((p) => p.id === playerId);
  if (gameCount) {
    return {
      state: 'ready',
      title: 'You are ready',
      detail: 'You are available, but not assigned to a court queue yet',
      positionLabel: `${gameCount.count} games played`,
      tone: 'gray',
    };
  }

  return {
    state: 'none',
    title: 'No live court assignment',
    detail: 'You are not marked available in this session yet',
    tone: 'gray',
  };
}

function getNextUpItems(courtViews: CourtView[]): NextUpItem[] {
  return courtViews.flatMap((cv) => {
    const waiting = cv.waiting.map((q, index) => ({
      id: q.id,
      playerName: q.profile?.full_name || 'Unknown',
      courtName: cv.court.name,
      status: 'waiting' as const,
      queueNumber: index + 1,
      label: index < 4 ? 'Next game' : `${Math.ceil((index + 1) / 4)} rotations away`,
    }));
    const resting = cv.resting.map((q, index) => ({
      id: q.id,
      playerName: q.profile?.full_name || 'Unknown',
      courtName: cv.court.name,
      status: 'resting' as const,
      queueNumber: waiting.length + index + 1,
      label: 'Resting now',
    }));
    return [...waiting, ...resting];
  });
}

export default function CourtsPage({ envFilter = 'prod' }: { envFilter?: Environment }) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [courtViews, setCourtViews] = useState<CourtView[]>([]);
  const [playerGameCounts, setPlayerGameCounts] = useState<PlayerGameCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  useEffect(() => {
    setLoading(true);
    setSelectedSession(null);
    setCourtViews([]);
    setPlayerGameCounts([]);
    supabase
      .from('sessions')
      .select('*')
      .eq('environment', envFilter)
      .in('status', ['in_progress', 'open'])
      .order('session_date', { ascending: false })
      .then(({ data }) => {
        const list = data || [];
        setSessions(list);
        setSelectedSession(list[0]?.id || null);
        setLoading(false);
      });
  }, [envFilter]);

  const loadData = useCallback(async (sessionId: string) => {
    const isChallenge = sessions.find((session) => session.id === sessionId)?.session_type === 'group_challenge';
    const [matchesRes, courtsRes, queuesRes, allMatchesRes, availRes] = await Promise.all([
      supabase
        .from('matches')
        .select(`*, court:courts(*), teams:match_teams(*, players:match_team_players(*, profile:profiles(*)))`)
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .order('started_at', { ascending: true }),
      supabase.from('courts').select('*').eq('session_id', sessionId).order('created_at'),
      supabase
        .from('court_queues')
        .select('*, profile:profiles(*)')
        .eq('session_id', sessionId)
        .order('position'),
      supabase
        .from('matches')
        .select(`teams:match_teams(players:match_team_players(player_id, profile:profiles(full_name, skill_level)))`)
        .eq('session_id', sessionId)
        .in('status', ['active', 'completed']),
      supabase
        .from('session_availability')
        .select('player_id, profile:profiles(full_name, skill_level, environment)')
        .eq('session_id', sessionId)
        .eq('available', true),
    ]);

    const matches: MatchWithDetails[] = (matchesRes.data as any) || [];
    const courts: Court[] = courtsRes.data || [];
    const queues: CourtQueue[] = (queuesRes.data as any) || [];

    let fixtures: CompetitionFixture[] = [];
    let teamNames = { A: 'Team A', B: 'Team B' };
    if (isChallenge) {
      const { data: competition } = await supabase.from('competitions').select('id').eq('session_id', sessionId).maybeSingle();
      if (competition) {
        const [fixturesRes, groupsRes] = await Promise.all([
          supabase.from('competition_fixtures')
            .select('*, players:competition_fixture_players(*, profile:profiles(*))')
            .eq('competition_id', competition.id).eq('status', 'scheduled')
            .order('scheduled_at').order('round_number').order('wave_number'),
          supabase.from('competition_groups').select('*, group:groups(*)').eq('competition_id', competition.id),
        ]);
        fixtures = (fixturesRes.data as CompetitionFixture[]) || [];
        for (const group of (groupsRes.data || []) as CompetitionGroup[]) {
          teamNames[group.side] = group.team_name || group.group?.name || `Team ${group.side}`;
        }
      }
    }

    const views: CourtView[] = courts.map((court, index) => ({
      court,
      match: matches.find((m) => m.court_id === court.id) || null,
      waiting: queues.filter((q) => q.court_id === court.id && q.status === 'waiting'),
      resting: queues.filter((q) => q.court_id === court.id && q.status === 'resting'),
      fixtures: fixtures.filter((fixture) => fixture.court_number === index + 1),
      teamNames,
    }));

    // Build game count per player
    const countMap: Record<string, { name: string; skill: string; count: number }> = {};
    for (const m of (allMatchesRes.data as any) || []) {
      for (const team of m.teams || []) {
        for (const mp of team.players || []) {
          const id = mp.player_id;
          if (!countMap[id]) countMap[id] = { name: mp.profile?.full_name || '?', skill: mp.profile?.skill_level || 'level_5', count: 0 };
          countMap[id].count += 1;
        }
      }
    }

    // Determine live status from queue
    const playingIds = new Set(queues.filter((q) => q.status === 'playing').map((q) => q.player_id));
    const waitingIds = new Set(queues.filter((q) => q.status === 'waiting').map((q) => q.player_id));
    const restingIds = new Set(queues.filter((q) => q.status === 'resting').map((q) => q.player_id));

    // Merge available players (may not have played yet) into the count map
    for (const a of ((availRes.data as any) || []).filter((row: any) => row.profile?.environment === envFilter)) {
      const id = a.player_id;
      if (!countMap[id]) countMap[id] = { name: (a.profile as any)?.full_name || '?', skill: (a.profile as any)?.skill_level || 'level_5', count: 0 };
    }

    const gameCounts: PlayerGameCount[] = Object.entries(countMap).map(([id, { name, skill, count }]) => ({
      id,
      name,
      skill,
      count,
      status: playingIds.has(id) ? 'playing' : restingIds.has(id) ? 'resting' : waitingIds.has(id) ? 'waiting' : 'idle',
    }));

    // Sort: playing first, then waiting/resting, then idle; within each group sort by count desc
    const statusOrder = { playing: 0, waiting: 1, resting: 2, idle: 3 };
    gameCounts.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || b.count - a.count);

    setCourtViews(views);
    setPlayerGameCounts(gameCounts);
    setLastUpdated(new Date());
  }, [envFilter, sessions]);

  useEffect(() => {
    if (!selectedSession) return;
    loadData(selectedSession);

    const channel = supabase
      .channel(`courts-live-${selectedSession}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, () => loadData(selectedSession))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_team_players' }, () => loadData(selectedSession))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'court_queues' }, () => loadData(selectedSession))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'courts' }, () => loadData(selectedSession))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competition_fixtures' }, () => loadData(selectedSession))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'competition_fixture_players' }, () => loadData(selectedSession))
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));

    const poll = setInterval(() => loadData(selectedSession), 30000);
    return () => { clearInterval(poll); supabase.removeChannel(channel); };
  }, [selectedSession, loadData]);

  const inUse = courtViews.filter((cv) => cv.court.status === 'in_use').length;
  const totalPlaying = courtViews.reduce((sum, cv) => {
    return sum + (cv.match ? cv.match.teams.reduce((s, t) => s + (t.players?.length || 0), 0) : 0);
  }, 0);
  const totalWaiting = courtViews.reduce((sum, cv) => sum + cv.waiting.length + cv.resting.length, 0);
  const scheduledFixtures = courtViews.reduce((sum, cv) => sum + cv.fixtures.length, 0);
  const selectedSessionRecord = sessions.find((s) => s.id === selectedSession);
  const isChallenge = selectedSessionRecord?.session_type === 'group_challenge';
  const selectedSessionTitle = selectedSessionRecord?.title || '';
  const playerNextGame = getPlayerNextGame(user?.id, courtViews, playerGameCounts, isChallenge);
  const nextUpItems = getNextUpItems(courtViews);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="animate-pulse grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-72 bg-gray-200 rounded-3xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
            <Monitor className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 leading-tight">Live Courts</h1>
            <div className="flex items-center gap-2 mt-0.5">
              <div className={`w-1.5 h-1.5 rounded-full ${live ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
              <span className="text-xs text-gray-400">
                {live ? 'Live' : 'Reconnecting'} - {lastUpdated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
              {live ? <Wifi className="w-3 h-3 text-emerald-500" /> : <WifiOff className="w-3 h-3 text-gray-400" />}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {sessions.length > 1 && (
            <select
              value={selectedSession || ''}
              onChange={(e) => setSelectedSession(e.target.value)}
              className="bg-gray-100 border border-gray-200 text-gray-900 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
            >
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.title}</option>
              ))}
            </select>
          )}
          {sessions.length === 1 && (
            <span className="text-gray-500 text-sm">{sessions[0]?.title}</span>
          )}
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24">
          <Monitor className="w-16 h-16 text-gray-300 mb-4" />
          <p className="text-gray-500 text-lg font-medium">No active sessions</p>
          <p className="text-gray-400 text-sm mt-1">Start a session from the Admin panel</p>
        </div>
      ) : (
        <>
          {/* Stats bar */}
          <div className="grid grid-cols-4 gap-3 mb-6">
            <StatCard label="Courts" value={courtViews.length} color="text-gray-900" />
            <StatCard label="In Play" value={inUse} color="text-emerald-600" bg="bg-emerald-50 border-emerald-200" />
            <StatCard label="Playing" value={totalPlaying} color="text-sky-600" bg="bg-sky-50 border-sky-200" />
            <StatCard label={isChallenge ? 'Scheduled' : 'Waiting'} value={isChallenge ? scheduledFixtures : totalWaiting} color="text-amber-600" bg="bg-amber-50 border-amber-200" />
          </div>

          {playerNextGame && (
            <PlayerNextGameCard nextGame={playerNextGame} sessionTitle={selectedSessionTitle} />
          )}

          {nextUpItems.length > 0 && (
            <NextUpBoard items={nextUpItems} />
          )}

          {/* Court grid */}
          {courtViews.length === 0 ? (
            <div className="bg-white border border-gray-200 border-dashed rounded-3xl p-16 text-center">
              <Users className="w-12 h-12 text-gray-300 mx-auto mb-3" />
              <p className="text-gray-400">No courts set up for this session</p>
            </div>
          ) : (
            <div className={`grid gap-5 ${courtViews.length === 1 ? 'max-w-lg' : courtViews.length === 2 ? 'sm:grid-cols-2 max-w-3xl' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
              {courtViews.map((cv) => (
                <CourtCard key={cv.court.id} cv={cv} />
              ))}
            </div>
          )}

          {/* Player game count list */}
          {playerGameCounts.length > 0 && (
            <div className="mt-6 bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-gray-900 font-semibold flex items-center gap-2 text-sm mb-4">
                <Hash className="w-4 h-4 text-emerald-600" />
                Players &amp; Games Played
                <span className="text-gray-400 font-normal ml-1">({playerGameCounts.length})</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                {playerGameCounts.map((p) => {
                  const statusStyles: Record<string, string> = {
                    playing: 'border-emerald-300 bg-emerald-50',
                    waiting: 'border-amber-200 bg-amber-50',
                    resting: 'border-gray-200 bg-gray-100',
                    idle: 'border-gray-200 bg-white',
                  };
                  const dotStyles: Record<string, string> = {
                    playing: 'bg-emerald-500 animate-pulse',
                    waiting: 'bg-amber-500',
                    resting: 'bg-gray-400',
                    idle: 'bg-gray-300',
                  };
                  const countColor = p.count >= 4 ? 'text-emerald-600' : p.count >= 2 ? 'text-amber-600' : p.count === 1 ? 'text-sky-600' : 'text-gray-400';
                  return (
                    <div key={p.id} className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 transition-all ${statusStyles[p.status]}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${skillLevelColor(p.skill)}`}>
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-gray-800 text-xs font-medium truncate leading-tight">{p.name.split(' ')[0]}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotStyles[p.status]}`} />
                          <span className="text-gray-400 text-xs capitalize">{p.status === 'idle' ? 'ready' : p.status}</span>
                        </div>
                      </div>
                      <div className={`text-lg font-bold flex-shrink-0 tabular-nums ${countColor}`}>{p.count}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg?: string }) {
  return (
    <div className={`rounded-2xl border p-4 text-center ${bg || 'bg-white border-gray-200'}`}>
      <p className={`text-2xl md:text-3xl font-bold ${color}`}>{value}</p>
      <p className="text-gray-400 text-xs mt-1">{label}</p>
    </div>
  );
}

function PlayerNextGameCard({ nextGame, sessionTitle }: { nextGame: PlayerNextGame; sessionTitle: string }) {
  const styles = {
    emerald: {
      wrap: 'bg-emerald-50 border-emerald-200',
      icon: 'bg-emerald-100 text-emerald-700',
      text: 'text-emerald-700',
      badge: 'bg-emerald-100 text-emerald-700',
    },
    amber: {
      wrap: 'bg-amber-50 border-amber-200',
      icon: 'bg-amber-100 text-amber-700',
      text: 'text-amber-700',
      badge: 'bg-amber-100 text-amber-700',
    },
    sky: {
      wrap: 'bg-sky-50 border-sky-200',
      icon: 'bg-sky-100 text-sky-700',
      text: 'text-sky-700',
      badge: 'bg-sky-100 text-sky-700',
    },
    gray: {
      wrap: 'bg-white border-gray-200',
      icon: 'bg-gray-100 text-gray-500',
      text: 'text-gray-600',
      badge: 'bg-gray-100 text-gray-600',
    },
  }[nextGame.tone];

  return (
    <div className={`mb-6 rounded-3xl border p-4 sm:p-5 ${styles.wrap}`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 ${styles.icon}`}>
            {nextGame.state === 'playing' ? <Monitor className="w-5 h-5" /> : <Clock className="w-5 h-5" />}
          </div>
          <div className="min-w-0">
            <p className={`text-xs font-semibold uppercase tracking-wide ${styles.text}`}>
              Your next game
            </p>
            <h2 className="text-gray-900 font-bold text-lg mt-0.5">{nextGame.title}</h2>
            <p className="text-gray-500 text-sm mt-1">{nextGame.detail}</p>
            {sessionTitle && <p className="text-gray-400 text-xs mt-1">{sessionTitle}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap sm:justify-end">
          {nextGame.courtName && (
            <span className={`px-3 py-2 rounded-xl text-sm font-bold ${styles.badge}`}>
              {nextGame.courtName}
            </span>
          )}
          {nextGame.positionLabel && (
            <span className="px-3 py-2 rounded-xl text-sm font-semibold bg-white/80 text-gray-700 border border-white">
              {nextGame.positionLabel}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function NextUpBoard({ items }: { items: NextUpItem[] }) {
  return (
    <div className="mb-6 bg-white border border-gray-200 rounded-3xl p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-gray-900 font-bold text-lg">Next Up Board</h2>
          <p className="text-gray-400 text-xs mt-0.5">Where waiting players are expected to play next</p>
        </div>
        <span className="bg-amber-50 text-amber-700 border border-amber-200 rounded-xl px-3 py-1.5 text-xs font-bold">
          {items.length} waiting
        </span>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`flex items-center gap-3 rounded-2xl border px-3 py-3 ${
              item.status === 'resting'
                ? 'bg-amber-50 border-amber-200'
                : 'bg-gray-50 border-gray-200'
            }`}
          >
            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
              item.status === 'resting'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-white text-gray-600'
            }`}>
              {item.playerName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-gray-900 text-sm font-bold truncate">{item.playerName.split(' ')[0]}</p>
              <p className="text-gray-500 text-xs truncate">{item.courtName} - {item.label}</p>
            </div>
            <span className={`text-xs font-bold rounded-lg px-2 py-1 flex-shrink-0 ${
              item.status === 'resting'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-emerald-50 text-emerald-700'
            }`}>
              #{item.queueNumber}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CourtCard({ cv }: { cv: CourtView }) {
  const { court, match, waiting, resting, fixtures, teamNames } = cv;
  const nextFixture = fixtures[0];
  const teamA = match?.teams?.find((t) => t.team_label === 'A');
  const teamB = match?.teams?.find((t) => t.team_label === 'B');
  const [elapsed, setElapsed] = useState(
    match ? Math.floor((Date.now() - new Date(match.started_at).getTime()) / 60000) : 0
  );

  useEffect(() => {
    if (!match) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - new Date(match.started_at).getTime()) / 60000)), 15000);
    return () => clearInterval(t);
  }, [match]);

  const isActive = court.status === 'in_use';

  return (
    <div className={`rounded-3xl border overflow-hidden transition-all duration-300 ${
      isActive ? 'bg-white border-emerald-300 shadow-sm shadow-emerald-500/10' : 'bg-white border-gray-200'
    }`}>
      {/* Court header */}
      <div className={`px-5 py-4 flex items-center justify-between ${isActive ? 'bg-emerald-50' : ''}`}>
        <div>
          <h2 className="text-gray-900 font-bold text-xl">{court.name}</h2>
          <div className="flex items-center gap-2 mt-0.5">
            <div className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : court.status === 'maintenance' ? 'bg-red-400' : nextFixture ? 'bg-amber-500' : 'bg-gray-400'}`} />
            <span className={`text-xs font-medium ${isActive ? 'text-emerald-600' : court.status === 'maintenance' ? 'text-red-500' : nextFixture ? 'text-amber-600' : 'text-gray-400'}`}>
              {isActive ? 'In Play' : court.status === 'maintenance' ? 'Maintenance' : nextFixture ? 'Scheduled' : 'Available'}
            </span>
          </div>
        </div>
        {match && (
          <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-xl px-3 py-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-600" />
            <span className="text-amber-600 text-sm font-mono font-bold">{elapsed}m</span>
          </div>
        )}
      </div>

      <div className="px-5 pb-5 space-y-4">
        {match ? (
          <>
            {/* Playing section */}
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Now Playing</p>
              <div className="space-y-2">
                {[teamA, teamB].map((team, idx) => team && (
                  <div key={team.id} className={`rounded-2xl p-3 ${idx === 0 ? 'bg-sky-50 border border-sky-200' : 'bg-rose-50 border border-rose-200'}`}>
                    <p className={`text-xs font-bold mb-2 ${idx === 0 ? 'text-sky-600' : 'text-rose-600'}`}>
                      {team.team_name || `Team ${team.team_label}`}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {team.players?.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${idx === 0 ? 'bg-sky-100 text-sky-600' : 'bg-rose-100 text-rose-600'}`}>
                            {p.profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <div>
                            <p className="text-gray-900 text-sm font-medium leading-tight">{p.profile?.full_name?.split(' ')[0]}</p>
                            <p className={`text-xs ${skillLevelTextColor(p.profile?.skill_level)}`}>
                              {skillLevelLabel(p.profile?.skill_level)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Waiting list */}
            {(waiting.length > 0 || resting.length > 0) && (
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Up Next ({waiting.length + resting.length})
                </p>
                <div className="flex flex-wrap gap-2">
                  {[...waiting, ...resting].map((q, i) => (
                    <div key={q.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 ${q.status === 'resting' ? 'bg-amber-50 border border-amber-200' : 'bg-gray-100 border border-gray-200'}`}>
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-semibold text-xs ${q.status === 'resting' ? 'bg-amber-100 text-amber-600' : 'bg-gray-200 text-gray-600'}`}>
                        {q.profile?.full_name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div>
                        <p className={`text-sm font-medium leading-tight ${q.status === 'resting' ? 'text-amber-700' : 'text-gray-700'}`}>
                          {q.profile?.full_name?.split(' ')[0]}
                        </p>
                        {q.status === 'resting' && (
                          <p className="text-xs text-amber-600">resting</p>
                        )}
                        {q.status === 'waiting' && i === 0 && (
                          <p className="text-xs text-emerald-600">next up</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : nextFixture ? (
          <div>
            <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-2">Next scheduled match</p>
            <p className="text-xs text-gray-500 mb-3">
              Round {nextFixture.round_number} · Wave {nextFixture.wave_number} · {new Date(nextFixture.scheduled_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
            <div className="space-y-2">
              {(['A', 'B'] as const).map((side) => (
                <div key={side} className={`rounded-2xl border p-3 ${side === 'A' ? 'bg-sky-50 border-sky-200' : 'bg-rose-50 border-rose-200'}`}>
                  <p className={`text-xs font-bold mb-1 ${side === 'A' ? 'text-sky-700' : 'text-rose-700'}`}>{teamNames[side]}</p>
                  <p className="text-sm text-gray-900 font-medium">
                    {nextFixture.players?.filter((player) => player.side === side).sort((a, b) => a.team_position - b.team_position).map((player) => player.profile?.full_name || 'Player').join(' & ') || 'Players to be assigned'}
                  </p>
                </div>
              ))}
            </div>
            {fixtures.length > 1 && <p className="text-xs text-gray-500 mt-3">+{fixtures.length - 1} more scheduled on this court</p>}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-10 text-gray-300">
            <div className="w-12 h-12 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center mb-3">
              <Users className="w-5 h-5" />
            </div>
            <p className="text-gray-400 text-sm">Court available</p>
          </div>
        )}
      </div>
    </div>
  );
}


