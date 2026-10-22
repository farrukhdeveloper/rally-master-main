import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Check, Copy, RefreshCw, Search, Shuffle, Users, X } from 'lucide-react';
import { supabase, Environment, Profile, Session, SkillLevel } from '../lib/supabase';
import { SKILL_LEVELS, compareSkillLevels, skillLevelColor, skillLevelLabel, skillLevelShortLabel } from '../lib/skillLevels';

type PlannedGame = {
  id: string;
  slot: number;
  court: number;
  startLabel: string;
  endLabel: string;
  teamA: [Profile, Profile];
  teamB: [Profile, Profile];
};

type DurationMinutes = 120 | 180;

function pairKey(a: string, b: string) {
  return [a, b].sort().join('|');
}

function combinations<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, combo: T[]) => {
    if (combo.length === size) {
      result.push(combo);
      return;
    }
    for (let i = start; i <= items.length - (size - combo.length); i += 1) {
      walk(i + 1, [...combo, items[i]]);
    }
  };
  walk(0, []);
  return result;
}

function addMinutesToTime(time: string, minutes: number) {
  const [hour, minute] = time.split(':').map(Number);
  const date = new Date();
  date.setHours(hour || 0, minute || 0, 0, 0);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function splitOptions(players: Profile[]) {
  const [p0, p1, p2, p3] = players;
  return [
    { teamA: [p0, p1] as [Profile, Profile], teamB: [p2, p3] as [Profile, Profile] },
    { teamA: [p0, p2] as [Profile, Profile], teamB: [p1, p3] as [Profile, Profile] },
    { teamA: [p0, p3] as [Profile, Profile], teamB: [p1, p2] as [Profile, Profile] },
  ];
}

function generateSchedule(players: Profile[], duration: DurationMinutes, gameMinutes: number, courts: number, startTime: string) {
  if (players.length < 4) return [];

  const slots = Math.floor(duration / gameMinutes);
  const partnerCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();
  const playCounts = new Map(players.map((player) => [player.id, 0]));
  const games: PlannedGame[] = [];

  for (let slot = 0; slot < slots; slot += 1) {
    const usedThisSlot = new Set<string>();

    for (let court = 1; court <= courts; court += 1) {
      const available = players.filter((player) => !usedThisSlot.has(player.id));
      if (available.length < 4) break;

      const lowestFirst = [...available]
        .sort((a, b) => {
          const countDiff = (playCounts.get(a.id) || 0) - (playCounts.get(b.id) || 0);
          if (countDiff !== 0) return countDiff;
          return compareSkillLevels(a.skill_level, b.skill_level);
        })
        .slice(0, Math.min(available.length, 12));

      let best:
        | { teamA: [Profile, Profile]; teamB: [Profile, Profile]; score: number }
        | null = null;

      for (const group of combinations(lowestFirst, 4)) {
        for (const option of splitOptions(group)) {
          const partnerPenalty =
            (partnerCounts.get(pairKey(option.teamA[0].id, option.teamA[1].id)) || 0) * 80 +
            (partnerCounts.get(pairKey(option.teamB[0].id, option.teamB[1].id)) || 0) * 80;

          const opponentPairs = [
            [option.teamA[0], option.teamB[0]],
            [option.teamA[0], option.teamB[1]],
            [option.teamA[1], option.teamB[0]],
            [option.teamA[1], option.teamB[1]],
          ];
          const opponentPenalty = opponentPairs.reduce(
            (total, [a, b]) => total + (opponentCounts.get(pairKey(a.id, b.id)) || 0) * 8,
            0
          );

          const fairnessPenalty = [...option.teamA, ...option.teamB].reduce(
            (total, player) => total + (playCounts.get(player.id) || 0) * 14,
            0
          );
          const skillSpread = Math.abs(
            SKILL_LEVELS.indexOf(option.teamA[0].skill_level) +
              SKILL_LEVELS.indexOf(option.teamA[1].skill_level) -
              SKILL_LEVELS.indexOf(option.teamB[0].skill_level) -
              SKILL_LEVELS.indexOf(option.teamB[1].skill_level)
          );

          const score = partnerPenalty + opponentPenalty + fairnessPenalty + skillSpread;
          if (!best || score < best.score) best = { ...option, score };
        }
      }

      if (!best) break;

      const allPlayers = [...best.teamA, ...best.teamB];
      allPlayers.forEach((player) => {
        usedThisSlot.add(player.id);
        playCounts.set(player.id, (playCounts.get(player.id) || 0) + 1);
      });

      partnerCounts.set(pairKey(best.teamA[0].id, best.teamA[1].id), (partnerCounts.get(pairKey(best.teamA[0].id, best.teamA[1].id)) || 0) + 1);
      partnerCounts.set(pairKey(best.teamB[0].id, best.teamB[1].id), (partnerCounts.get(pairKey(best.teamB[0].id, best.teamB[1].id)) || 0) + 1);
      for (const playerA of best.teamA) {
        for (const playerB of best.teamB) {
          opponentCounts.set(pairKey(playerA.id, playerB.id), (opponentCounts.get(pairKey(playerA.id, playerB.id)) || 0) + 1);
        }
      }

      games.push({
        id: `${slot + 1}-${court}`,
        slot: slot + 1,
        court,
        startLabel: addMinutesToTime(startTime, slot * gameMinutes),
        endLabel: addMinutesToTime(startTime, (slot + 1) * gameMinutes),
        teamA: best.teamA,
        teamB: best.teamB,
      });
    }
  }

  return games;
}

export default function RotationPlannerPage({ envFilter = 'prod' }: { envFilter?: Environment }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [players, setPlayers] = useState<Profile[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState<'all' | SkillLevel>('all');
  const [duration, setDuration] = useState<DurationMinutes>(120);
  const [gameMinutes, setGameMinutes] = useState(10);
  const [courts, setCourts] = useState(1);
  const [startTime, setStartTime] = useState('19:00');
  const [schedule, setSchedule] = useState<PlannedGame[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingSessions, setLoadingSessions] = useState(true);

  useEffect(() => {
    loadSessions();
  }, [envFilter]);

  useEffect(() => {
    if (selectedSession) loadSessionPlayers(selectedSession);
    else {
      setPlayers([]);
      setSelectedIds(new Set());
      setSchedule([]);
    }
  }, [selectedSession]);

  async function loadSessions() {
    setLoadingSessions(true);
    let query = supabase
      .from('sessions')
      .select('*')
      .eq('environment', envFilter)
      .in('status', ['open', 'in_progress'])
      .order('session_date', { ascending: false });

    const { data } = await query;
    const list = (data as Session[]) || [];
    setSessions(list);
    setSelectedSession((current) => {
      if (current && list.some((session) => session.id === current)) return current;
      return list[0]?.id || '';
    });
    setLoadingSessions(false);
  }

  async function loadSessionPlayers(sessionId = selectedSession) {
    if (!sessionId) return;
    setLoading(true);
    const [availabilityRes, courtsRes] = await Promise.all([
      supabase
        .from('session_availability')
        .select('*, profile:profiles(*)')
        .eq('session_id', sessionId)
        .eq('available', true),
      supabase
        .from('courts')
        .select('id')
        .eq('session_id', sessionId),
    ]);

    const sessionPlayers = ((availabilityRes.data as any[]) || [])
      .map((row) => row.profile as Profile | null)
      .filter((profile): profile is Profile => Boolean(profile))
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    setPlayers(sessionPlayers);
    setSelectedIds(new Set(sessionPlayers.map((player) => player.id)));
    if ((courtsRes.data || []).length > 0) {
      setCourts(Math.min(4, Math.max(1, courtsRes.data!.length)));
    }
    setSchedule([]);
    setLoading(false);
  }

  const filteredPlayers = players.filter((player) => {
    const term = search.trim().toLowerCase();
    const matchesSearch =
      !term ||
      player.full_name.toLowerCase().includes(term) ||
      (player.phone || '').includes(term) ||
      skillLevelLabel(player.skill_level).toLowerCase().includes(term);
    const matchesLevel = skillFilter === 'all' || player.skill_level === skillFilter;
    return matchesSearch && matchesLevel;
  });

  const selectedPlayers = useMemo(
    () => players.filter((player) => selectedIds.has(player.id)),
    [players, selectedIds]
  );

  const selectedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    schedule.forEach((game) => {
      [...game.teamA, ...game.teamB].forEach((player) => {
        counts.set(player.id, (counts.get(player.id) || 0) + 1);
      });
    });
    return counts;
  }, [schedule]);

  function togglePlayer(playerId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }

  function toggleVisiblePlayers() {
    const visibleIds = filteredPlayers.map((player) => player.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      visibleIds.forEach((id) => {
        if (allVisibleSelected) next.delete(id);
        else next.add(id);
      });
      return next;
    });
  }

  function buildSchedule() {
    const shuffled = [...selectedPlayers].sort(() => Math.random() - 0.5);
    setSchedule(generateSchedule(shuffled, duration, gameMinutes, courts, startTime));
    setCopied(false);
  }

  function copySchedule() {
    const text = schedule.map((game) =>
      `${game.startLabel}-${game.endLabel} | Court ${game.court}: ${game.teamA[0].full_name} & ${game.teamA[1].full_name} vs ${game.teamB[0].full_name} & ${game.teamB[1].full_name}`
    ).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const visibleSelectedCount = filteredPlayers.filter((player) => selectedIds.has(player.id)).length;
  const maxGames = Math.floor(duration / gameMinutes) * courts;
  const activeSession = sessions.find((session) => session.id === selectedSession);

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <Shuffle className="w-7 h-7 text-emerald-600" />
            Rotation Planner
          </h1>
          <p className="text-gray-500 mt-2">
            Pick players from a session list and create a 10-minute doubles rotation with fewer repeat partners.
          </p>
        </div>
        <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl px-4 py-3 text-sm font-semibold">
          <CalendarClock className="w-4 h-4" />
          {duration / 60} hr plan, up to {maxGames} games
        </div>
      </div>

      <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5">
        <div className="grid lg:grid-cols-[1fr_auto] gap-4 items-end">
          <label className="space-y-1.5">
            <span className="text-xs font-semibold text-gray-500">Session players source</span>
            <select
              value={selectedSession}
              onChange={(e) => setSelectedSession(e.target.value)}
              disabled={loadingSessions || sessions.length === 0}
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title} - {formatDate(session.session_date)} - {session.start_time.slice(0, 5)}
                </option>
              ))}
            </select>
          </label>
          <button
            onClick={() => loadSessionPlayers()}
            disabled={!selectedSession}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200 disabled:opacity-40"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh players
          </button>
        </div>
        {sessions.length === 0 ? (
          <p className="mt-3 text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm">
            No open or live sessions found for this environment.
          </p>
        ) : activeSession ? (
          <p className="mt-3 text-gray-400 text-sm">
            Using selected players from {activeSession.title}. Add/remove players from Admin Panel &gt; Sessions &amp; Courts.
          </p>
        ) : null}
      </section>

      <div className="grid xl:grid-cols-[420px_1fr] gap-5">
        <section className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-gray-900 font-semibold flex items-center gap-2">
                <Users className="w-5 h-5 text-emerald-600" />
                Session Players
              </h2>
              <p className="text-gray-400 text-sm mt-1">{selectedPlayers.length} selected</p>
            </div>
            <button
              onClick={() => loadSessionPlayers()}
              disabled={!selectedSession}
              className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-xl disabled:opacity-40"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players, phone, or level..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setSkillFilter('all')}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap ${skillFilter === 'all' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-gray-500 border-gray-200'}`}
            >
              All levels
            </button>
            {SKILL_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => setSkillFilter(level)}
                className={`px-3 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap ${skillFilter === level ? skillLevelColor(level) : 'bg-white text-gray-500 border-gray-200'}`}
              >
                {skillLevelLabel(level)}
              </button>
            ))}
          </div>

          <button
            onClick={toggleVisiblePlayers}
            disabled={filteredPlayers.length === 0}
            className="w-full flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-semibold text-gray-700 disabled:opacity-50"
          >
            <span>{visibleSelectedCount === filteredPlayers.length && filteredPlayers.length > 0 ? 'Clear visible' : 'Select visible'}</span>
            <span className="text-xs text-gray-400">{visibleSelectedCount} of {filteredPlayers.length} visible</span>
          </button>

          <div className="space-y-2 max-h-[520px] overflow-y-auto pr-1">
            {loading ? (
              <p className="text-gray-400 text-sm text-center py-8">Loading players...</p>
            ) : filteredPlayers.length === 0 ? (
              <p className="text-gray-400 text-sm text-center py-8">
                {players.length === 0 ? 'No selected players found for this session.' : 'No players match your filters.'}
              </p>
            ) : (
              filteredPlayers.map((player) => {
                const selected = selectedIds.has(player.id);
                return (
                  <button
                    key={player.id}
                    onClick={() => togglePlayer(player.id)}
                    className={`w-full flex items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all ${
                      selected
                        ? 'bg-emerald-50 border-emerald-300'
                        : 'bg-gray-50 border-transparent hover:border-gray-200'
                    }`}
                  >
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${selected ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-gray-500'}`}>
                      {selected ? <Check className="w-4 h-4" /> : player.full_name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-gray-900 font-semibold truncate">{player.full_name}</span>
                      <span className={`inline-flex mt-1 text-xs px-2 py-0.5 rounded-lg border font-semibold ${skillLevelColor(player.skill_level)}`}>
                        {skillLevelLabel(player.skill_level)}
                      </span>
                    </span>
                    {schedule.length > 0 && (
                      <span className="text-lg font-bold text-emerald-600 tabular-nums">
                        {selectedCounts.get(player.id) || 0}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="space-y-5">
          <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5">
            <h2 className="text-gray-900 font-semibold mb-4">Plan Settings</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500">Duration</span>
                <select value={duration} onChange={(e) => setDuration(Number(e.target.value) as DurationMinutes)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500">Game length</span>
                <select value={gameMinutes} onChange={(e) => setGameMinutes(Number(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
                  <option value={10}>10 min</option>
                  <option value={12}>12 min</option>
                  <option value={15}>15 min</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500">Courts</span>
                <select value={courts} onChange={(e) => setCourts(Number(e.target.value))} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500">
                  <option value={1}>1 court</option>
                  <option value={2}>2 courts</option>
                  <option value={3}>3 courts</option>
                  <option value={4}>4 courts</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-semibold text-gray-500">Start time</span>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500" />
              </label>
              <button
                onClick={buildSchedule}
                disabled={selectedPlayers.length < 4}
                className="self-end flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-4 py-2.5 text-sm font-semibold"
              >
                <Shuffle className="w-4 h-4" />
                Generate
              </button>
            </div>
            {selectedPlayers.length < 4 && (
              <p className="text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-sm mt-4">
                Select at least 4 players to generate a rotation.
              </p>
            )}
          </div>

          <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
              <div>
                <h2 className="text-gray-900 font-semibold">Rotation List</h2>
                <p className="text-gray-400 text-sm mt-1">{schedule.length} games generated</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSchedule([])}
                  disabled={schedule.length === 0}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-semibold disabled:opacity-40"
                >
                  <X className="w-4 h-4" />
                  Clear
                </button>
                <button
                  onClick={copySchedule}
                  disabled={schedule.length === 0}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold disabled:opacity-40"
                >
                  <Copy className="w-4 h-4" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {schedule.length === 0 ? (
              <div className="border border-dashed border-gray-200 rounded-2xl p-10 text-center">
                <Shuffle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-500 font-semibold">No schedule yet</p>
                <p className="text-gray-400 text-sm mt-1">Select players and generate a 2-hour or 3-hour list.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {schedule.map((game) => (
                  <div key={game.id} className="border border-gray-200 rounded-2xl p-3 sm:p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                      <div>
                        <p className="text-gray-900 font-bold">Game {game.slot} - Court {game.court}</p>
                        <p className="text-gray-400 text-xs font-semibold">{game.startLabel} - {game.endLabel}</p>
                      </div>
                    </div>
                    <div className="grid md:grid-cols-2 gap-3">
                      <TeamCard label="Team A" players={game.teamA} tone="sky" />
                      <TeamCard label="Team B" players={game.teamB} tone="rose" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function TeamCard({ label, players, tone }: { label: string; players: [Profile, Profile]; tone: 'sky' | 'rose' }) {
  const classes = tone === 'sky'
    ? 'bg-sky-50 border-sky-200 text-sky-700'
    : 'bg-rose-50 border-rose-200 text-rose-700';
  return (
    <div className={`rounded-2xl border p-3 ${classes}`}>
      <p className="text-xs font-bold uppercase tracking-wide mb-2">{label}</p>
      <div className="space-y-2">
        {players.map((player) => (
          <div key={player.id} className="flex items-center gap-2 bg-white/70 rounded-xl px-3 py-2">
            <span className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-sm font-bold">
              {player.full_name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-gray-900 font-semibold truncate">{player.full_name}</span>
              <span className="text-xs text-gray-400">{skillLevelShortLabel(player.skill_level)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
