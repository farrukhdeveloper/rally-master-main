import { useMemo, useState } from 'react';
import { Check, Copy, Trophy } from 'lucide-react';
import { SKILL_LEVELS, normalizeSkillLevel } from '../lib/skillLevels';
import { Court, Match, MatchTeamWithPlayers, Session } from '../lib/supabase';

export interface MatchWithDetails extends Match {
  court: Court;
  teams: MatchTeamWithPlayers[];
}

interface RecapPlayer {
  id: string;
  name: string;
  wins: number;
  losses: number;
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  longestStreak: number;
  partnerCount: number;
}

interface RecapMatchHighlight {
  courtName: string;
  score: string;
  margin: number;
  winnerNames: string;
  loserNames: string;
  levelGap: number;
}

interface RecapPair {
  key: string;
  names: string;
  wins: number;
  games: number;
  winRate: number;
  pointDiff: number;
}

interface SessionRecap {
  sessionTitle: string;
  sessionDate: string;
  totalMatches: number;
  totalPlayers: number;
  totalCourts: number;
  mvp: RecapPlayer | null;
  mvpMinimumGames: number;
  bestPair: RecapPair | null;
  winningStreak: RecapPlayer | null;
  closestMatch: RecapMatchHighlight | null;
  biggestUpset: RecapMatchHighlight | null;
  biggestWin: RecapMatchHighlight | null;
  mostVersatile: RecapPlayer | null;
  shareText: string;
}

interface PlayerAccumulator extends Omit<RecapPlayer, 'pointDiff' | 'longestStreak' | 'partnerCount'> {
  partners: Set<string>;
}

interface PairAccumulator extends Omit<RecapPair, 'winRate' | 'pointDiff'> {
  pointsFor: number;
  pointsAgainst: number;
}

export function SessionRecapPanel({ matches, session }: { matches: MatchWithDetails[]; session?: Session | null }) {
  const [copied, setCopied] = useState(false);
  const recap = useMemo(() => buildSessionRecap(matches, session || undefined), [matches, session]);

  async function copyRecap() {
    if (!recap) return;
    if (navigator.clipboard) await navigator.clipboard.writeText(recap.shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (!recap) {
    return (
      <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center">
        <Trophy className="w-9 h-9 text-gray-300 mx-auto mb-2" />
        <p className="text-gray-500 font-medium">No recap yet</p>
        <p className="text-gray-400 text-sm mt-1">Completed matches will create a session recap.</p>
      </div>
    );
  }

  return <SessionRecapCard recap={recap} copied={copied} onCopy={copyRecap} />;
}

function buildSessionRecap(matches: MatchWithDetails[], session?: Session): SessionRecap | null {
  if (matches.length === 0) return null;

  const players = new Map<string, PlayerAccumulator>();
  const pairs = new Map<string, PairAccumulator>();
  const currentStreaks = new Map<string, number>();
  const longestStreaks = new Map<string, number>();
  const courtIds = new Set<string>();
  const matchHighlights: RecapMatchHighlight[] = [];
  const upsetHighlights: RecapMatchHighlight[] = [];
  const orderedMatches = [...matches].sort((a, b) => matchTimestamp(a) - matchTimestamp(b));

  for (const match of orderedMatches) {
    if (match.court_id) courtIds.add(match.court_id);
    const tA = match.teams?.find((team) => team.team_label === 'A');
    const tB = match.teams?.find((team) => team.team_label === 'B');
    const hasScore = Number.isFinite(match.score_a) && Number.isFinite(match.score_b) && ((match.score_a || 0) > 0 || (match.score_b || 0) > 0);

    if (match.winner_team && tA && tB && hasScore) {
      const winnerTeam = match.winner_team === 'A' ? tA : tB;
      const loserTeam = match.winner_team === 'A' ? tB : tA;
      const winnerLevel = averageTeamLevel(winnerTeam);
      const loserLevel = averageTeamLevel(loserTeam);
      const highlight: RecapMatchHighlight = {
        courtName: match.court?.name || 'Court',
        score: `${match.score_a}-${match.score_b}`,
        margin: Math.abs((match.score_a || 0) - (match.score_b || 0)),
        winnerNames: teamShortNames(winnerTeam),
        loserNames: teamShortNames(loserTeam),
        levelGap: Math.max(0, loserLevel - winnerLevel),
      };
      matchHighlights.push(highlight);
      if (highlight.levelGap > 0) upsetHighlights.push(highlight);
    }

    for (const team of match.teams || []) {
      const didWin = match.winner_team === team.team_label;
      const teamScore = team.team_label === 'A' ? (match.score_a || 0) : (match.score_b || 0);
      const opponentScore = team.team_label === 'A' ? (match.score_b || 0) : (match.score_a || 0);
      const teamPlayers = team.players || [];

      if (teamPlayers.length >= 2) {
        const pairPlayers = teamPlayers
          .map((player) => ({ id: player.player_id, name: player.profile?.full_name || 'Unknown player' }))
          .sort((a, b) => a.id.localeCompare(b.id));
        for (let i = 0; i < pairPlayers.length; i++) {
          for (let j = i + 1; j < pairPlayers.length; j++) {
            const key = `${pairPlayers[i].id}|${pairPlayers[j].id}`;
            const names = `${firstName(pairPlayers[i].name)} & ${firstName(pairPlayers[j].name)}`;
            const current = pairs.get(key) || { key, names, wins: 0, games: 0, pointsFor: 0, pointsAgainst: 0 };
            current.games += 1;
            if (didWin) current.wins += 1;
            if (hasScore) {
              current.pointsFor += teamScore;
              current.pointsAgainst += opponentScore;
            }
            pairs.set(key, current);
          }
        }
      }

      for (const player of teamPlayers) {
        const id = player.player_id;
        const current = players.get(id) || {
          id,
          name: player.profile?.full_name || 'Unknown player',
          wins: 0,
          losses: 0,
          games: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          partners: new Set<string>(),
        };
        current.games += 1;
        for (const partner of teamPlayers) {
          if (partner.player_id !== id) current.partners.add(partner.player_id);
        }
        if (hasScore) {
          current.pointsFor += teamScore;
          current.pointsAgainst += opponentScore;
        }
        if (match.winner_team) {
          if (didWin) current.wins += 1;
          else current.losses += 1;
          const nextStreak = didWin ? (currentStreaks.get(id) || 0) + 1 : 0;
          currentStreaks.set(id, nextStreak);
          longestStreaks.set(id, Math.max(longestStreaks.get(id) || 0, nextStreak));
        }
        players.set(id, current);
      }
    }
  }

  const playerList: RecapPlayer[] = [...players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    wins: player.wins,
    losses: player.losses,
    games: player.games,
    pointsFor: player.pointsFor,
    pointsAgainst: player.pointsAgainst,
    pointDiff: player.pointsFor - player.pointsAgainst,
    longestStreak: longestStreaks.get(player.id) || 0,
    partnerCount: player.partners.size,
  }));
  const maxGames = playerList.length > 0 ? Math.max(...playerList.map((player) => player.games)) : 0;
  const mvpMinimumGames = Math.max(3, Math.ceil(maxGames / 2));
  const mvp = [...playerList]
    .filter((player) => player.games >= mvpMinimumGames)
    .sort(comparePlayerPerformance)[0] || null;
  const bestPair = [...pairs.values()]
    .filter((pair) => pair.games >= 3)
    .map((pair): RecapPair => ({
      key: pair.key,
      names: pair.names,
      wins: pair.wins,
      games: pair.games,
      winRate: Math.round((pair.wins / pair.games) * 100),
      pointDiff: pair.pointsFor - pair.pointsAgainst,
    }))
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || b.pointDiff - a.pointDiff || b.games - a.games || a.names.localeCompare(b.names))[0] || null;
  const winningStreak = [...playerList]
    .filter((player) => player.longestStreak > 0)
    .sort((a, b) => b.longestStreak - a.longestStreak || b.wins - a.wins || b.games - a.games || a.name.localeCompare(b.name))[0] || null;
  const mostVersatile = [...playerList]
    .sort((a, b) => b.partnerCount - a.partnerCount || b.games - a.games || b.wins - a.wins || a.name.localeCompare(b.name))[0] || null;
  const closestMatch = [...matchHighlights].sort((a, b) => a.margin - b.margin || a.courtName.localeCompare(b.courtName))[0] || null;
  const biggestWin = [...matchHighlights].sort((a, b) => b.margin - a.margin || a.courtName.localeCompare(b.courtName))[0] || null;
  const biggestUpset = [...upsetHighlights].sort((a, b) => b.levelGap - a.levelGap || b.margin - a.margin || a.courtName.localeCompare(b.courtName))[0] || null;
  const sessionDate = session?.session_date ? formatDate(session.session_date) : '';
  const upsetOrWin = biggestUpset || biggestWin;
  const upsetLabel = biggestUpset ? 'Biggest upset' : 'Biggest win';
  const shareText = [
    `Rally Master Recap - ${session?.title || 'Session'}${sessionDate ? ` (${sessionDate})` : ''}`,
    `Matches: ${matches.length} | Players: ${playerList.length} | Courts: ${courtIds.size}`,
    '',
    mvp ? `Session MVP: ${firstName(mvp.name)} - ${winRate(mvp)}% (${mvp.wins}W-${mvp.losses}L), diff ${signedNumber(mvp.pointDiff)}` : `Session MVP: Need ${mvpMinimumGames}+ games`,
    bestPair ? `Best pair: ${bestPair.names} - ${bestPair.winRate}% (${bestPair.wins}/${bestPair.games}), diff ${signedNumber(bestPair.pointDiff)}` : 'Best pair: Need 3+ games together',
    winningStreak ? `Winning streak: ${firstName(winningStreak.name)} - ${winningStreak.longestStreak} wins` : 'Winning streak: No streak yet',
    closestMatch ? `Closest match: ${closestMatch.score} - ${closestMatch.winnerNames} beat ${closestMatch.loserNames}` : 'Closest match: No scores recorded',
    upsetOrWin ? `${upsetLabel}: ${upsetOrWin.winnerNames} beat ${upsetOrWin.loserNames} ${upsetOrWin.score}` : `${upsetLabel}: No scores recorded`,
    mostVersatile ? `Most versatile: ${firstName(mostVersatile.name)} - ${mostVersatile.partnerCount} partners` : 'Most versatile: No partner data',
  ].join('\n');

  return {
    sessionTitle: session?.title || 'Session',
    sessionDate,
    totalMatches: matches.length,
    totalPlayers: playerList.length,
    totalCourts: courtIds.size,
    mvp,
    mvpMinimumGames,
    bestPair,
    winningStreak,
    closestMatch,
    biggestUpset,
    biggestWin,
    mostVersatile,
    shareText,
  };
}

function SessionRecapCard({ recap, copied, onCopy }: { recap: SessionRecap; copied: boolean; onCopy: () => void }) {
  const upsetOrWin = recap.biggestUpset || recap.biggestWin;
  const upsetLabel = recap.biggestUpset ? 'Biggest upset' : 'Biggest win';

  return (
    <div className="bg-white border border-emerald-100 rounded-2xl p-3 sm:p-4 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="min-w-0">
          <h3 className="text-gray-900 font-semibold flex items-center gap-2 text-sm">
            <Trophy className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            Session Recap
          </h3>
          <p className="text-gray-500 text-xs mt-0.5 break-words">
            {recap.sessionTitle}{recap.sessionDate ? ` · ${recap.sessionDate}` : ''}
          </p>
        </div>
        <button onClick={onCopy} className="w-9 h-9 flex items-center justify-center bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg transition-all flex-shrink-0" title={copied ? 'Copied' : 'Copy recap'} aria-label={copied ? 'Recap copied' : 'Copy recap'}>
          {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-1.5 mb-2.5">
        <RecapStat label="Matches" value={recap.totalMatches} />
        <RecapStat label="Players" value={recap.totalPlayers} />
        <RecapStat label="Courts" value={recap.totalCourts} />
      </div>

      <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2.5 mb-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase font-semibold text-emerald-700">Session MVP</p>
            <p className="text-base font-bold text-gray-900 break-words leading-tight mt-0.5">{recap.mvp ? recap.mvp.name : 'Not awarded yet'}</p>
          </div>
          {recap.mvp && <span className="text-lg font-bold text-emerald-700 tabular-nums flex-shrink-0">{winRate(recap.mvp)}%</span>}
        </div>
        <p className="text-xs text-gray-600 mt-1 break-words">
          {recap.mvp
            ? `${recap.mvp.wins}W · ${recap.mvp.losses}L · ${signedNumber(recap.mvp.pointDiff)} points`
            : `Minimum ${recap.mvpMinimumGames} games required`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <HighlightItem label="Best pair" value={recap.bestPair?.names || 'Not awarded'} detail={recap.bestPair ? `${recap.bestPair.winRate}% · ${recap.bestPair.wins}/${recap.bestPair.games} wins · ${signedNumber(recap.bestPair.pointDiff)} diff` : 'Minimum 3 games together'} />
        <HighlightItem label="Winning streak" value={recap.winningStreak?.name || 'No streak yet'} detail={recap.winningStreak ? `${recap.winningStreak.longestStreak} consecutive wins` : 'Completed results required'} />
        <HighlightItem label="Closest match" value={recap.closestMatch?.score || 'No scores yet'} detail={recap.closestMatch ? `${recap.closestMatch.winnerNames} beat ${recap.closestMatch.loserNames}` : 'Record scores to unlock'} />
        <HighlightItem label={upsetLabel} value={upsetOrWin?.score || 'No scores yet'} detail={upsetOrWin ? `${upsetOrWin.winnerNames} beat ${upsetOrWin.loserNames}` : 'Record scores to unlock'} />
        <div className="col-span-2">
          <HighlightItem label="Most versatile partner" value={recap.mostVersatile?.name || 'No partner data'} detail={recap.mostVersatile ? `${recap.mostVersatile.partnerCount} different partners` : 'Completed doubles matches required'} />
        </div>
      </div>
    </div>
  );
}

function RecapStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-emerald-50 border border-emerald-100 rounded-lg px-1.5 py-2 text-center min-w-0">
      <p className="text-lg font-bold text-emerald-700 tabular-nums leading-none">{value}</p>
      <p className="text-emerald-700/70 text-[10px] font-medium mt-1">{label}</p>
    </div>
  );
}

function HighlightItem({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="h-full bg-sky-50 border border-sky-100 rounded-lg px-2.5 py-2 min-w-0">
      <p className="text-[10px] font-semibold uppercase text-sky-700 mb-0.5">{label}</p>
      <p className="text-sm font-bold text-gray-900 break-words leading-tight">{value}</p>
      <p className="text-[11px] text-gray-500 mt-1 break-words leading-tight">{detail}</p>
    </div>
  );
}

function comparePlayerPerformance(a: RecapPlayer, b: RecapPlayer) {
  return winRate(b) - winRate(a) || b.wins - a.wins || b.pointDiff - a.pointDiff || a.name.localeCompare(b.name);
}

function winRate(player: RecapPlayer) {
  return player.games > 0 ? Math.round((player.wins / player.games) * 100) : 0;
}

function signedNumber(value: number) {
  return value > 0 ? `+${value}` : `${value}`;
}

function matchTimestamp(match: Match) {
  return new Date(match.ended_at || match.started_at || 0).getTime();
}

function averageTeamLevel(team?: MatchTeamWithPlayers) {
  const levels = (team?.players || []).map((player) => SKILL_LEVELS.indexOf(normalizeSkillLevel(player.profile?.skill_level)) + 1);
  return levels.length > 0 ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 0;
}

function firstName(name: string) {
  return name.split(' ')[0] || name;
}

function teamShortNames(team?: MatchTeamWithPlayers) {
  return team?.players
    ?.map((player) => player.profile?.full_name ? firstName(player.profile.full_name) : '')
    .filter(Boolean)
    .join(' & ') || `Team ${team?.team_label || ''}`.trim();
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}
