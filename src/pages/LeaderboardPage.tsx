import { useEffect, useState } from 'react';
import { supabase, Profile, Environment, SkillLevel, Group } from '../lib/supabase';
import { SKILL_LEVELS, normalizeSkillLevel, skillLevelColor, skillLevelLabel } from '../lib/skillLevels';
import { calculatePlayerRatingsFromMatches } from '../lib/rating';
import RatingProgress from '../components/RatingProgress';
import { BarChart2, Trophy, Medal } from 'lucide-react';

interface LeaderboardEntry {
  id: string;
  player_id: string;
  wins: number;
  losses: number;
  total_matches: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  rating?: number;
  profile: Profile;
}

interface PairLeaderboardEntry {
  key: string;
  names: string;
  wins: number;
  losses: number;
  games: number;
  winRate: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
}

export default function LeaderboardPage({ envFilter = 'prod' }: { envFilter?: Environment }) {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [pairs, setPairs] = useState<PairLeaderboardEntry[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [view, setView] = useState<'players' | 'pairs'>('players');
  const [filter, setFilter] = useState<'all' | SkillLevel>('all');
  const [groupFilter, setGroupFilter] = useState<'all' | string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadLeaderboard() {
      setLoading(true);
      const { data: groupRows } = await supabase
        .from('groups')
        .select('*')
        .eq('environment', envFilter)
        .order('name', { ascending: true });

      setGroups((groupRows as Group[]) || []);
      setGroupFilter((current) => current === 'all' || ((groupRows as Group[]) || []).some((group) => group.id === current) ? current : 'all');

      const challengeSessionIds = new Set<string>();
      if (groupFilter !== 'all') {
        const { data: groupCompetitions } = await supabase
          .from('competitions')
          .select('session_id, competition_groups!inner(group_id)')
          .eq('environment', envFilter)
          .eq('counts_for_rankings', true)
          .eq('competition_groups.group_id', groupFilter);

        for (const competition of (groupCompetitions as any[]) || []) {
          if (competition.session_id) challengeSessionIds.add(competition.session_id);
        }
      }

      const query = supabase
        .from('matches')
        .select(`winner_team, score_a, score_b, started_at, ended_at, session:sessions!inner(id, environment, group_id, counts_for_rankings), teams:match_teams(team_label, players:match_team_players(player_id, profile:profiles(*)))`)
        .eq('status', 'completed')
        .eq('session.environment', envFilter)
        .eq('session.counts_for_rankings', true);

      const { data: matches } = await query;
      const scopedMatches = ((matches as any[]) || []).filter((match) => {
        if (groupFilter === 'all') return true;
        const session = Array.isArray(match.session) ? match.session[0] : match.session;
        return session?.group_id === groupFilter || challengeSessionIds.has(session?.id);
      });

      setEntries(buildPlayerLeaderboard(scopedMatches));
      setPairs(buildPairLeaderboard(scopedMatches));
      setLoading(false);
    }

    loadLeaderboard();
  }, [envFilter, groupFilter]);

  const filtered = entries
    .filter((e) => filter === 'all' || normalizeSkillLevel(e.profile?.skill_level) === filter)
    .sort((a, b) => {
      const aWinRate = a.total_matches > 0 ? a.wins / a.total_matches : 0;
      const bWinRate = b.total_matches > 0 ? b.wins / b.total_matches : 0;

      if (b.wins !== a.wins) return b.wins - a.wins;
      if (bWinRate !== aWinRate) return bWinRate - aWinRate;
      if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
      if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
      if (b.total_matches !== a.total_matches) return b.total_matches - a.total_matches;

      return (a.profile?.full_name || '').localeCompare(b.profile?.full_name || '');
    });

  const rankedPairs = [...pairs].sort((a, b) => {
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    if (b.games !== a.games) return b.games - a.games;
    return a.names.localeCompare(b.names);
  }).slice(0, 50);
  const envLabel = envFilter === 'prod' ? 'production' : 'dev/testing';

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-3">
          {[...Array(6)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <BarChart2 className="w-6 h-6 text-emerald-600" />
        Leaderboard
      </h1>
      <p className="text-gray-500 text-sm mb-6">Player rankings and top 50 partnerships across {envLabel} sessions.</p>

      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">
        <label className="bg-white border border-gray-200 rounded-xl px-3 py-2 flex items-center gap-2 w-full sm:w-auto">
          <span className="text-xs font-semibold text-gray-400">Group</span>
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="bg-transparent text-gray-900 text-sm font-medium focus:outline-none flex-1"
          >
            <option value="all">All groups</option>
            {groups.map((group) => (
              <option key={group.id} value={group.id}>{group.name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-2 mb-4">
        {(['players', 'pairs'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all capitalize ${
              view === v ? 'bg-emerald-500 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:text-gray-900'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {view === 'players' && (
        <div className="flex gap-2 mb-6 flex-wrap">
          {(['all', ...SKILL_LEVELS] as Array<'all' | SkillLevel>).map((level) => {
            const isActive = filter === level;
            const inactiveClass = level === 'all'
              ? 'bg-gray-100 text-gray-500 hover:text-gray-800 border-gray-200'
              : `${skillLevelColor(level)} hover:brightness-95`;
            return (
              <button
                key={level}
                onClick={() => setFilter(level)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  isActive ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : inactiveClass
                }`}
              >
                {level === 'all' ? 'All Levels' : skillLevelLabel(level)}
              </button>
            );
          })}
        </div>
      )}

      {view === 'players' && filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-12 text-center">
          <Trophy className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No stats recorded yet. Play some matches!</p>
        </div>
      ) : view === 'players' ? (
        <div className="space-y-2">
          {filtered.map((entry, index) => {
            const winRate = entry.total_matches > 0
              ? Math.round((entry.wins / entry.total_matches) * 100)
              : 0;
            const rank = index + 1;

            return (
              <div
                key={entry.player_id}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                  rank === 1
                    ? 'bg-amber-50 border-amber-200'
                    : rank === 2
                    ? 'bg-gray-100 border-gray-200'
                    : rank === 3
                    ? 'bg-orange-50 border-orange-200'
                    : 'bg-white border-gray-200'
                }`}
              >
                {/* Rank */}
                <div className="w-8 text-center flex-shrink-0">
                  {rank <= 3 ? (
                    <Medal className={`w-5 h-5 mx-auto ${rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-gray-400' : 'text-orange-600'}`} />
                  ) : (
                    <span className="text-gray-400 text-sm font-mono">#{rank}</span>
                  )}
                </div>

                {/* Avatar */}
                <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-semibold flex-shrink-0">
                  {entry.profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
                </div>

                {/* Name & skill */}
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 font-medium truncate">{entry.profile?.full_name}</p>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${skillLevelColor(entry.profile?.skill_level)}`}>
                    {skillLevelLabel(entry.profile?.skill_level)}
                  </span>
                  <RatingProgress profile={entry.profile} totalMatches={entry.total_matches} rating={entry.rating} />
                </div>

                {/* Stats */}
                <div className="flex items-center gap-4 text-sm flex-shrink-0">
                  <div className="text-center hidden sm:block">
                    <p className="text-emerald-600 font-bold">{entry.wins}</p>
                    <p className="text-gray-400 text-xs">W</p>
                  </div>
                  <div className="text-center hidden sm:block">
                    <p className="text-red-500 font-bold">{entry.losses}</p>
                    <p className="text-gray-400 text-xs">L</p>
                  </div>
                  <div className="text-center">
                    <p className={`font-bold ${winRate >= 60 ? 'text-emerald-600' : winRate >= 40 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {winRate}%
                    </p>
                    <p className="text-gray-400 text-xs">Win%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-gray-700 font-semibold">{entry.total_matches}</p>
                    <p className="text-gray-400 text-xs">Played</p>
                  </div>
                  <div className="text-center hidden md:block">
                    <p className={`font-bold ${entry.pointDiff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {entry.pointDiff > 0 ? '+' : ''}{entry.pointDiff}
                    </p>
                    <p className="text-gray-400 text-xs">Diff</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : rankedPairs.length === 0 ? (
        <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-12 text-center">
          <Trophy className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No pair rankings yet. Pairs need at least 5 games together.</p>
        </div>
      ) : (
        <div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl px-4 py-3 mb-3">
            <h2 className="text-gray-900 font-semibold">Top 50 Best Pairs</h2>
            <p className="text-gray-500 text-xs mt-0.5">Ranked by win rate across {envLabel} sessions, minimum 5 games together.</p>
          </div>
          <div className="space-y-2">
            {rankedPairs.map((pair, index) => {
            const rank = index + 1;
            return (
              <div
                key={pair.key}
                className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                  rank === 1
                    ? 'bg-amber-50 border-amber-200'
                    : rank === 2
                    ? 'bg-gray-100 border-gray-200'
                    : rank === 3
                    ? 'bg-orange-50 border-orange-200'
                    : 'bg-white border-gray-200'
                }`}
              >
                <div className="w-8 text-center flex-shrink-0">
                  {rank <= 3 ? (
                    <Medal className={`w-5 h-5 mx-auto ${rank === 1 ? 'text-amber-500' : rank === 2 ? 'text-gray-400' : 'text-orange-600'}`} />
                  ) : (
                    <span className="text-gray-400 text-sm font-mono">#{rank}</span>
                  )}
                </div>
                <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-semibold flex-shrink-0">
                  {pair.names.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 font-medium truncate">{pair.names}</p>
                  <p className="text-gray-400 text-xs">Minimum 5 games together</p>
                </div>
                <div className="flex items-center gap-4 text-sm flex-shrink-0">
                  <div className="text-center hidden sm:block">
                    <p className="text-emerald-600 font-bold">{pair.wins}</p>
                    <p className="text-gray-400 text-xs">W</p>
                  </div>
                  <div className="text-center hidden sm:block">
                    <p className="text-red-500 font-bold">{pair.losses}</p>
                    <p className="text-gray-400 text-xs">L</p>
                  </div>
                  <div className="text-center">
                    <p className={`font-bold ${pair.winRate >= 60 ? 'text-emerald-600' : pair.winRate >= 40 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {pair.winRate}%
                    </p>
                    <p className="text-gray-400 text-xs">Win%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-gray-700 font-semibold">{pair.games}</p>
                    <p className="text-gray-400 text-xs">Together</p>
                  </div>
                  <div className="text-center hidden md:block">
                    <p className={`font-bold ${pair.pointDiff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {pair.pointDiff > 0 ? '+' : ''}{pair.pointDiff}
                    </p>
                    <p className="text-gray-400 text-xs">Diff</p>
                  </div>
                </div>
              </div>
            );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function buildPlayerLeaderboard(matches: any[]): LeaderboardEntry[] {
  const players = new Map<string, LeaderboardEntry>();
  const ratings = calculatePlayerRatingsFromMatches(matches);

  for (const match of matches) {
    for (const team of match.teams || []) {
      const didWin = match.winner_team === team.team_label;
      for (const teamPlayer of team.players || []) {
        const profile = teamPlayer.profile;
        if (!teamPlayer.player_id || !profile) continue;

        const current = players.get(teamPlayer.player_id) || {
          id: teamPlayer.player_id,
          player_id: teamPlayer.player_id,
          wins: 0,
          losses: 0,
          total_matches: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDiff: 0,
          rating: ratings.get(teamPlayer.player_id),
          profile,
        };

        const teamScore = team.team_label === 'A' ? match.score_a || 0 : match.score_b || 0;
        const opponentScore = team.team_label === 'A' ? match.score_b || 0 : match.score_a || 0;
        current.wins += didWin ? 1 : 0;
        current.losses += didWin ? 0 : 1;
        current.total_matches += 1;
        current.pointsFor += teamScore;
        current.pointsAgainst += opponentScore;
        current.pointDiff = current.pointsFor - current.pointsAgainst;
        current.rating = ratings.get(teamPlayer.player_id) ?? current.rating;
        current.profile = profile;
        players.set(teamPlayer.player_id, current);
      }
    }
  }

  return [...players.values()];
}

function buildPairLeaderboard(matches: any[]): PairLeaderboardEntry[] {
  const pairs = new Map<string, PairLeaderboardEntry>();

  for (const match of matches) {
    for (const team of match.teams || []) {
      const players = (team.players || [])
        .map((p: any) => ({ id: p.player_id, name: p.profile?.full_name || 'Unknown player' }))
        .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
      const didWin = match.winner_team === team.team_label;

      for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
          const key = `${players[i].id}|${players[j].id}`;
          const names = `${firstName(players[i].name)} & ${firstName(players[j].name)}`;
          const teamScore = team.team_label === 'A' ? match.score_a || 0 : match.score_b || 0;
          const opponentScore = team.team_label === 'A' ? match.score_b || 0 : match.score_a || 0;
          const current = pairs.get(key) || {
            key,
            names,
            wins: 0,
            losses: 0,
            games: 0,
            winRate: 0,
            pointsFor: 0,
            pointsAgainst: 0,
            pointDiff: 0,
          };
          current.games += 1;
          if (didWin) current.wins += 1;
          else current.losses += 1;
          current.pointsFor += teamScore;
          current.pointsAgainst += opponentScore;
          current.pointDiff = current.pointsFor - current.pointsAgainst;
          current.winRate = Math.round((current.wins / current.games) * 100);
          pairs.set(key, current);
        }
      }
    }
  }

  return [...pairs.values()].filter((pair) => pair.games >= 5);
}

function firstName(name: string) {
  return name.split(' ')[0] || name;
}


