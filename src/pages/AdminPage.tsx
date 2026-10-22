import { useEffect, useState } from 'react';
import { supabase, supabaseAdmin, Session, Court, Profile, SkillLevel, Environment, Group, PlayerGroup } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { AdminSubPage } from '../components/Layout';
import { SKILL_LEVELS, normalizeSkillLevel, skillLevelColor, skillLevelLabel, skillLevelTextColor } from '../lib/skillLevels';
import { calculatePlayerRatingsFromMatches } from '../lib/rating';
import RatingProgress from '../components/RatingProgress';
import { Plus, Calendar, Trash2, Users, Monitor, X, RefreshCw, Search, CreditCard as Edit2, Check, ShieldCheck, ShieldOff, UserPlus, ChevronDown, Settings, MessageCircle, Send, Copy, CheckCheck, ExternalLink, AlertCircle, Mail, AlertTriangle, Crown, BarChart2, KeyRound } from 'lucide-react';

type EnvFilter = 'all' | Environment;
type PlayerSort = 'name_asc' | 'last_login_desc' | 'last_login_asc';

export default function AdminPage({ tab }: { tab: AdminSubPage }) {
  const { isAdmin, isSuperAdmin } = useAuth();
  const [envFilter, setEnvFilter] = useState<EnvFilter>('prod');

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full p-12 text-center">
        <div>
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <X className="w-8 h-8 text-red-500" />
          </div>
          <p className="text-gray-900 font-semibold text-lg">Access Denied</p>
          <p className="text-gray-500 text-sm mt-1">You need admin privileges to access this page.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto overflow-x-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-bold text-gray-900 leading-tight">Admin Panel</h1>
          {isSuperAdmin && (
            <span className="flex items-center gap-1.5 text-xs bg-rose-50 text-rose-600 border border-rose-200 px-2.5 py-1 rounded-lg font-medium">
              <Crown className="w-3.5 h-3.5" /> Super Admin
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2 w-full sm:w-auto">
          <span className="text-xs font-medium text-gray-400">Environment</span>
          <select
            value={envFilter}
            onChange={(e) => setEnvFilter(e.target.value as EnvFilter)}
            className="text-sm text-gray-700 bg-transparent focus:outline-none flex-1 sm:flex-none"
          >
            <option value="prod">Production</option>
            <option value="dev">Dev / Testing</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {tab === 'sessions' && <SessionsAdmin envFilter={envFilter} />}
      {tab === 'groups' && <GroupsAdmin envFilter={envFilter} />}
      {tab === 'players' && <PlayersAdmin envFilter={envFilter} />}
      {tab === 'rankings' && <PlayerRankings envFilter={envFilter} />}
      {tab === 'whatsapp' && <WhatsAppPoll envFilter={envFilter} />}
      {tab === 'settings' && <AppSettings />}
    </div>
  );
}
// -----------------------------------------------------------------------------

function SessionsAdmin({ envFilter }: { envFilter: EnvFilter }) {
  const { user, isSuperAdmin } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [selectedSession, setSelectedSession] = useState<string | null>(null);
  const [deleteSessionConfirm, setDeleteSessionConfirm] = useState<string | null>(null);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [courts, setCourts] = useState<Court[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [allPlayers, setAllPlayers] = useState<Profile[]>([]);
  const [availabilityMap, setAvailabilityMap] = useState<Record<string, { id: string; available: boolean }>>({});
  const [availabilitySearch, setAvailabilitySearch] = useState('');
  const [availabilitySkillFilter, setAvailabilitySkillFilter] = useState<'all' | SkillLevel>('all');
  const [availabilityError, setAvailabilityError] = useState('');
  const [availLoading, setAvailLoading] = useState(false);
  const [form, setForm] = useState({
    title: '', session_date: '', start_time: '18:00', end_time: '21:00', venue: '', environment: 'prod' as Environment, group_id: '',
  });
  const [courtName, setCourtName] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [courtError, setCourtError] = useState('');

  useEffect(() => { loadSessions(); loadAllPlayers(); loadGroups(); }, [envFilter]);

  useEffect(() => {
    setSelectedSession(null);
    setCourts([]);
    setAvailabilityMap({});
    setAvailabilitySearch('');
    setAvailabilitySkillFilter('all');
    setAvailabilityError('');
    setForm((f) => ({ ...f, environment: envFilter === 'all' ? 'prod' : envFilter, group_id: '' }));
  }, [envFilter]);

  async function loadSessions() {
    let q = supabase.from('sessions').select('*, group:groups(*, created_by_profile:profiles!groups_created_by_fkey(full_name))').order('session_date', { ascending: false });
    if (envFilter !== 'all') q = q.eq('environment', envFilter);
    const { data } = await q;
    const list = ((data as Session[]) || []).filter((session) =>
      isSuperAdmin || session.created_by === user?.id || session.group?.created_by === user?.id
    );
    setSessions(list);
  }

  async function loadAllPlayers() {
    let q = supabase.from('profiles').select('*').order('full_name');
    if (envFilter !== 'all') q = q.eq('environment', envFilter);
    const { data } = await q;
    setAllPlayers(data || []);
  }

  async function loadGroups() {
    let q = supabase.from('groups').select('*').order('name', { ascending: true });
    if (envFilter !== 'all') q = q.eq('environment', envFilter);
    if (!isSuperAdmin && user?.id) q = q.eq('created_by', user.id);
    const { data } = await q;
    setGroups((data as Group[]) || []);
  }

  async function selectSession(sessionId: string) {
    setSelectedSession(sessionId);
    setCourtError('');
    setAvailabilitySearch('');
    setAvailabilitySkillFilter('all');
    setAvailLoading(true);
    const [courtsRes, availRes] = await Promise.all([
      supabase.from('courts').select('*').eq('session_id', sessionId).order('created_at'),
      supabase.from('session_availability').select('*').eq('session_id', sessionId),
    ]);
    setCourts(courtsRes.data || []);
    const map: Record<string, { id: string; available: boolean }> = {};
    for (const a of availRes.data || []) map[a.player_id] = { id: a.id, available: a.available };
    setAvailabilityMap(map);
    setAvailLoading(false);
  }

  async function togglePlayerAvailability(sessionId: string, playerId: string) {
    setAvailabilityError('');
    const existing = availabilityMap[playerId];
    const nextAvailable = !existing?.available;

    const { data, error } = await supabase
      .from('session_availability')
      .upsert(
        {
          session_id: sessionId,
          player_id: playerId,
          available: nextAvailable,
          responded_at: new Date().toISOString(),
        },
        { onConflict: 'session_id,player_id' }
      )
      .select('id, player_id, available')
      .maybeSingle();

    if (error) {
      setAvailabilityError(error.message || 'Failed to update player selection.');
      return;
    }

    setAvailabilityMap((prev) => ({
      ...prev,
      [playerId]: { id: data?.id || existing?.id || '', available: data?.available ?? nextAvailable },
    }));
  }

  async function setPlayersAvailability(sessionId: string, playerIds: string[], available: boolean) {
    if (playerIds.length === 0) return;

    setAvailabilityError('');
    const now = new Date().toISOString();
    const rows = (available ? playerIds : playerIds.filter((playerId) => availabilityMap[playerId]))
      .map((playerId) => ({
        session_id: sessionId,
        player_id: playerId,
        available,
        responded_at: now,
      }));

    if (rows.length === 0) return;

    const { data, error } = await supabase
      .from('session_availability')
      .upsert(rows, { onConflict: 'session_id,player_id' })
      .select('id, player_id, available');

    if (error) {
      setAvailabilityError(error.message || 'Failed to update player selections.');
      return;
    }

    const changedRows = (data as { id: string; player_id: string; available: boolean }[]) || [];
    setAvailabilityMap((prev) => {
      const next = { ...prev };
      for (const playerId of rows.map((row) => row.player_id)) {
        next[playerId] = { id: next[playerId]?.id || '', available };
      }
      for (const row of changedRows) {
        next[row.player_id] = { id: row.id, available: row.available };
      }
      return next;
    });
  }

  async function createSession(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setSessionError('');
    const { data, error } = await supabase.from('sessions').insert({
      title: form.title,
      session_date: form.session_date,
      start_time: form.start_time,
      end_time: form.end_time,
      venue: form.venue,
      environment: form.environment,
      group_id: form.group_id || null,
      created_by: user!.id,
      status: 'open',
    }).select().single();
    if (!error && data) {
      setSessions((prev) => [data, ...prev]);
      setShowForm(false);
      setForm({ title: '', session_date: '', start_time: '18:00', end_time: '21:00', venue: '', environment: envFilter === 'all' ? form.environment : envFilter, group_id: '' });
    } else if (error) {
      setSessionError(error.message || 'Failed to create session');
    }
    setLoading(false);
  }

  async function updateSessionStatus(id: string, status: Session['status']) {
    setSessionError('');
    const { error } = await supabase.from('sessions').update({ status }).eq('id', id);
    if (error) {
      setSessionError(error.message || 'Failed to update session');
      return;
    }
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  }

  async function rebuildPlayerStats(playerIds: string[], environment: Environment) {
    const uniquePlayerIds = [...new Set(playerIds)];
    if (uniquePlayerIds.length === 0) return;

    const { data: completedMatches } = await supabase
      .from('matches')
      .select(`winner_team, session:sessions!inner(environment, counts_for_rankings), teams:match_teams(team_label, players:match_team_players(player_id))`)
      .eq('status', 'completed')
      .eq('session.environment', environment)
      .eq('session.counts_for_rankings', true);

    const stats: Record<string, { player_id: string; wins: number; losses: number; total_matches: number; environment: Environment }> = {};
    for (const playerId of uniquePlayerIds) {
      stats[playerId] = { player_id: playerId, wins: 0, losses: 0, total_matches: 0, environment };
    }

    for (const match of (completedMatches as any[]) || []) {
      for (const team of match.teams || []) {
        const didWin = match.winner_team === team.team_label;
        for (const player of team.players || []) {
          if (!stats[player.player_id]) continue;
          stats[player.player_id].wins += didWin ? 1 : 0;
          stats[player.player_id].losses += didWin ? 0 : 1;
          stats[player.player_id].total_matches += 1;
        }
      }
    }

    await supabase
      .from('player_stats')
      .delete()
      .eq('environment', environment)
      .in('player_id', uniquePlayerIds);

    const rows = Object.values(stats)
      .filter((row) => row.total_matches > 0)
      .map((row) => ({ ...row, updated_at: new Date().toISOString() }));

    if (rows.length > 0) {
      await supabase.from('player_stats').insert(rows);
    }
  }

  async function deleteRows(table: string, column: string, value: string | string[]) {
    if (Array.isArray(value) && value.length === 0) return;

    const query = supabase.from(table).delete();
    const { error } = Array.isArray(value)
      ? await query.in(column, value)
      : await query.eq(column, value);

    if (error) throw new Error(`${table}: ${error.message}`);
  }

  async function deleteSession(session: Session) {
    setSessionError('');
    setDeletingSessionId(session.id);

    try {
      const { data: matchRows } = await supabase
        .from('matches')
        .select('id')
        .eq('session_id', session.id);
      const matchIds = ((matchRows as any[]) || []).map((m) => m.id);

      let affectedPlayerIds: string[] = [];
      if (matchIds.length > 0) {
        const { data: teamRows } = await supabase
          .from('match_teams')
          .select('id')
          .in('match_id', matchIds);
        const teamIds = ((teamRows as any[]) || []).map((t) => t.id);

        if (teamIds.length > 0) {
          const { data: playerRows } = await supabase
            .from('match_team_players')
            .select('player_id')
            .in('match_team_id', teamIds);
          affectedPlayerIds = ((playerRows as any[]) || []).map((p) => p.player_id);

          await deleteRows('match_team_players', 'match_team_id', teamIds);
        }

        await deleteRows('match_teams', 'match_id', matchIds);
        await deleteRows('matches', 'session_id', session.id);
      }

      await deleteRows('court_queues', 'session_id', session.id);
      await deleteRows('availability_poll_tokens', 'session_id', session.id);
      await deleteRows('session_invites', 'session_id', session.id);
      await deleteRows('session_availability', 'session_id', session.id);
      await deleteRows('courts', 'session_id', session.id);
      await rebuildPlayerStats(affectedPlayerIds, session.environment);
      await deleteRows('sessions', 'id', session.id);

      setSessions((prev) => prev.filter((s) => s.id !== session.id));
      if (selectedSession === session.id) {
        setSelectedSession(null);
        setCourts([]);
        setAvailabilityMap({});
      }
      setDeleteSessionConfirm(null);
    } catch (error: any) {
      setSessionError(error?.message || 'Failed to delete session');
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function addCourt() {
    if (!courtName.trim() || !selectedSession) return;
    setCourtError('');
    const { data, error } = await supabase.from('courts').insert({
      session_id: selectedSession,
      name: courtName.trim(),
      status: 'available',
    }).select().single();
    if (error) {
      setCourtError(error.message || 'Failed to add court');
      return;
    }
    if (data) {
      setCourts((prev) => [...prev, data]);
      setCourtName('');
    }
  }

  async function deleteCourt(courtId: string) {
    setCourtError('');
    const { error } = await supabase.from('courts').delete().eq('id', courtId);
    if (error) {
      setCourtError(error.message || 'Failed to delete court');
      return;
    }
    setCourts((prev) => prev.filter((c) => c.id !== courtId));
  }

  const availabilitySearchTerm = availabilitySearch.trim().toLowerCase();
  const filteredAvailabilityPlayers = allPlayers.filter((player) => {
    if (availabilitySkillFilter !== 'all' && normalizeSkillLevel(player.skill_level) !== availabilitySkillFilter) return false;
    if (!availabilitySearchTerm) return true;
    const name = player.full_name?.toLowerCase() || '';
    const phone = player.phone?.toLowerCase() || '';
    const skill = skillLevelLabel(player.skill_level).toLowerCase();
    return name.includes(availabilitySearchTerm) || phone.includes(availabilitySearchTerm) || skill.includes(availabilitySearchTerm);
  });
  const availableCount = Object.values(availabilityMap).filter((a) => a.available).length;
  const visiblePlayerIds = filteredAvailabilityPlayers.map((player) => player.id);
  const visibleAvailableCount = visiblePlayerIds.filter((playerId) => availabilityMap[playerId]?.available === true).length;
  const allVisibleAvailable = visiblePlayerIds.length > 0 && visibleAvailableCount === visiblePlayerIds.length;
  const selectedVisiblePlayers = filteredAvailabilityPlayers.filter((player) => availabilityMap[player.id]?.available === true);
  const unselectedVisiblePlayers = filteredAvailabilityPlayers.filter((player) => availabilityMap[player.id]?.available !== true);

  const renderAvailabilityPlayer = (player: Profile) => {
    const avail = availabilityMap[player.id];
    const isAvailable = avail?.available === true;
    return (
      <button
        key={player.id}
        onClick={() => togglePlayerAvailability(selectedSession!, player.id)}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl transition-all text-left ${
          isAvailable
            ? 'bg-emerald-50 border border-emerald-300 hover:bg-emerald-100'
            : 'bg-gray-50 border border-transparent hover:border-gray-200'
        }`}
      >
        <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border transition-all ${
          isAvailable ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
        }`}>
          {isAvailable && <Check className="w-3 h-3 text-white" />}
        </div>
        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
          isAvailable ? 'bg-emerald-100 text-emerald-600' : 'bg-gray-200 text-gray-500'
        }`}>
          {player.full_name?.charAt(0)?.toUpperCase()}
        </div>
        <span className={`text-sm flex-1 truncate ${isAvailable ? 'text-gray-900' : 'text-gray-500'}`}>
          {player.full_name}
        </span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full hidden sm:block ${skillLevelColor(player.skill_level)}`}>
          {skillLevelLabel(player.skill_level)}
        </span>
        {player.phone && (
          <span className="text-xs text-gray-400 truncate hidden lg:block">{player.phone}</span>
        )}
      </button>
    );
  };


  return (
    <div className="grid lg:grid-cols-5 gap-6 min-w-0">
      {/* Session list */}
      <div className="lg:col-span-2 space-y-4 min-w-0">
        <div className="flex justify-between items-center gap-2">
          <h2 className="text-gray-900 font-semibold">Sessions</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm px-3 py-1.5 rounded-lg transition-all"
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>
        </div>

        {showForm && (
          <form onSubmit={createSession} className="bg-gray-100 border border-gray-200 rounded-2xl p-4 space-y-3">
            {sessionError && (
              <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-3 py-2">
                {sessionError}
              </div>
            )}
            <input
              placeholder="Session Title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
              className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Date</label>
                <input
                  type="date"
                  value={form.session_date}
                  onChange={(e) => setForm((f) => ({ ...f, session_date: e.target.value }))}
                  required
                  className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Venue</label>
                <input
                  placeholder="Venue"
                  value={form.venue}
                  onChange={(e) => setForm((f) => ({ ...f, venue: e.target.value }))}
                  required
                  className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Start</label>
                <input
                  type="time"
                  value={form.start_time}
                  onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                  className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="text-gray-400 text-xs mb-1 block">End</label>
                <input
                  type="time"
                  value={form.end_time}
                  onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                  className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
              <div className="col-span-2">
                <label className="text-gray-400 text-xs mb-1 block">Environment</label>
                <div className="w-full bg-white border border-gray-200 text-gray-700 rounded-xl px-3 py-2 text-sm">
                  {form.environment === 'dev' ? 'Dev / Testing' : 'Production'}
                </div>
              </div>
              <div className="col-span-2">
                <label className="text-gray-400 text-xs mb-1 block">Group</label>
                <select
                  value={form.group_id}
                  onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value }))}
                  className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">No group</option>
                  {groups
                    .filter((group) => group.environment === form.environment)
                    .map((group) => (
                      <option key={group.id} value={group.id}>{group.name}</option>
                    ))}
                </select>
                <p className="text-gray-400 text-xs mt-1">Create groups from Admin Panel / Groups.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white text-sm py-2 rounded-xl transition-all"
              >
                {loading ? 'Creating...' : 'Create Session'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="px-3 py-2 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">
                Cancel
              </button>
            </div>
          </form>
        )}
        {!showForm && sessionError && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-3 py-2">
            {sessionError}
          </div>
        )}

        <div className="space-y-2">
          {sessions.map((session) => (
            <div
              key={session.id}
              onClick={() => selectSession(session.id)}
              className={`cursor-pointer p-4 rounded-2xl border transition-all overflow-hidden ${
                selectedSession === session.id
                  ? 'bg-gray-100 border-emerald-400'
                  : 'bg-white border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                  <p className="text-gray-900 text-base sm:text-sm font-semibold break-words">{session.title}</p>
                  {session.environment === 'dev' && (
                    <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded font-medium flex-shrink-0">Dev</span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 sm:flex-shrink-0">
                  <select
                    value={session.status}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => updateSessionStatus(session.id, e.target.value as Session['status'])}
                    className="w-full sm:w-auto sm:max-w-[120px] bg-gray-100 border border-gray-200 text-gray-700 text-xs rounded-lg px-2 py-1.5 focus:outline-none"
                  >
                    <option value="open">Open</option>
                    <option value="in_progress">In Progress</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteSessionConfirm((current) => current === session.id ? null : session.id);
                    }}
                    disabled={deletingSessionId === session.id}
                    className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
                    title="Delete session"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 min-w-0 text-xs">
                {session.group?.name && (
                  <span className="inline-flex w-fit max-w-full bg-sky-50 text-sky-600 border border-sky-100 px-2 py-0.5 rounded-lg font-medium break-words">
                    {session.group.name}
                  </span>
                )}
                <span className="text-gray-400 leading-relaxed break-words">
                  {formatDate(session.session_date)} &middot; {session.start_time.slice(0, 5)} - {session.end_time.slice(0, 5)} &middot; {session.venue}
                </span>
              </div>
              {deleteSessionConfirm === session.id && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-red-700 text-xs font-semibold">Delete this session and all matches?</p>
                      <p className="text-red-600/80 text-xs mt-0.5">This also removes courts, queues, availability, match history, and recalculates player stats.</p>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => deleteSession(session)}
                      disabled={deletingSessionId === session.id}
                      className="flex-1 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white text-xs font-semibold rounded-lg px-3 py-2 transition-all"
                    >
                      {deletingSessionId === session.id ? 'Deleting...' : 'Yes, delete'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteSessionConfirm(null)}
                      disabled={deletingSessionId === session.id}
                      className="px-3 py-2 bg-white border border-red-100 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50 transition-all"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Session detail */}
      <div className="lg:col-span-3 min-w-0">
        {selectedSession ? (
          <div className="space-y-5 min-w-0">
            {/* Courts */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 min-w-0 overflow-hidden">
              <h3 className="text-gray-900 font-semibold mb-4 flex items-center gap-2">
                <Monitor className="w-4 h-4 text-emerald-600" /> Courts
              </h3>
              <div className="flex flex-col sm:flex-row gap-2 mb-3 min-w-0">
                <input
                  placeholder="e.g. Court 1"
                  value={courtName}
                  onChange={(e) => setCourtName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addCourt()}
                  className="flex-1 min-w-0 bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={addCourt}
                  className="bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-xl text-sm transition-all"
                >
                  Add
                </button>
              </div>
              {courtError && (
                <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-3 py-2 mb-3">
                  {courtError}
                </div>
              )}
              {courts.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-3">No courts added yet</p>
              ) : (
                <div className="grid sm:grid-cols-2 gap-2 min-w-0">
                  {courts.map((court) => (
                    <div key={court.id} className="flex items-center justify-between gap-2 bg-gray-100 rounded-xl px-3 py-2 min-w-0">
                      <span className="text-gray-700 text-sm truncate min-w-0">{court.name}</span>
                      <button onClick={() => deleteCourt(court.id)} className="text-gray-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Player availability management */}
            <div className="bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 min-w-0 overflow-hidden">
              <div className="flex items-start justify-between gap-3 mb-4">
                <h3 className="text-gray-900 font-semibold flex items-center gap-2 flex-wrap min-w-0">
                  <Users className="w-4 h-4 text-emerald-600" />
                  Player Availability
                  <span className="text-xs font-normal text-gray-400 ml-1">
                    ({availableCount} / {allPlayers.length})
                  </span>
                </h3>
                <button
                  onClick={() => selectSession(selectedSession!)}
                  className="text-gray-400 hover:text-gray-900"
                >
                  <RefreshCw className={`w-4 h-4 ${availLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {allPlayers.length === 0 ? (
                <p className="text-gray-400 text-sm text-center py-4">No players registered yet.</p>
              ) : (
                <div>
                  {availabilityError && (
                    <div className="bg-red-50 border border-red-200 text-red-600 text-xs rounded-xl px-3 py-2 mb-3">
                      {availabilityError}
                    </div>
                  )}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      value={availabilitySearch}
                      onChange={(e) => setAvailabilitySearch(e.target.value)}
                      placeholder="Search players, phone, or skill..."
                      className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl pl-9 pr-9 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    {availabilitySearch && (
                      <button
                        onClick={() => setAvailabilitySearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 rounded-md hover:bg-gray-100"
                        title="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 max-w-full">
                    {(['all', ...SKILL_LEVELS] as Array<'all' | SkillLevel>).map((skill) => {
                      const inactiveClass = skill === 'all'
                        ? 'bg-gray-100 text-gray-500 hover:text-gray-800 border-gray-200'
                        : `${skillLevelColor(skill)} hover:brightness-95`;
                      return (
                        <button
                          key={skill}
                          onClick={() => setAvailabilitySkillFilter(skill)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border whitespace-nowrap transition-all ${
                            availabilitySkillFilter === skill ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : inactiveClass
                          }`}
                        >
                          {skill === 'all' ? 'All levels' : skillLevelLabel(skill)}
                        </button>
                      );
                    })}
                  </div>
                  {filteredAvailabilityPlayers.length > 0 && (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 min-w-0">
                      <button
                        onClick={() => setPlayersAvailability(selectedSession!, visiblePlayerIds, !allVisibleAvailable)}
                        className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-emerald-600 transition-colors"
                      >
                        <span className={`w-4 h-4 rounded flex items-center justify-center border transition-all ${
                          allVisibleAvailable ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 bg-white'
                        }`}>
                          {allVisibleAvailable && <Check className="w-3 h-3 text-white" />}
                        </span>
                        {allVisibleAvailable ? 'Clear visible' : 'Select visible'}
                      </button>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs text-gray-400">
                          {visibleAvailableCount} of {filteredAvailabilityPlayers.length} visible
                        </span>
                        {availableCount > 0 && (
                          <button
                            onClick={() => setPlayersAvailability(selectedSession!, Object.keys(availabilityMap), false)}
                            className="text-xs font-medium text-red-500 hover:text-red-600"
                          >
                            Clear all
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {filteredAvailabilityPlayers.length === 0 ? (
                    <p className="text-gray-400 text-sm text-center py-4">No players match your search.</p>
                  ) : (
                    <div className="space-y-4">
                      {selectedVisiblePlayers.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-600">Selected</p>
                            <span className="text-xs text-gray-400">{selectedVisiblePlayers.length}</span>
                          </div>
                          <div className="space-y-1">
                            {selectedVisiblePlayers.map(renderAvailabilityPlayer)}
                          </div>
                        </div>
                      )}
                      {unselectedVisiblePlayers.length > 0 && (
                        <div>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Not Selected</p>
                            <span className="text-xs text-gray-400">{unselectedVisiblePlayers.length}</span>
                          </div>
                          <div className="space-y-1">
                            {unselectedVisiblePlayers.map(renderAvailabilityPlayer)}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-12 text-center h-full flex flex-col items-center justify-center">
            <Calendar className="w-10 h-10 text-gray-300 mb-3" />
            <p className="text-gray-400">Select a session to manage courts and players</p>
          </div>
        )}
      </div>
    </div>
  );
}
// -----------------------------------------------------------------------------

interface NewPlayerForm {
  full_name: string;
  email: string;
  password: string;
  phone: string;
  skill_level: SkillLevel;
  role: 'player' | 'admin';
  environment: Environment;
  group_ids: string[];
}

const SUPABASE_FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callManagePlayer(body: object) {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_FN_URL}/manage-player`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session?.access_token}`,
      'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Request failed');
  return json;
}

type ModalState =
  | { type: 'none' }
  | { type: 'email'; player: Profile }
  | { type: 'reset'; player: Profile }
  | { type: 'delete'; player: Profile };

function GroupsAdmin({ envFilter }: { envFilter: EnvFilter }) {
  const { user, isSuperAdmin } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [players, setPlayers] = useState<Profile[]>([]);
  const [memberships, setMemberships] = useState<PlayerGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [search, setSearch] = useState('');
  const [memberLevelFilter, setMemberLevelFilter] = useState<'all' | SkillLevel>('all');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [newGroupOwnerId, setNewGroupOwnerId] = useState('');
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState('');
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupDescription, setEditGroupDescription] = useState('');
  const [editGroupOwnerId, setEditGroupOwnerId] = useState('');
  const [error, setError] = useState('');
  const selectedGroup = groups.find((group) => group.id === selectedGroupId);

  useEffect(() => {
    loadGroups();
    loadPlayers();
    setSelectedGroupId('');
    setMemberships([]);
    setEditingGroupId('');
    setMemberLevelFilter('all');
  }, [envFilter]);

  useEffect(() => {
    if (selectedGroupId) loadMemberships(selectedGroupId);
  }, [selectedGroupId]);

  async function loadGroups() {
    let query = supabase
      .from('groups')
      .select('*, created_by_profile:profiles!groups_created_by_fkey(full_name)')
      .order('name', { ascending: true });
    if (envFilter !== 'all') query = query.eq('environment', envFilter);
    if (!isSuperAdmin && user?.id) query = query.eq('created_by', user.id);
    const { data } = await query;
    const list = (data as Group[]) || [];
    setGroups(list);
    setSelectedGroupId((current) => list.some((group) => group.id === current) ? current : list[0]?.id || '');
  }

  async function loadPlayers() {
    let query = supabase.from('profiles').select('*').order('full_name', { ascending: true });
    if (envFilter !== 'all') query = query.eq('environment', envFilter);
    const { data } = await query;
    setPlayers((data as Profile[]) || []);
  }

  async function loadMemberships(groupId: string) {
    const { data } = await supabase.from('player_groups').select('*').eq('group_id', groupId);
    setMemberships((data as PlayerGroup[]) || []);
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setError('');
    const environment = envFilter === 'all' ? 'prod' : envFilter;
    const { data, error: createError } = await supabase
      .from('groups')
      .insert({
        name: newGroupName.trim(),
        description: newGroupDescription.trim() || null,
        environment,
        created_by: isSuperAdmin ? (newGroupOwnerId || user?.id || null) : (user?.id || null),
      })
      .select('*, created_by_profile:profiles!groups_created_by_fkey(full_name)')
      .single();

    if (createError) {
      setError(createError.message || 'Failed to create group.');
      return;
    }

    if (data) {
      setGroups((prev) => [...prev, data as Group].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedGroupId((data as Group).id);
      setNewGroupName('');
      setNewGroupDescription('');
      setNewGroupOwnerId('');
      setShowCreateGroup(false);
    }
  }

  async function deleteGroup(groupId: string) {
    setError('');
    const { error: deleteError } = await supabase.from('groups').delete().eq('id', groupId);
    if (deleteError) {
      setError(deleteError.message || 'Failed to delete group.');
      return;
    }
    setGroups((prev) => prev.filter((group) => group.id !== groupId));
    setSelectedGroupId((current) => current === groupId ? '' : current);
    setMemberships([]);
  }

  function startEditingGroup(group: Group) {
    setEditingGroupId(group.id);
    setEditGroupName(group.name);
    setEditGroupDescription(group.description || '');
    setEditGroupOwnerId(group.created_by || '');
  }

  async function saveGroupEdit(groupId: string) {
    if (!editGroupName.trim()) return;
    setError('');
    const { data, error: updateError } = await supabase
      .from('groups')
      .update({
        name: editGroupName.trim(),
        description: editGroupDescription.trim() || null,
        ...(isSuperAdmin ? { created_by: editGroupOwnerId || null } : {}),
      })
      .eq('id', groupId)
      .select('*, created_by_profile:profiles!groups_created_by_fkey(full_name)')
      .single();

    if (updateError) {
      setError(updateError.message || 'Failed to update group.');
      return;
    }

    if (data) {
      setGroups((prev) => prev
        .map((group) => group.id === groupId ? data as Group : group)
        .sort((a, b) => a.name.localeCompare(b.name)));
      setEditingGroupId('');
    }
  }

  async function toggleMembership(player: Profile) {
    if (!selectedGroupId) return;
    setError('');
    const existing = memberships.find((membership) => membership.player_id === player.id);
    if (existing) {
      const { error: deleteError } = await supabase.from('player_groups').delete().eq('id', existing.id);
      if (deleteError) {
        setError(deleteError.message || 'Failed to remove player from group.');
        return;
      }
      setMemberships((prev) => prev.filter((membership) => membership.id !== existing.id));
      return;
    }

    const { data, error: addError } = await supabase
      .from('player_groups')
      .insert({ group_id: selectedGroupId, player_id: player.id, role: 'member' })
      .select()
      .single();

    if (addError) {
      setError(addError.message || 'Failed to add player to group.');
      return;
    }
    if (data) setMemberships((prev) => [...prev, data as PlayerGroup]);
  }

  async function setVisibleMemberships(shouldAdd: boolean) {
    if (!selectedGroupId) return;
    setError('');
    const visibleIds = filteredPlayers.map((player) => player.id);
    if (visibleIds.length === 0) return;

    if (shouldAdd) {
      const existingIds = new Set(memberships.map((membership) => membership.player_id));
      const rows = visibleIds
        .filter((playerId) => !existingIds.has(playerId))
        .map((playerId) => ({ group_id: selectedGroupId, player_id: playerId, role: 'member' }));
      if (rows.length === 0) return;

      const { data, error: addError } = await supabase
        .from('player_groups')
        .insert(rows)
        .select();
      if (addError) {
        setError(addError.message || 'Failed to add visible players.');
        return;
      }
      setMemberships((prev) => [...prev, ...((data as PlayerGroup[]) || [])]);
      return;
    }

    const idsToDelete = memberships
      .filter((membership) => visibleIds.includes(membership.player_id))
      .map((membership) => membership.id);
    if (idsToDelete.length === 0) return;

    const { error: deleteError } = await supabase.from('player_groups').delete().in('id', idsToDelete);
    if (deleteError) {
      setError(deleteError.message || 'Failed to clear visible players.');
      return;
    }
    setMemberships((prev) => prev.filter((membership) => !idsToDelete.includes(membership.id)));
  }

  const memberIds = new Set(memberships.map((membership) => membership.player_id));
  const searchTerm = search.trim().toLowerCase();
  const filteredPlayers = players.filter((player) => {
    if (memberLevelFilter !== 'all' && normalizeSkillLevel(player.skill_level) !== memberLevelFilter) return false;
    if (!searchTerm) return true;
    const name = player.full_name?.toLowerCase() || '';
    const phone = player.phone?.toLowerCase() || '';
    const level = skillLevelLabel(player.skill_level).toLowerCase();
    return name.includes(searchTerm) || phone.includes(searchTerm) || level.includes(searchTerm);
  });
  const visibleMemberCount = filteredPlayers.filter((player) => memberIds.has(player.id)).length;
  const allVisibleMembers = filteredPlayers.length > 0 && visibleMemberCount === filteredPlayers.length;
  const ownerCandidates = players.filter((player) => player.role === 'admin' || player.role === 'super_admin');

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h2 className="text-gray-900 font-semibold">Groups</h2>
          <p className="text-gray-500 text-sm mt-1">Players can belong to multiple groups. Sessions belong to one group.</p>
        </div>
        <button
          type="button"
          onClick={() => { setNewGroupOwnerId(user?.id || ''); setShowCreateGroup(true); setError(''); }}
          className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-xl px-4 py-2.5 transition-all"
        >
          <Plus className="w-4 h-4" /> New Group
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      <div className="grid xl:grid-cols-[380px_1fr] gap-5">
        <div className="bg-white border border-gray-200 rounded-2xl p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-gray-900 font-semibold">Group List</h3>
            <span className="bg-gray-100 text-gray-500 rounded-lg px-2 py-1 text-xs font-semibold">{groups.length}</span>
          </div>
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
          {groups.length === 0 && (
            <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-8 text-center">
              <Users className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-500 text-sm">No groups yet.</p>
            </div>
          )}
          {groups.map((group) => {
            const isEditing = editingGroupId === group.id;
            return (
              <div
                key={group.id}
                onClick={() => !isEditing && setSelectedGroupId(group.id)}
                className={`w-full text-left bg-white border rounded-2xl p-4 transition-all ${
                  selectedGroupId === group.id ? 'border-emerald-400 bg-emerald-50/40' : 'border-gray-200 hover:border-gray-300'
                } ${isEditing ? 'cursor-default' : 'cursor-pointer'}`}
              >
                {isEditing ? (
                  <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      value={editGroupName}
                      onChange={(e) => setEditGroupName(e.target.value)}
                      className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <textarea
                      value={editGroupDescription}
                      onChange={(e) => setEditGroupDescription(e.target.value)}
                      rows={2}
                      placeholder="Optional description"
                      className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none"
                    />
                    {isSuperAdmin && (
                      <div>
                        <label className="text-gray-400 text-xs mb-1 block">Owner / Admin</label>
                        <select
                          value={editGroupOwnerId}
                          onChange={(e) => setEditGroupOwnerId(e.target.value)}
                          className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                        >
                          <option value="">No owner</option>
                          {ownerCandidates.map((owner) => (
                            <option key={owner.id} value={owner.id}>
                              {owner.full_name} {owner.role === 'super_admin' ? '(Super Admin)' : '(Admin)'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => saveGroupEdit(group.id)}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-white text-xs font-semibold rounded-lg px-3 py-2 transition-all"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingGroupId('')}
                        className="px-3 py-2 bg-gray-100 text-gray-600 text-xs font-semibold rounded-lg hover:bg-gray-200 transition-all"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-gray-900 font-semibold break-words">{group.name}</p>
                      <p className="text-gray-400 text-xs mt-1">
                        {group.environment === 'prod' ? 'Production' : 'Dev / Testing'}
                        {group.created_by_profile?.full_name ? ` · Owner: ${group.created_by_profile.full_name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); startEditingGroup(group); }}
                        className="text-gray-300 hover:text-sky-600 p-1.5 rounded-lg hover:bg-sky-50 transition-all"
                        title="Edit group"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); deleteGroup(group.id); }}
                        className="text-gray-300 hover:text-red-500 p-1.5 rounded-lg hover:bg-red-50 transition-all"
                        title="Delete group"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>

      <div>
        <div className="bg-white border border-gray-200 rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-gray-900 font-semibold">Group Members</h3>
              <p className="text-gray-500 text-sm mt-1">
                {selectedGroup ? `${selectedGroup.name} has ${memberIds.size} players` : 'Select a group to add players'}
              </p>
            </div>
            {selectedGroup && (
              <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-xl px-3 py-1 text-xs font-semibold">
                {memberIds.size}
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-[1fr_auto] gap-2 mb-4">
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search players, phone, or level..."
                disabled={!selectedGroup}
                className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              />
            </div>
            <select
              value={memberLevelFilter}
              onChange={(e) => setMemberLevelFilter(e.target.value as 'all' | SkillLevel)}
              disabled={!selectedGroup}
              className="bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 disabled:opacity-50"
            >
              <option value="all">All levels</option>
              {SKILL_LEVELS.map((level) => (
                <option key={level} value={level}>{skillLevelLabel(level)}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {(['all', ...SKILL_LEVELS] as Array<'all' | SkillLevel>).map((level) => {
              const active = memberLevelFilter === level;
              return (
                <button
                  key={level}
                  type="button"
                  disabled={!selectedGroup}
                  onClick={() => setMemberLevelFilter(level)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold whitespace-nowrap transition-all disabled:opacity-50 ${
                    active
                      ? 'bg-emerald-500 text-white border-emerald-500'
                      : level === 'all'
                      ? 'bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200'
                      : `${skillLevelColor(level)} hover:brightness-95`
                  }`}
                >
                  {level === 'all' ? 'All levels' : skillLevelLabel(level)}
                </button>
              );
            })}
          </div>
          {selectedGroup && (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-gray-50 border border-gray-200 px-3 py-2 mb-4">
              <button
                type="button"
                onClick={() => setVisibleMemberships(!allVisibleMembers)}
                disabled={filteredPlayers.length === 0}
                className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 disabled:opacity-50"
              >
                <span className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                  allVisibleMembers ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300 bg-white'
                }`}>
                  {allVisibleMembers && <Check className="w-3.5 h-3.5 text-white" />}
                </span>
                {allVisibleMembers ? 'Clear visible' : 'Select visible'}
              </button>
              <div className="flex items-center justify-between sm:justify-end gap-3">
                <span className="text-xs text-gray-400">{visibleMemberCount} of {filteredPlayers.length} visible selected</span>
                <button
                  type="button"
                  onClick={() => setVisibleMemberships(false)}
                  disabled={visibleMemberCount === 0}
                  className="text-xs font-semibold text-red-500 hover:text-red-600 disabled:opacity-40"
                >
                  Clear visible
                </button>
              </div>
            </div>
          )}
          <div className="space-y-2 max-h-[620px] overflow-y-auto pr-1">
            {!selectedGroup && (
              <p className="text-gray-400 text-sm text-center py-8">Create or select a group first.</p>
            )}
            {selectedGroup && filteredPlayers.map((player) => {
              const isMember = memberIds.has(player.id);
              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => toggleMembership(player)}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2 border text-left transition-all ${
                    isMember ? 'bg-emerald-50 border-emerald-300' : 'bg-gray-50 border-transparent hover:border-gray-200'
                  }`}
                >
                  <div className={`w-4 h-4 rounded flex items-center justify-center border flex-shrink-0 ${
                    isMember ? 'bg-emerald-500 border-emerald-500' : 'border-gray-300'
                  }`}>
                    {isMember && <Check className="w-3 h-3 text-white" />}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-semibold text-xs">
                    {player.full_name?.charAt(0)?.toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 text-sm font-medium truncate">{player.full_name}</p>
                    <span className={`text-[11px] px-2 py-0.5 rounded-full ${skillLevelColor(player.skill_level)}`}>
                      {skillLevelLabel(player.skill_level)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      </div>

      {showCreateGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <form onSubmit={createGroup} className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-gray-900 font-semibold">Create Group</h3>
                <p className="text-gray-500 text-sm mt-1">Create a group, then choose its members.</p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateGroup(false)}
                className="text-gray-400 hover:text-gray-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name, e.g. JS Monday"
              autoFocus
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
            />
            <textarea
              value={newGroupDescription}
              onChange={(e) => setNewGroupDescription(e.target.value)}
              placeholder="Optional description"
              rows={3}
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
            {isSuperAdmin && (
              <div>
                <label className="text-gray-400 text-xs mb-1 block">Owner / Admin</label>
                <select
                  value={newGroupOwnerId}
                  onChange={(e) => setNewGroupOwnerId(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">No owner</option>
                  {ownerCandidates.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.full_name} {owner.role === 'super_admin' ? '(Super Admin)' : '(Admin)'}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowCreateGroup(false)}
                className="px-5 py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-semibold hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="sm:min-w-[180px] bg-emerald-500 hover:bg-emerald-400 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-all"
              >
                Create Group
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function PlayersAdmin({ envFilter }: { envFilter: EnvFilter }) {
  const { user, isSuperAdmin } = useAuth();
  const [players, setPlayers] = useState<Profile[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [search, setSearch] = useState('');
  const [skillFilter, setSkillFilter] = useState<'all' | SkillLevel>('all');
  const [sortBy, setSortBy] = useState<PlayerSort>('name_asc');
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Profile>>({});
  const [addForm, setAddForm] = useState<NewPlayerForm>({
    full_name: '', email: '', password: '', phone: '',
    skill_level: 'level_5', role: 'player', environment: 'prod', group_ids: [],
  });
  const [addLoading, setAddLoading] = useState(false);
  const [addError, setAddError] = useState('');
  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');
  const [newEmail, setNewEmail] = useState('');

  useEffect(() => {
    loadPlayers();
    loadGroups();
  }, [envFilter]);

  useEffect(() => {
    setAddForm((f) => ({ ...f, environment: envFilter === 'all' ? 'prod' : envFilter, group_ids: [] }));
  }, [envFilter]);

  async function loadPlayers() {
    setLoading(true);
    let q = supabase.from('profiles').select('*').order('full_name', { ascending: true });
    if (envFilter !== 'all') q = q.eq('environment', envFilter);
    const { data } = await q;
    setPlayers(data || []);
    setLoading(false);
  }

  async function loadGroups() {
    let q = supabase.from('groups').select('*').order('name', { ascending: true });
    if (envFilter !== 'all') q = q.eq('environment', envFilter);
    if (!isSuperAdmin && user?.id) q = q.eq('created_by', user.id);
    const { data } = await q;
    setGroups((data as Group[]) || []);
  }

  function toggleAddPlayerGroup(groupId: string) {
    setAddForm((form) => ({
      ...form,
      group_ids: form.group_ids.includes(groupId)
        ? form.group_ids.filter((id) => id !== groupId)
        : [...form.group_ids, groupId],
    }));
  }

  async function saveEdit(id: string) {
    await supabase.from('profiles').update({
      full_name: editForm.full_name,
      skill_level: editForm.skill_level,
      phone: editForm.phone,
      role: editForm.role,
    }).eq('id', id);
    setPlayers((prev) => prev.map((p) => (p.id === id ? { ...p, ...editForm } as Profile : p)));
    setEditId(null);
  }

  async function toggleRole(player: Profile) {
    if (!isSuperAdmin) return;
    const newRole = player.role === 'admin' ? 'player' : 'admin';
    await supabase.from('profiles').update({ role: newRole }).eq('id', player.id);
    setPlayers((prev) => prev.map((p) => (p.id === player.id ? { ...p, role: newRole } : p)));
  }

  async function addPlayer(e: React.FormEvent) {
    e.preventDefault();
    setAddError('');
    setAddLoading(true);
    try {
      const { data, error } = await supabaseAdmin.auth.signUp({ email: addForm.email, password: addForm.password });
      if (error) throw error;
      if (data.user) {
        const { error: profileError } = await supabase.from('profiles').insert({
          id: data.user.id,
          full_name: addForm.full_name,
          skill_level: addForm.skill_level,
          phone: addForm.phone,
          role: addForm.role,
          environment: addForm.environment,
        });
        if (profileError) throw profileError;

        if (addForm.group_ids.length > 0) {
          const { error: groupsError } = await supabase.from('player_groups').insert(
            addForm.group_ids.map((groupId) => ({
              group_id: groupId,
              player_id: data.user!.id,
              role: 'member',
            }))
          );
          if (groupsError) throw groupsError;
        }
        supabase.functions.invoke('notify-super-admin', {
          body: {
            action: 'account_created',
            full_name: addForm.full_name,
            email: addForm.email,
            phone: addForm.phone,
          },
        }).catch((notifyError) => {
          console.warn('Account notification failed', notifyError);
        });
      }
      await supabaseAdmin.auth.signOut();
      setShowAdd(false);
      setAddForm({
        full_name: '',
        email: '',
        password: '',
        phone: '',
        skill_level: 'level_5',
        role: 'player',
        environment: envFilter === 'all' ? addForm.environment : envFilter,
        group_ids: [],
      });
      loadPlayers();
    } catch (err: any) {
      setAddError(err.message || 'Failed to create player');
    } finally {
      setAddLoading(false);
    }
  }

  async function handleUpdateEmail() {
    if (modal.type !== 'email') return;
    setModalLoading(true);
    setModalError('');
    try {
      await callManagePlayer({ action: 'update_email', player_id: modal.player.id, email: newEmail });
      setModal({ type: 'none' });
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  }

  async function handleDeletePlayer() {
    if (modal.type !== 'delete') return;
    setModalLoading(true);
    setModalError('');
    try {
      await callManagePlayer({ action: 'delete', player_id: modal.player.id });
      setPlayers((prev) => prev.filter((p) => p.id !== modal.player.id));
      setModal({ type: 'none' });
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  }

  async function handleSendPasswordReset() {
    if (modal.type !== 'reset') return;
    setModalLoading(true);
    setModalError('');
    try {
      await callManagePlayer({
        action: 'send_password_reset',
        player_id: modal.player.id,
        redirectTo: window.location.origin,
      });
      setModal({ type: 'none' });
    } catch (err: any) {
      setModalError(err.message);
    } finally {
      setModalLoading(false);
    }
  }

  function openEmailModal(player: Profile) {
    setNewEmail('');
    setModalError('');
    setModal({ type: 'email', player });
  }

  function openResetModal(player: Profile) {
    setModalError('');
    setModal({ type: 'reset', player });
  }

  function openDeleteModal(player: Profile) {
    setModalError('');
    setModal({ type: 'delete', player });
  }

  const filtered = players.filter((p) => {
    const term = search.toLowerCase();
    const matchSearch =
      p.full_name.toLowerCase().includes(term) ||
      p.phone?.includes(search) ||
      skillLevelLabel(p.skill_level).toLowerCase().includes(term);
    const matchSkill = skillFilter === 'all' || normalizeSkillLevel(p.skill_level) === skillFilter;
    return matchSearch && matchSkill;
  }).sort((a, b) => {
    if (sortBy === 'last_login_desc' || sortBy === 'last_login_asc') {
      const aTime = a.last_login_at ? new Date(a.last_login_at).getTime() : 0;
      const bTime = b.last_login_at ? new Date(b.last_login_at).getTime() : 0;
      if (aTime !== bTime) {
        return sortBy === 'last_login_desc' ? bTime - aTime : aTime - bTime;
      }
    }

    return a.full_name.localeCompare(b.full_name);
  });

  const adminCount = players.filter((p) => p.role === 'admin' || p.role === 'super_admin').length;
  const availableGroupsForAdd = groups.filter((group) => group.environment === addForm.environment);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            placeholder="Search players..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-white border border-gray-200 text-gray-900 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <select
          value={skillFilter}
          onChange={(e) => setSkillFilter(e.target.value as any)}
          className="bg-white border border-gray-200 text-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
        >
          <option value="all">All Levels</option>
          {SKILL_LEVELS.map((level) => <option key={level} value={level}>{skillLevelLabel(level)}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as PlayerSort)}
          className="bg-white border border-gray-200 text-gray-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
          title="Sort players"
        >
          <option value="name_asc">Sort: Name A-Z</option>
          <option value="last_login_desc">Sort: Last login newest</option>
          <option value="last_login_asc">Sort: Last login oldest</option>
        </select>
        <button
          onClick={() => { setShowAdd(true); setAddError(''); }}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white text-sm px-4 py-2 rounded-xl transition-all font-medium"
        >
          <UserPlus className="w-4 h-4" /> Add Player
        </button>
        <button onClick={loadPlayers} className="text-gray-400 hover:text-gray-900 p-2">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {([
          { label: 'Total', count: players.length, color: 'text-gray-900' },
          { label: 'Admins', count: adminCount, color: 'text-blue-600' },
          ...SKILL_LEVELS.map((level) => ({
            label: skillLevelLabel(level),
            count: players.filter((p) => normalizeSkillLevel(p.skill_level) === level).length,
            color: skillLevelTextColor(level),
          })),
        ]).map((s) => (
          <div key={s.label} className="bg-white border border-gray-200 rounded-xl p-3 text-center">
            <p className={`text-xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-gray-400 text-xs mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Add player form */}
      {showAdd && (
        <div className="bg-white border border-emerald-300 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-gray-900 font-semibold flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-emerald-600" /> Add New Player
            </h3>
            <button onClick={() => setShowAdd(false)} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
          </div>
          {addError && (
            <div className="bg-red-50 border border-red-200 text-red-500 text-sm rounded-lg px-4 py-2 mb-3">{addError}</div>
          )}
          <form onSubmit={addPlayer} className="space-y-4">
            <div className="grid md:grid-cols-2 gap-3">
              <input placeholder="Full Name *" value={addForm.full_name} onChange={(e) => setAddForm((f) => ({ ...f, full_name: e.target.value }))} required className="bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
              <input placeholder="Phone" value={addForm.phone} onChange={(e) => setAddForm((f) => ({ ...f, phone: e.target.value }))} className="bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
              <input type="email" placeholder="Email *" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))} required className="bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
              <input type="password" placeholder="Password *" value={addForm.password} onChange={(e) => setAddForm((f) => ({ ...f, password: e.target.value }))} required className="bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
            </div>

            <div className="grid md:grid-cols-3 gap-3 items-end">
              <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-500">Player level</label>
              <div className="relative">
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                <select value={addForm.skill_level} onChange={(e) => setAddForm((f) => ({ ...f, skill_level: e.target.value as SkillLevel }))} className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 appearance-none">
                  {SKILL_LEVELS.map((level) => <option key={level} value={level}>{skillLevelLabel(level)}</option>)}
                </select>
              </div>
            </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500">Role</label>
                <div className="relative">
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <select value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value as 'player' | 'admin' }))} className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 appearance-none">
                    <option value="player">Player</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-gray-500">Environment</label>
                <div className="w-full bg-gray-50 border border-gray-200 text-gray-700 rounded-xl px-3 py-2 text-sm">
                  {addForm.environment === 'dev' ? 'Dev / Testing' : 'Production'}
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-3">
              <div className="flex items-center justify-between gap-3 mb-2">
                <label className="text-xs font-semibold text-gray-500">Groups</label>
                <span className="text-xs text-gray-400">{addForm.group_ids.length} selected</span>
              </div>
              {availableGroupsForAdd.length === 0 ? (
                <p className="text-xs text-gray-400">No {addForm.environment === 'dev' ? 'dev / testing' : 'production'} groups yet.</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableGroupsForAdd.map((group) => {
                    const selected = addForm.group_ids.includes(group.id);
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => toggleAddPlayerGroup(group.id)}
                        className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition-all ${
                          selected
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-white text-gray-500 hover:border-emerald-200 hover:text-emerald-700'
                        }`}
                      >
                        {group.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 border border-gray-100 px-3 py-2">
              <span className="text-xs font-semibold text-gray-400">Preview</span>
              <span className={`inline-flex text-xs px-2.5 py-1 rounded-lg border font-semibold ${skillLevelColor(addForm.skill_level)}`}>
                {skillLevelLabel(addForm.skill_level)}
              </span>
              <span className={`inline-flex text-xs px-2.5 py-1 rounded-lg font-semibold ${addForm.role === 'admin' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                {addForm.role === 'admin' ? 'Admin' : 'Player'}
              </span>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowAdd(false)} className="px-5 py-2 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">Cancel</button>
              <button type="submit" disabled={addLoading} className="sm:min-w-[220px] bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white px-5 py-2 rounded-xl text-sm font-semibold transition-all">
                {addLoading ? 'Creating...' : 'Create Player Account'}
              </button>
              </div>
          </form>
        </div>
      )}

      {/* Player table */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-12 text-center">
          <Users className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No players found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((player) => {
            const isEditing = editId === player.id;
            const isSelf = player.id === user?.id;
            return (
              <div key={player.id} className={`bg-white border rounded-2xl px-5 py-4 transition-all ${isEditing ? 'border-emerald-400' : 'border-gray-200'}`}>
                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid sm:grid-cols-4 gap-3 items-center">
                      <input value={editForm.full_name || ''} onChange={(e) => setEditForm((f) => ({ ...f, full_name: e.target.value }))} placeholder="Full name" className="bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                      <input value={editForm.phone || ''} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Phone" className="bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500" />
                      <div className="relative">
                        <select value={normalizeSkillLevel(editForm.skill_level)} onChange={(e) => setEditForm((f) => ({ ...f, skill_level: e.target.value as SkillLevel }))} className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 appearance-none">
                          {SKILL_LEVELS.map((level) => <option key={level} value={level}>{skillLevelLabel(level)}</option>)}
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => saveEdit(player.id)} className="flex-1 flex items-center justify-center gap-1 bg-emerald-500 hover:bg-emerald-400 text-white text-sm py-2 rounded-xl transition-all">
                          <Check className="w-3.5 h-3.5" /> Save
                        </button>
                        <button onClick={() => setEditId(null)} className="px-3 py-2 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-semibold text-sm flex-shrink-0">
                      {player.full_name?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-gray-900 font-medium">{player.full_name}</p>
                        {isSelf && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-md font-medium">You</span>}
                        {player.role === 'super_admin' && <span className="text-xs bg-rose-50 text-rose-600 border border-rose-200 px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1"><Crown className="w-3 h-3" />Super Admin</span>}
                        {player.role === 'admin' && <span className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-1.5 py-0.5 rounded-md font-medium">Admin</span>}
                        {player.environment === 'dev' && <span className="text-xs bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-md font-medium">Dev</span>}
                      </div>
                      <p className="text-gray-400 text-xs mt-0.5">
                        {player.phone || 'No phone'} <span className="mx-1 text-gray-300">·</span> {formatLastLogin(player.last_login_at)}
                      </p>
                    </div>
                    <span className={`hidden sm:inline-flex text-xs px-2.5 py-1 rounded-lg border font-medium ${skillLevelColor(player.skill_level)}`}>
                      {skillLevelLabel(player.skill_level)}
                    </span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => { setEditId(player.id); setEditForm({ full_name: player.full_name, skill_level: player.skill_level, phone: player.phone, role: player.role }); }} className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all" title="Edit name / phone / skill">
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => openEmailModal(player)} className="p-2 text-gray-400 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all" title="Change email address">
                        <Mail className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => openResetModal(player)} className="p-2 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all" title="Send password reset link">
                        <KeyRound className="w-3.5 h-3.5" />
                      </button>
                      {player.role !== 'super_admin' && (
                        <button
                          onClick={() => toggleRole(player)}
                          disabled={isSelf || !isSuperAdmin}
                          className={`p-2 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed ${player.role === 'admin' ? 'text-blue-600 hover:bg-blue-50' : 'text-gray-400 hover:text-blue-600 hover:bg-gray-100'}`}
                          title={!isSuperAdmin ? 'Only Super Admin can change roles' : player.role === 'admin' ? 'Revoke admin' : 'Make admin'}
                        >
                          {player.role === 'admin' ? <ShieldOff className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
                        </button>
                      )}
                      <button onClick={() => openDeleteModal(player)} disabled={isSelf} className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed" title="Remove player">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Change Email Modal */}
      {modal.type === 'email' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-900 font-semibold flex items-center gap-2">
                <Mail className="w-4 h-4 text-emerald-600" /> Change Email
              </h3>
              <button onClick={() => setModal({ type: 'none' })} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              Changing the email for <span className="font-medium text-gray-900">{modal.player.full_name}</span>. They will use this new address to log in.
            </p>
            {modalError && <div className="bg-red-50 border border-red-200 text-red-500 text-sm rounded-lg px-4 py-2 mb-3">{modalError}</div>}
            <input
              type="email"
              placeholder="New email address"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500 mb-4"
            />
            <div className="flex gap-2">
              <button onClick={handleUpdateEmail} disabled={modalLoading || !newEmail.includes('@')} className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition-all">
                {modalLoading ? 'Saving...' : 'Update Email'}
              </button>
              <button onClick={() => setModal({ type: 'none' })} className="px-4 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {modal.type === 'reset' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-gray-900 font-semibold flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-600" /> Send Password Reset
              </h3>
              <button onClick={() => setModal({ type: 'none' })} className="text-gray-400 hover:text-gray-900"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-gray-500 text-sm mb-4">
              Send a password reset link to <span className="font-medium text-gray-900">{modal.player.full_name}</span>. The link will let them choose a new password.
            </p>
            {modalError && <div className="bg-red-50 border border-red-200 text-red-500 text-sm rounded-lg px-4 py-2 mb-3">{modalError}</div>}
            <div className="flex gap-2">
              <button onClick={handleSendPasswordReset} disabled={modalLoading} className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition-all">
                {modalLoading ? 'Sending...' : 'Send Reset Link'}
              </button>
              <button onClick={() => setModal({ type: 'none' })} className="px-4 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {modal.type === 'delete' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-red-50 rounded-xl flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="text-gray-900 font-semibold">Remove Player</h3>
                <p className="text-gray-500 text-sm">This cannot be undone</p>
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-2">
              You are about to permanently remove <span className="font-semibold text-gray-900">{modal.player.full_name}</span>.
            </p>
            <ul className="text-sm text-gray-500 space-y-1 mb-4 list-disc list-inside bg-gray-50 rounded-xl p-3">
              <li>Their account and profile will be deleted</li>
              <li>They will be removed from all match rosters</li>
              <li>Match results and session history are preserved</li>
              <li>Their stats will be removed</li>
            </ul>
            {modalError && <div className="bg-red-50 border border-red-200 text-red-500 text-sm rounded-lg px-4 py-2 mb-3">{modalError}</div>}
            <div className="flex gap-2">
              <button onClick={handleDeletePlayer} disabled={modalLoading} className="flex-1 bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-semibold transition-all">
                {modalLoading ? 'Removing...' : 'Yes, Remove Player'}
              </button>
              <button onClick={() => setModal({ type: 'none' })} className="px-4 bg-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-300">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// -----------------------------------------------------------------------------

interface PollToken {
  id: string;
  player_id: string;
  token: string;
  used: boolean;
  response: 'yes' | 'no' | null;
  responded_at: string | null;
  profile?: Profile;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;

function buildPollLink(token: string, response: 'yes' | 'no') {
  return `${SUPABASE_URL}/functions/v1/poll-respond?token=${token}&r=${response}`;
}

function buildWhatsAppMessage(session: Session, playerName: string, yesLink: string, noLink: string) {
  const date = formatDate(session.session_date);
  const time = `${session.start_time.slice(0, 5)} - ${session.end_time.slice(0, 5)}`;
  return (
    `Hi ${playerName.split(' ')[0]}!\n\n` +
    `Are you available for *${session.title}*?\n` +
    `Date: ${date}  Time: ${time}  Venue: ${session.venue}\n\n` +
    `Tap to respond:\n` +
    `Yes, I'm in -> ${yesLink}\n` +
    `Can't make it -> ${noLink}`
  );
}
// -----------------------------------------------------------------------------

interface RankingEntry {
  player_id: string;
  wins: number;
  losses: number;
  total_matches: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  rating?: number;
  environment: string;
  profile: Profile;
}

function buildRankingEntriesFromMatches(matches: any[]): RankingEntry[] {
  const players = new Map<string, RankingEntry>();
  const ratings = calculatePlayerRatingsFromMatches(matches);

  for (const match of matches) {
    const environment = match.session?.environment || 'prod';
    for (const team of match.teams || []) {
      const didWin = match.winner_team === team.team_label;
      for (const teamPlayer of team.players || []) {
        const profile = teamPlayer.profile;
        if (!teamPlayer.player_id || !profile) continue;

        const key = `${environment}|${teamPlayer.player_id}`;
        const current = players.get(key) || {
          player_id: teamPlayer.player_id,
          wins: 0,
          losses: 0,
          total_matches: 0,
          pointsFor: 0,
          pointsAgainst: 0,
          pointDiff: 0,
          rating: ratings.get(teamPlayer.player_id),
          environment,
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
        players.set(key, current);
      }
    }
  }

  return [...players.values()];
}

function PlayerRankings({ envFilter }: { envFilter: EnvFilter }) {
  const [entries, setEntries] = useState<RankingEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [skillFilter, setSkillFilter] = useState<'all' | SkillLevel>('all');

  useEffect(() => {
    setLoading(true);
    let q = supabase
      .from('matches')
      .select(`winner_team, score_a, score_b, started_at, ended_at, session:sessions!inner(environment, counts_for_rankings), teams:match_teams(team_label, players:match_team_players(player_id, profile:profiles(*)))`)
      .eq('status', 'completed')
      .eq('session.counts_for_rankings', true);
    if (envFilter !== 'all') q = q.eq('session.environment', envFilter);
    q.then(({ data }) => {
      setEntries(buildRankingEntriesFromMatches((data as any[]) || []));
      setLoading(false);
    });
  }, [envFilter]);

  const filtered = entries
    .filter((e) => skillFilter === 'all' || normalizeSkillLevel(e.profile?.skill_level) === skillFilter)
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

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 items-center">
        <h2 className="text-gray-900 font-semibold flex items-center gap-2 flex-1">
          <BarChart2 className="w-4 h-4 text-emerald-600" /> Player Rankings
        </h2>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', ...SKILL_LEVELS] as Array<'all' | SkillLevel>).map((level) => {
            const inactiveClass = level === 'all'
              ? 'bg-white border-gray-200 text-gray-500 hover:text-gray-800'
              : `${skillLevelColor(level)} hover:brightness-95`;
            return (
              <button
                key={level}
                onClick={() => setSkillFilter(level)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  skillFilter === level ? 'bg-emerald-500 text-white border-emerald-500 shadow-sm' : inactiveClass
                }`}
              >
                {level === 'all' ? 'All Levels' : skillLevelLabel(level)}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 animate-pulse">
          {[...Array(5)].map((_, i) => <div key={i} className="h-16 bg-gray-200 rounded-xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center">
          <BarChart2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No stats recorded yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((entry, index) => {
            const winRate = entry.total_matches > 0
              ? Math.round((entry.wins / entry.total_matches) * 100)
              : 0;
            const rank = index + 1;
            return (
              <div key={`${entry.environment}-${entry.player_id}`} className="bg-white border border-gray-200 rounded-2xl px-5 py-4 flex items-center gap-4">
                <span className="text-gray-400 text-sm font-mono w-7 text-center flex-shrink-0">#{rank}</span>
                <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-semibold text-sm flex-shrink-0">
                  {entry.profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-900 font-medium truncate">{entry.profile?.full_name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${skillLevelColor(entry.profile?.skill_level)}`}>
                      {skillLevelLabel(entry.profile?.skill_level)}
                    </span>
                    {entry.profile?.role !== 'player' && (
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${entry.profile?.role === 'super_admin' ? 'bg-rose-50 text-rose-600' : 'bg-blue-50 text-blue-600'}`}>
                        {entry.profile?.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                      </span>
                    )}
                  </div>
                  <RatingProgress profile={entry.profile} totalMatches={entry.total_matches} rating={entry.rating} showReview />
                </div>
                <div className="flex items-center gap-5 text-sm flex-shrink-0">
                  <div className="text-center hidden sm:block">
                    <p className="text-emerald-600 font-bold">{entry.wins}</p>
                    <p className="text-gray-400 text-xs">W</p>
                  </div>
                  <div className="text-center hidden sm:block">
                    <p className="text-red-500 font-bold">{entry.losses}</p>
                    <p className="text-gray-400 text-xs">L</p>
                  </div>
                  <div className="text-center">
                    <p className={`font-bold ${winRate >= 60 ? 'text-emerald-600' : winRate >= 40 ? 'text-amber-600' : 'text-gray-500'}`}>
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
      )}
    </div>
  );
}
// -----------------------------------------------------------------------------

function WhatsAppPoll({ envFilter }: { envFilter: EnvFilter }) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Profile[]>([]);
  const [tokens, setTokens] = useState<PollToken[]>([]);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [loadingTokens, setLoadingTokens] = useState(false);

  useEffect(() => {
    let sessionsQuery = supabase
      .from('sessions')
      .select('*')
      .in('status', ['open', 'in_progress'])
      .order('session_date', { ascending: true });
    if (envFilter !== 'all') sessionsQuery = sessionsQuery.eq('environment', envFilter);
    sessionsQuery.then(({ data }) => {
      setSessions(data || []);
      setSelectedSession((current) =>
        current && (envFilter === 'all' || current.environment === envFilter) ? current : null
      );
      setTokens([]);
    });

    let playersQuery = supabase.from('profiles').select('*').order('full_name');
    if (envFilter !== 'all') playersQuery = playersQuery.eq('environment', envFilter);
    playersQuery.then(({ data }) => setPlayers(data || []));
  }, [envFilter]);

  async function selectSession(session: Session) {
    setSelectedSession(session);
    setLoadingTokens(true);
    const { data } = await supabase
      .from('availability_poll_tokens')
      .select('*, profile:profiles(*)')
      .eq('session_id', session.id);
    setTokens((data as PollToken[]) || []);
    setLoadingTokens(false);
  }

  async function generateTokens() {
    if (!selectedSession) return;
    setGenerating(true);
    const existingPlayerIds = new Set(tokens.map((t) => t.player_id));
    const missing = players.filter((p) => !existingPlayerIds.has(p.id));
    if (missing.length > 0) {
      const inserts = missing.map((p) => ({ session_id: selectedSession.id, player_id: p.id }));
      await supabase.from('availability_poll_tokens').insert(inserts);
    }
    // Reload
    const { data } = await supabase
      .from('availability_poll_tokens')
      .select('*, profile:profiles(*)')
      .eq('session_id', selectedSession.id);
    setTokens((data as PollToken[]) || []);
    setGenerating(false);
  }

  async function resetToken(tokenId: string) {
    await supabase
      .from('availability_poll_tokens')
      .update({ used: false, response: null, responded_at: null })
      .eq('id', tokenId);
    setTokens((prev) => prev.map((t) => t.id === tokenId ? { ...t, used: false, response: null, responded_at: null } : t));
  }

  function copyToClipboard(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  function openWhatsApp(phone: string, message: string) {
    const clean = phone.replace(/\D/g, '');
    const url = `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }

  const yes = tokens.filter((t) => t.response === 'yes');
  const no = tokens.filter((t) => t.response === 'no');
  const pending = tokens.filter((t) => !t.used);

  return (
    <div className="grid lg:grid-cols-5 gap-6">
      {/* Session selector */}
      <div className="lg:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-gray-900 font-semibold">Open Sessions</h2>
        </div>
        {sessions.length === 0 ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-8 text-center">
            <Calendar className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">No open sessions</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => selectSession(s)}
                className={`w-full text-left p-4 rounded-2xl border transition-all ${
                  selectedSession?.id === s.id
                    ? 'bg-green-50 border-green-400'
                    : 'bg-white border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <MessageCircle className={`w-4 h-4 flex-shrink-0 ${selectedSession?.id === s.id ? 'text-green-600' : 'text-gray-400'}`} />
                  <p className="text-gray-900 text-sm font-medium truncate">{s.title}</p>
                </div>
                <p className="text-gray-400 text-xs ml-6">{formatDate(s.session_date)} &middot; {s.start_time.slice(0,5)}-{s.end_time.slice(0,5)} &middot; {s.venue}</p>
              </button>
            ))}
          </div>
        )}

        {/* How it works */}
        <div className="bg-green-50 border border-green-100 rounded-2xl p-4 mt-2">
          <p className="text-green-800 text-xs font-semibold mb-2">How it works</p>
          <ol className="text-green-700 text-xs space-y-1.5 list-decimal list-inside">
            <li>Select an open session</li>
            <li>Generate unique links for all players</li>
            <li>Click Send on each player to open WhatsApp</li>
            <li>Player taps Yes / No - they're marked automatically</li>
          </ol>
        </div>
      </div>

      {/* Poll management */}
      <div className="lg:col-span-3">
        {!selectedSession ? (
          <div className="bg-white border border-dashed border-gray-200 rounded-2xl p-12 text-center h-full flex flex-col items-center justify-center">
            <MessageCircle className="w-10 h-10 text-gray-300 mb-3" />
            <p className="text-gray-400">Select a session to manage the poll</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h3 className="text-gray-900 font-semibold">{selectedSession.title}</h3>
                  <p className="text-gray-400 text-sm mt-0.5">{formatDate(selectedSession.session_date)} &middot; {selectedSession.venue}</p>
                </div>
                <button
                  onClick={generateTokens}
                  disabled={generating || players.length === 0}
                  className="flex items-center gap-2 bg-green-500 hover:bg-green-400 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm font-medium transition-all"
                >
                  {generating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {tokens.length === 0 ? 'Generate Links' : 'Refresh Links'}
                </button>
              </div>

              {tokens.length > 0 && (
                <div className="grid grid-cols-3 gap-3 mt-4">
                  <div className="bg-gray-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-gray-900">{tokens.length}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Total</p>
                  </div>
                  <div className="bg-green-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-green-600">{yes.length}</p>
                    <p className="text-xs text-green-600 mt-0.5">Available</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-3 text-center">
                    <p className="text-xl font-bold text-red-500">{no.length}</p>
                    <p className="text-xs text-red-500 mt-0.5">Unavailable</p>
                  </div>
                </div>
              )}
            </div>

            {/* No tokens yet */}
            {tokens.length === 0 && !loadingTokens && (
              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5 flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-amber-800 text-sm font-medium">No poll links generated yet</p>
                  <p className="text-amber-600 text-sm mt-0.5">Click "Generate Links" to create unique WhatsApp links for all {players.length} players.</p>
                </div>
              </div>
            )}

            {/* Player list */}
            {loadingTokens ? (
              <div className="space-y-2 animate-pulse">
                {[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl" />)}
              </div>
            ) : tokens.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                {/* Pending */}
                {pending.length > 0 && (
                  <div>
                    <div className="px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Awaiting Response ({pending.length})</p>
                    </div>
                    {pending.map((t) => {
                      const player = t.profile || players.find((p) => p.id === t.player_id);
                      if (!player) return null;
                      const yesLink = buildPollLink(t.token, 'yes');
                      const noLink = buildPollLink(t.token, 'no');
                      const message = buildWhatsAppMessage(selectedSession, player.full_name, yesLink, noLink);
                      const hasPhone = !!player.phone;
                      return (
                        <div key={t.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-50 last:border-0 hover:bg-gray-50 transition-colors">
                          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-600 text-sm font-semibold flex-shrink-0">
                            {player.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-900 text-sm font-medium truncate">{player.full_name}</p>
                            <p className="text-gray-400 text-xs">{player.phone || 'No phone number'}</p>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button
                              onClick={() => copyToClipboard(message, t.id)}
                              className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-all"
                              title="Copy message"
                            >
                              {copied === t.id ? <CheckCheck className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => hasPhone ? openWhatsApp(player.phone, message) : copyToClipboard(message, t.id + '-msg')}
                              disabled={!hasPhone}
                              className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg transition-all ${
                                hasPhone
                                  ? 'bg-green-500 hover:bg-green-400 text-white'
                                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              }`}
                              title={hasPhone ? 'Open in WhatsApp' : 'No phone number on file'}
                            >
                              <ExternalLink className="w-3 h-3" />
                              Send
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Responded Yes */}
                {yes.length > 0 && (
                  <div>
                    <div className="px-5 py-2.5 bg-green-50 border-b border-green-100">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Available ({yes.length})</p>
                    </div>
                    {yes.map((t) => {
                      const player = t.profile || players.find((p) => p.id === t.player_id);
                      if (!player) return null;
                      return (
                        <div key={t.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-50 last:border-0 bg-green-50/40">
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 text-sm font-semibold flex-shrink-0">
                            {player.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-900 text-sm font-medium truncate">{player.full_name}</p>
                            <p className="text-gray-400 text-xs">
                              Responded {t.responded_at ? new Date(t.responded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </p>
                          </div>
                          <span className="text-xs text-green-700 bg-green-100 px-2.5 py-1 rounded-lg font-medium flex-shrink-0">Available</span>
                          <button onClick={() => resetToken(t.id)} className="text-gray-300 hover:text-gray-500 text-xs transition-all ml-1 flex-shrink-0" title="Reset response">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Responded No */}
                {no.length > 0 && (
                  <div>
                    <div className="px-5 py-2.5 bg-red-50 border-b border-red-100">
                      <p className="text-xs font-semibold text-red-600 uppercase tracking-wide">Unavailable ({no.length})</p>
                    </div>
                    {no.map((t) => {
                      const player = t.profile || players.find((p) => p.id === t.player_id);
                      if (!player) return null;
                      return (
                        <div key={t.id} className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-50 last:border-0 bg-red-50/30">
                          <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center text-red-600 text-sm font-semibold flex-shrink-0">
                            {player.full_name.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-900 text-sm font-medium truncate">{player.full_name}</p>
                            <p className="text-gray-400 text-xs">
                              Responded {t.responded_at ? new Date(t.responded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                            </p>
                          </div>
                          <span className="text-xs text-red-600 bg-red-100 px-2.5 py-1 rounded-lg font-medium flex-shrink-0">Unavailable</span>
                          <button onClick={() => resetToken(t.id)} className="text-gray-300 hover:text-gray-500 text-xs transition-all ml-1 flex-shrink-0" title="Reset response">
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Refresh responses */}
            {tokens.length > 0 && (
              <button
                onClick={() => selectSession(selectedSession)}
                className="flex items-center gap-2 text-gray-400 hover:text-gray-700 text-sm transition-all"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Refresh responses
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function formatLastLogin(value?: string | null) {
  if (!value) return 'Last login: never';
  return `Last login: ${new Date(value).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}
// -----------------------------------------------------------------------------

function AppSettings() {
  const { appName, refreshAppName } = useAuth();
  const [name, setName] = useState(appName);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    await supabase
      .from('app_settings')
      .update({ value: name.trim(), updated_at: new Date().toISOString() })
      .eq('key', 'app_name');
    await refreshAppName();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="max-w-lg">
      <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
            <Settings className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-gray-900 font-semibold text-base">App Settings</h2>
            <p className="text-gray-500 text-sm">Customize how your app appears</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">App Name</label>
            <p className="text-xs text-gray-400 mb-2">This name appears in the sidebar and browser tab.</p>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              placeholder="e.g. Rally Master"
              className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all"
            />
          </div>

          <button
            onClick={save}
            disabled={saving || !name.trim() || name.trim() === appName}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all"
          >
            {saved ? (
              <><Check className="w-4 h-4" /> Saved!</>
            ) : saving ? (
              'Saving...'
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}


