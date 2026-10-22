import { ReactNode, useEffect, useState } from 'react';
import { supabase, Session, SessionAvailability, Profile, Environment } from '../lib/supabase';
import { SessionRecapPanel, MatchWithDetails } from '../components/SessionRecap';
import { skillLevelColor, skillLevelLabel, skillLevelShortLabel } from '../lib/skillLevels';
import { Calendar, Users, CheckCircle, Clock, MapPin, Search, X, ClipboardList, Trophy, ChevronDown, Copy, Check } from 'lucide-react';

type SessionFilter = 'all' | 'open' | 'in_progress' | 'completed';

export default function SessionsPage({ envFilter = 'prod' }: { envFilter?: Environment }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [availability, setAvailability] = useState<(SessionAvailability & { profile: Profile })[]>([]);
  const [recapMatches, setRecapMatches] = useState<MatchWithDetails[]>([]);
  const [playerSearch, setPlayerSearch] = useState('');
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>('all');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    loadSessions();
  }, [envFilter]);

  async function loadSessions() {
    setLoading(true);
    const { data } = await supabase
      .from('sessions')
      .select('*, group:groups(*, created_by_profile:profiles!groups_created_by_fkey(full_name))')
      .eq('environment', envFilter)
      .order('session_date', { ascending: false })
      .order('start_time', { ascending: false });

    const list: Session[] = (data as Session[]) || [];
    setSessions(list);

    const auto = list.find((s) => s.status === 'open') ?? list.find((s) => s.status === 'in_progress') ?? list[0] ?? null;
    if (auto) await loadSessionDetails(auto.id, auto.status);
    else {
      setSelectedSession(null);
      setAvailability([]);
      setRecapMatches([]);
    }
    setLoading(false);
  }

  async function loadSessionDetails(sessionId: string, status?: string, forceOpen = false) {
    if (selectedSession === sessionId && !forceOpen) {
      setSelectedSession(null);
      setAvailability([]);
      setRecapMatches([]);
      setPlayerSearch('');
      return;
    }

    setSelectedSession(sessionId);
    setPlayerSearch('');
    setDetailLoading(true);
    setAvailability([]);
    setRecapMatches([]);

    const selected = sessions.find((s) => s.id === sessionId);
    const sessionStatus = status || selected?.status;

    if (sessionStatus === 'completed') {
      const { data } = await supabase
        .from('matches')
        .select(`*, court:courts(*), teams:match_teams(*, players:match_team_players(*, profile:profiles(*)))`)
        .eq('session_id', sessionId)
        .eq('status', 'completed')
        .order('ended_at', { ascending: false });
      setRecapMatches((data as MatchWithDetails[]) || []);
    } else {
      const { data } = await supabase
        .from('session_availability')
        .select('*, profile:profiles(*)')
        .eq('session_id', sessionId)
        .eq('available', true);
      setAvailability((data as (SessionAvailability & { profile: Profile })[]) || []);
    }

    setDetailLoading(false);
  }

  const searchTerm = playerSearch.trim().toLowerCase();
  const filteredAvailability = searchTerm
    ? availability.filter((a) => {
        const name = a.profile?.full_name?.toLowerCase() || '';
        const skill = skillLevelLabel(a.profile?.skill_level).toLowerCase();
        return name.includes(searchTerm) || skill.includes(searchTerm);
      })
    : availability;

  const filteredSessions = sessionFilter === 'all'
    ? sessions
    : sessions.filter((session) => session.status === sessionFilter);

  const counts = {
    all: sessions.length,
    open: sessions.filter((s) => s.status === 'open').length,
    in_progress: sessions.filter((s) => s.status === 'in_progress').length,
    completed: sessions.filter((s) => s.status === 'completed').length,
  };
  const envLabel = envFilter === 'prod' ? 'Production' : 'Dev / Testing';
  const envDescription = envFilter === 'prod' ? 'Production sessions' : 'Dev/testing sessions';

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-gray-200 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Sessions</h1>
          <p className="text-gray-500 text-sm mt-1">{envDescription}, player lists, and completed-session recaps.</p>
        </div>
        <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 text-xs font-semibold px-3 py-2 rounded-xl w-fit">
          {envLabel}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl p-1.5 flex gap-1.5 overflow-x-auto w-fit max-w-full mb-5">
        <FilterButton label="All" count={counts.all} active={sessionFilter === 'all'} onClick={() => setSessionFilter('all')} />
        <FilterButton label="Open" count={counts.open} active={sessionFilter === 'open'} onClick={() => setSessionFilter('open')} />
        <FilterButton label="Live" count={counts.in_progress} active={sessionFilter === 'in_progress'} onClick={() => setSessionFilter('in_progress')} />
        <FilterButton label="Done" count={counts.completed} active={sessionFilter === 'completed'} onClick={() => setSessionFilter('completed')} />
      </div>

      <div className="space-y-4">
        {filteredSessions.length === 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No {envLabel.toLowerCase()} sessions found</p>
          </div>
        )}

        {filteredSessions.map((session) => {
          const isSelected = selectedSession === session.id;
          return (
            <div key={session.id} className="space-y-3">
              <button
                onClick={() => loadSessionDetails(session.id, session.status)}
                className={`w-full text-left bg-white border rounded-2xl px-4 py-3 transition-all ${
                  isSelected
                    ? 'border-emerald-400 shadow-sm shadow-emerald-500/10'
                    : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                }`}
              >
                <div className="flex flex-col xl:flex-row xl:items-center gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-wrap xl:flex-nowrap xl:flex-1">
                    <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${isSelected ? 'rotate-180 text-emerald-600' : ''}`} />
                    <h3 className="text-gray-900 font-bold text-lg leading-snug min-w-0">{session.title}</h3>
                    <StatusBadge status={session.status} />
                    {session.group?.name && (
                      <span className="text-xs px-2.5 py-1 rounded-full bg-sky-50 text-sky-700 border border-sky-100 font-semibold whitespace-normal">
                        {session.group.name}
                        {session.group.created_by_profile?.full_name ? ` - ${session.group.created_by_profile.full_name}` : ''}
                      </span>
                    )}
                  </div>

                  <div className="grid sm:grid-cols-3 gap-2 text-gray-600 text-sm xl:w-[48%]">
                    <InfoChip compact icon={<Calendar className="w-4 h-4" />} label={formatDate(session.session_date)} />
                    <InfoChip compact icon={<Clock className="w-4 h-4" />} label={`${session.start_time.slice(0, 5)} - ${session.end_time.slice(0, 5)}`} />
                    <InfoChip compact icon={<MapPin className="w-4 h-4" />} label={session.venue} />
                  </div>
                </div>
              </button>

              {isSelected && (
                <div className="pl-0 sm:pl-4">
                  {session.status === 'completed' ? (
                    detailLoading ? (
                      <PanelSkeleton />
                    ) : (
                      <div className="space-y-3">
                        <SessionRecapPanel session={session} matches={recapMatches} />
                        <SessionLeaderboard session={session} matches={recapMatches} />
                        <SessionMatchHistory matches={recapMatches} />
                      </div>
                    )
                  ) : (
                    <AvailabilityPanel
                      availability={availability}
                      filteredAvailability={filteredAvailability}
                      playerSearch={playerSearch}
                      setPlayerSearch={setPlayerSearch}
                      detailLoading={detailLoading}
                      envLabel={envLabel}
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type SessionLeaderboardEntry = {
  id: string;
  name: string;
  skill: string;
  wins: number;
  losses: number;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  winRate: number;
};

function buildSessionLeaderboard(matches: MatchWithDetails[]): SessionLeaderboardEntry[] {
  const rows = new Map<string, Omit<SessionLeaderboardEntry, 'pointDiff' | 'winRate'>>();

  const ensurePlayer = (playerId: string, profile?: Profile | null) => {
    if (!rows.has(playerId)) {
      rows.set(playerId, {
        id: playerId,
        name: profile?.full_name || 'Unknown player',
        skill: profile?.skill_level || 'level_5',
        wins: 0,
        losses: 0,
        played: 0,
        pointsFor: 0,
        pointsAgainst: 0,
      });
    }
    return rows.get(playerId)!;
  };

  for (const match of matches) {
    const teamA = match.teams?.find((team) => team.team_label === 'A');
    const teamB = match.teams?.find((team) => team.team_label === 'B');
    const scoreA = Number(match.score_a) || 0;
    const scoreB = Number(match.score_b) || 0;

    for (const team of [teamA, teamB]) {
      if (!team) continue;
      const isTeamA = team.team_label === 'A';
      const won = match.winner_team === team.team_label;
      const hasResult = match.winner_team === 'A' || match.winner_team === 'B';
      const pointsFor = isTeamA ? scoreA : scoreB;
      const pointsAgainst = isTeamA ? scoreB : scoreA;

      for (const player of team.players || []) {
        const entry = ensurePlayer(player.player_id, player.profile);
        entry.played += 1;
        entry.pointsFor += pointsFor;
        entry.pointsAgainst += pointsAgainst;
        if (hasResult) {
          if (won) entry.wins += 1;
          else entry.losses += 1;
        }
      }
    }
  }

  return Array.from(rows.values())
    .map((entry) => ({
      ...entry,
      pointDiff: entry.pointsFor - entry.pointsAgainst,
      winRate: entry.played > 0 ? Math.round((entry.wins / entry.played) * 100) : 0,
    }))
    .sort((a, b) =>
      b.wins - a.wins ||
      b.pointDiff - a.pointDiff ||
      b.winRate - a.winRate ||
      b.played - a.played ||
      a.name.localeCompare(b.name)
    );
}

function SessionLeaderboard({ session, matches }: { session: Session; matches: MatchWithDetails[] }) {
  const [showAll, setShowAll] = useState(false);
  const [copied, setCopied] = useState(false);
  const leaderboard = buildSessionLeaderboard(matches);
  const visibleEntries = showAll ? leaderboard : leaderboard.slice(0, 10);

  async function copyLeaderboard() {
    const rows = leaderboard.slice(0, 10).map((entry, index) =>
      `${index + 1}. ${entry.name} | ${entry.wins}W ${entry.losses}L | ${entry.winRate}% | ${entry.pointDiff > 0 ? '+' : ''}${entry.pointDiff} diff`
    );
    const text = [
      `Rally Master | ${session.title}`,
      `${formatDate(session.session_date)} | Session Leaderboard`,
      '',
      ...rows,
      '',
      'Ranked by wins, then point difference.',
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch (error) {
      console.error('Unable to copy session leaderboard', error);
    }
  }

  if (leaderboard.length === 0) return null;

  return (
    <div className="bg-white border border-amber-200 rounded-2xl p-3 sm:p-4 overflow-hidden">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-gray-900 font-semibold flex items-center gap-2 text-base">
            <Trophy className="w-5 h-5 text-amber-500 flex-shrink-0" />
            Session Leaderboard
          </h3>
          <p className="text-xs text-gray-500 mt-0.5 break-words">
            {session.title} | {formatDate(session.session_date)} | Top {Math.min(10, leaderboard.length)} of {leaderboard.length}
          </p>
        </div>
        <button
          type="button"
          onClick={copyLeaderboard}
          title="Copy leaderboard"
          className="w-9 h-9 flex items-center justify-center rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white transition-colors flex-shrink-0"
        >
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>

      <div className="rounded-xl border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-[28px_minmax(0,1fr)_48px_48px_50px] sm:grid-cols-[36px_minmax(0,1fr)_64px_64px_64px] gap-1 sm:gap-2 items-center bg-gray-50 px-2 py-1.5 text-[10px] sm:text-xs font-semibold uppercase text-gray-400">
          <span>#</span>
          <span>Player</span>
          <span className="text-center">W-L</span>
          <span className="text-center">Win%</span>
          <span className="text-center">Diff</span>
        </div>
        {visibleEntries.map((entry, index) => (
          <div
            key={entry.id}
            className={`grid grid-cols-[28px_minmax(0,1fr)_48px_48px_50px] sm:grid-cols-[36px_minmax(0,1fr)_64px_64px_64px] gap-1 sm:gap-2 items-center px-2 py-2 border-t border-gray-100 min-h-[48px] ${
              index === 0 ? 'bg-amber-50' : index === 1 ? 'bg-gray-50' : index === 2 ? 'bg-orange-50/60' : 'bg-white'
            }`}
          >
            <span className={`text-xs font-bold text-center ${index === 0 ? 'text-amber-600' : index === 1 ? 'text-gray-500' : index === 2 ? 'text-orange-600' : 'text-gray-400'}`}>
              {index + 1}
            </span>
            <div className="min-w-0 flex items-center gap-2">
              <span className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold flex-shrink-0 ${skillLevelColor(entry.skill)}`}>
                {entry.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-xs sm:text-sm font-semibold text-gray-900 leading-tight break-words">{entry.name}</p>
                <p className="text-[10px] sm:text-xs text-gray-400 leading-tight">
                  {skillLevelShortLabel(entry.skill)} | {entry.played} played
                </p>
              </div>
            </div>
            <span className="text-xs sm:text-sm font-semibold text-center tabular-nums">
              <span className="text-emerald-600">{entry.wins}</span><span className="text-gray-300">-</span><span className="text-red-500">{entry.losses}</span>
            </span>
            <span className={`text-xs sm:text-sm font-bold text-center tabular-nums ${entry.winRate >= 60 ? 'text-emerald-600' : 'text-amber-600'}`}>
              {entry.winRate}%
            </span>
            <span className={`text-xs sm:text-sm font-bold text-center tabular-nums ${entry.pointDiff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {entry.pointDiff > 0 ? '+' : ''}{entry.pointDiff}
            </span>
          </div>
        ))}
      </div>

      {leaderboard.length > 10 && (
        <button
          type="button"
          onClick={() => setShowAll((current) => !current)}
          className="w-full mt-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors"
        >
          {showAll ? 'Show top 10' : `Show all ${leaderboard.length} players`}
        </button>
      )}
      <p className="text-[10px] text-gray-400 text-center mt-1.5">Ranked by wins, then point difference</p>
    </div>
  );
}

function SessionMatchHistory({ matches }: { matches: MatchWithDetails[] }) {
  if (matches.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-5 text-center">
        <ClipboardList className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-gray-500 text-sm">No completed matches recorded for this session.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <h3 className="text-gray-800 font-semibold mb-4 flex items-center gap-2 text-sm">
        <ClipboardList className="w-4 h-4 text-gray-400" /> Match History ({matches.length})
      </h3>
      <div className="space-y-2">
        {matches.map((m) => {
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
                {winnerLabel && (
                  <div className="flex items-center gap-1 text-xs text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-lg flex-shrink-0 font-medium">
                    <Trophy className="w-3 h-3" />
                    <span>{winnerLabel === 'A' ? 'Team A' : 'Team B'}</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
                <MatchTeamBlock label="Team A" names={namesA} won={winnerLabel === 'A'} />
                <div className="flex flex-col items-center justify-center px-1">
                  <ScorePill score={m.score_a} won={winnerLabel === 'A'} />
                  <span className="text-gray-300 text-xs font-bold my-0.5">-</span>
                  <ScorePill score={m.score_b} won={winnerLabel === 'B'} />
                </div>
                <MatchTeamBlock label="Team B" names={namesB} won={winnerLabel === 'B'} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MatchTeamBlock({ label, names, won }: { label: string; names: string; won: boolean }) {
  return (
    <div className={`rounded-xl border p-2 min-w-0 ${won ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'}`}>
      <p className={`text-xs font-semibold mb-1 ${won ? 'text-emerald-700' : 'text-gray-400'}`}>{label}</p>
      <p className={`text-sm font-semibold leading-snug break-words ${won ? 'text-emerald-800' : 'text-gray-700'}`}>{names}</p>
    </div>
  );
}

function ScorePill({ score, won }: { score: number; won: boolean }) {
  return (
    <span className={`text-sm font-bold tabular-nums px-2 py-1 rounded-lg ${won ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-500'}`}>
      {score}
    </span>
  );
}

function AvailabilityPanel({
  availability,
  filteredAvailability,
  playerSearch,
  setPlayerSearch,
  detailLoading,
  envLabel,
}: {
  availability: (SessionAvailability & { profile: Profile })[];
  filteredAvailability: (SessionAvailability & { profile: Profile })[];
  playerSearch: string;
  setPlayerSearch: (value: string) => void;
  detailLoading: boolean;
  envLabel: string;
}) {
  if (detailLoading) return <PanelSkeleton />;

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
      <h3 className="text-gray-900 font-semibold mb-4 flex items-center gap-2">
        <Users className="w-5 h-5 text-emerald-600" />
        Available Players ({availability.length})
      </h3>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={playerSearch}
          onChange={(e) => setPlayerSearch(e.target.value)}
          placeholder="Search players or skill..."
          className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl pl-9 pr-9 py-3 text-sm focus:outline-none focus:border-emerald-500"
        />
        {playerSearch && (
          <button
            onClick={() => setPlayerSearch('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100"
            title="Clear search"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {availability.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No {envLabel.toLowerCase()} players have confirmed availability yet.</p>
      ) : filteredAvailability.length === 0 ? (
        <p className="text-gray-400 text-sm text-center py-8">No players match your search.</p>
      ) : (
        <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {filteredAvailability.map((a) => (
            <div key={a.id} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 hover:bg-gray-100 transition-colors">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 text-sm font-bold flex-shrink-0">
                {a.profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm font-semibold truncate">{a.profile?.full_name}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${skillLevelColor(a.profile?.skill_level)}`}>
                  {skillLevelLabel(a.profile?.skill_level)}
                </span>
              </div>
              <CheckCircle className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterButton({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-sm font-semibold transition-all whitespace-nowrap ${
        active
          ? 'bg-emerald-500 text-white shadow-sm'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
      }`}
    >
      {label}
      <span className={`text-xs px-1.5 py-0.5 rounded-lg ${active ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>{count}</span>
    </button>
  );
}

function InfoChip({ icon, label, compact = false }: { icon: ReactNode; label: string; compact?: boolean }) {
  return (
    <div className={`flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 min-w-0 ${compact ? 'py-1.5' : 'py-2'}`}>
      <span className="text-gray-400 flex-shrink-0">{icon}</span>
      <span className="text-gray-700 font-medium truncate">{label}</span>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 animate-pulse">
      <div className="h-6 bg-gray-200 rounded-lg w-1/2 mb-4" />
      <div className="space-y-3">
        <div className="h-16 bg-gray-100 rounded-xl" />
        <div className="h-16 bg-gray-100 rounded-xl" />
        <div className="h-16 bg-gray-100 rounded-xl" />
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: 'bg-emerald-50 text-emerald-600',
    in_progress: 'bg-amber-50 text-amber-600',
    completed: 'bg-gray-100 text-gray-500',
    cancelled: 'bg-red-50 text-red-500',
  };
  const labels: Record<string, string> = {
    open: 'Open',
    in_progress: 'Live',
    completed: 'Done',
    cancelled: 'Cancelled',
  };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${styles[status] || styles.open}`}>
      {labels[status] || status}
    </span>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}
