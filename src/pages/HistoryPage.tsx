import { useEffect, useState } from 'react';
import { supabase, PlayerMatchHistory, TeamLabel, Environment } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { History, Trophy, XCircle, Minus, MapPin, Calendar, User, Clock, Users } from 'lucide-react';

interface MatchTeamSummary {
  A: string;
  B: string;
  partner: string;
  opponents: string;
}

const RESULT_STYLES: Record<string, { bg: string; text: string; label: string; icon: React.FC<any> }> = {
  win: { bg: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-600', label: 'Win', icon: Trophy },
  loss: { bg: 'bg-red-50 border-red-200', text: 'text-red-500', label: 'Loss', icon: XCircle },
  draw: { bg: 'bg-gray-50 border-gray-200', text: 'text-gray-500', label: 'Draw', icon: Minus },
};

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

export default function HistoryPage({ envFilter = 'prod' }: { envFilter?: Environment }) {
  const { user } = useAuth();
  const [history, setHistory] = useState<PlayerMatchHistory[]>([]);
  const [matchTeamNames, setMatchTeamNames] = useState<Record<string, MatchTeamSummary>>({});
  const [loading, setLoading] = useState(true);
  const [resultFilter, setResultFilter] = useState<'all' | 'win' | 'loss' | 'draw'>('all');

  useEffect(() => {
    if (!user) return;
    const userId = user.id;
    setLoading(true);
    async function loadHistory() {
      const { data } = await supabase
        .from('player_match_history')
        .select('*')
        .eq('player_id', userId)
        .order('session_date', { ascending: false });

      const rows = (data as PlayerMatchHistory[]) || [];
      setHistory(rows);

      const matchIds = [...new Set(rows.map((h) => h.match_id))];
      if (matchIds.length === 0) {
        setMatchTeamNames({});
        setLoading(false);
        return;
      }

      const { data: matchRows } = await supabase
        .from('matches')
        .select(`id, teams:match_teams(team_label, players:match_team_players(player_id, profile:profiles(full_name)))`)
        .in('id', matchIds);

      const historyByMatch = Object.fromEntries(rows.map((row) => [row.match_id, row]));
      const namesByMatch: Record<string, MatchTeamSummary> = {};
      for (const match of (matchRows as any[]) || []) {
        const historyRow = historyByMatch[match.id];
        const opponentTeam: TeamLabel = historyRow?.my_team === 'A' ? 'B' : 'A';
        namesByMatch[match.id] = { A: 'Team A', B: 'Team B', partner: 'Partner', opponents: 'Opponents' };
        for (const team of match.teams || []) {
          const label = team.team_label as TeamLabel;
          const players = team.players || [];
          const names = players
            .map((p: any) => p.profile?.full_name?.split(' ')[0])
            .filter(Boolean)
            .join(' & ');
          namesByMatch[match.id][label] = names || `Team ${label}`;
          if (historyRow && label === historyRow.my_team) {
            const partnerNames = players
              .filter((p: any) => p.player_id !== userId)
              .map((p: any) => p.profile?.full_name?.split(' ')[0])
              .filter(Boolean)
              .join(' & ');
            namesByMatch[match.id].partner = partnerNames || 'Partner';
          }
          if (historyRow && label === opponentTeam) {
            const opponentNames = players
              .map((p: any) => p.profile?.full_name?.split(' ')[0])
              .filter(Boolean)
              .join(' & ');
            namesByMatch[match.id].opponents = opponentNames || `Team ${opponentTeam}`;
          }
        }
      }
      setMatchTeamNames(namesByMatch);
      setLoading(false);
    }

    loadHistory();
  }, [user]);

  const filtered = history.filter((h) => {
    const matchEnv = h.environment === envFilter;
    const matchResult = resultFilter === 'all' || h.result === resultFilter;
    return matchEnv && matchResult;
  });

  const wins = filtered.filter((h) => h.result === 'win').length;
  const losses = filtered.filter((h) => h.result === 'loss').length;
  const draws = filtered.filter((h) => h.result === 'draw').length;
  const winRate = filtered.length > 0 ? Math.round((wins / filtered.length) * 100) : 0;

  const timeline = [...filtered].sort((a, b) =>
    new Date(b.ended_at || b.started_at).getTime() - new Date(a.ended_at || a.started_at).getTime()
  );
  const envLabel = envFilter === 'prod' ? 'production' : 'dev/testing';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <History className="w-6 h-6 text-emerald-600" />
          My History
        </h1>
        <p className="text-gray-500 text-sm mt-1">Your complete match history across {envLabel} sessions.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex gap-1.5">
          {(['all', 'win', 'loss', 'draw'] as const).map((r) => (
            <button
              key={r}
              onClick={() => setResultFilter(r)}
              className={`px-3 py-2 rounded-xl text-xs font-medium transition-all capitalize ${
                resultFilter === r
                  ? 'bg-emerald-500 text-white'
                  : 'bg-white border border-gray-200 text-gray-500 hover:text-gray-800'
              }`}
            >
              {r === 'all' ? 'All Results' : r}
            </button>
          ))}
        </div>
      </div>

      {/* Summary stats */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-gray-200 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{filtered.length}</p>
            <p className="text-gray-400 text-xs mt-0.5">Matches</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-emerald-600">{wins}</p>
            <p className="text-emerald-600 text-xs mt-0.5">Wins</p>
          </div>
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-red-500">{losses}</p>
            <p className="text-red-500 text-xs mt-0.5">Losses</p>
          </div>
          <div className="bg-sky-50 border border-sky-200 rounded-2xl p-4 text-center">
            <p className="text-2xl font-bold text-sky-600">{winRate}%</p>
            <p className="text-sky-600 text-xs mt-0.5">Win Rate</p>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-gray-200 rounded-2xl" />)}
        </div>
      ) : timeline.length === 0 ? (
        <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-16 text-center">
          <History className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No match history yet</p>
          <p className="text-gray-400 text-sm mt-1">Your completed matches will appear here.</p>
        </div>
      ) : (
        <div className="relative space-y-4">
          <div className="absolute left-4 top-2 bottom-2 w-px bg-emerald-100 hidden sm:block" />
          {timeline.map((match) => {
            const style = RESULT_STYLES[match.result];
            const ResultIcon = style.icon;
            const scoreMyTeam = match.my_team === 'A' ? match.score_a : match.score_b;
            const scoreOpp = match.my_team === 'A' ? match.score_b : match.score_a;
            const opponentTeam: TeamLabel = match.my_team === 'A' ? 'B' : 'A';
            const teamNames = matchTeamNames[match.match_id];
            const myTeamNames = teamNames?.[match.my_team] || `Team ${match.my_team}`;
            const opponentTeamNames = teamNames?.[opponentTeam] || `Team ${opponentTeam}`;
            const matchTime = new Date(match.ended_at || match.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <div key={match.match_id} className="relative sm:pl-10">
                <div className={`hidden sm:flex absolute left-0 top-5 w-8 h-8 rounded-full border items-center justify-center bg-white ${style.text} ${style.bg}`}>
                  <ResultIcon className="w-4 h-4" />
                </div>
                <div className={`bg-white border rounded-2xl overflow-hidden shadow-sm ${match.result === 'win' ? 'border-emerald-200' : match.result === 'loss' ? 'border-red-200' : 'border-gray-200'}`}>
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-semibold ${style.bg} ${style.text}`}>
                            <ResultIcon className="w-3.5 h-3.5" />
                            {style.label}
                          </span>
                          {match.session_type === 'group_challenge' && (
                            <span className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-violet-700 text-xs font-semibold">
                              <Users className="w-3.5 h-3.5" /> Challenge
                            </span>
                          )}
                          <span className="text-gray-900 font-semibold">{scoreMyTeam} - {scoreOpp}</span>
                        </div>
                        <h3 className="text-gray-900 font-semibold mt-2 truncate">{match.session_title}</h3>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-gray-900 text-sm font-semibold tabular-nums">{matchTime}</p>
                        <p className="text-gray-400 text-xs">{formatDate(match.session_date).replace(new Date(match.session_date + 'T00:00:00').getFullYear().toString(), '').trim()}</p>
                      </div>
                    </div>

                    <div className="grid sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-3 items-stretch">
                      <div className={`rounded-xl border p-3 min-w-0 ${match.result === 'win' ? 'bg-emerald-50 border-emerald-200' : 'bg-gray-50 border-gray-200'}`}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Your Team</p>
                        <p className="text-gray-900 text-sm font-semibold leading-snug break-words">{myTeamNames}</p>
                        <p className="text-gray-500 text-xs mt-2 flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          Partner: {teamNames?.partner || 'Partner'}
                        </p>
                      </div>
                      <div className="hidden sm:flex items-center justify-center text-gray-300 text-xs font-bold px-1">vs</div>
                      <div className={`rounded-xl border p-3 min-w-0 ${match.result === 'loss' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">Opponents</p>
                        <p className="text-gray-900 text-sm font-semibold leading-snug break-words">{opponentTeamNames}</p>
                        <p className="text-gray-500 text-xs mt-2 flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" />
                          Against: {teamNames?.opponents || opponentTeamNames}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center flex-wrap gap-3 mt-3 pt-3 border-t border-gray-100">
                      <span className="flex items-center gap-1 text-gray-500 text-xs">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatDate(match.session_date)}
                      </span>
                      <span className="flex items-center gap-1 text-gray-500 text-xs">
                        <Clock className="w-3.5 h-3.5" />
                        {matchTime}
                      </span>
                      <span className="flex items-center gap-1 text-gray-500 text-xs min-w-0">
                        <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">{match.venue}</span>
                      </span>
                      {match.organiser_name && (
                        <span className="flex items-center gap-1 text-gray-500 text-xs">
                          <User className="w-3.5 h-3.5" />
                          {match.organiser_name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && filtered.length > 0 && draws > 0 && (
        <p className="text-gray-400 text-xs text-center mt-4">{draws} draw{draws > 1 ? 's' : ''} not shown in win/loss count</p>
      )}
    </div>
  );
}


