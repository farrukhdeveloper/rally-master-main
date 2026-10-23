import { useEffect, useState } from 'react';
import { supabase, Session, PlayerMatchHistory, Environment, SessionInvite, InviteStatus, Profile } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { skillLevelColor, skillLevelLabel } from '../lib/skillLevels';
import { Calendar, CheckCircle, XCircle, Trophy, Target, Flame, Users, Send, Inbox, Crown, Medal, Sparkles } from 'lucide-react';

type SessionInviteWithDetails = SessionInvite & { session?: Session; profile?: Profile };
type DashboardStats = { wins: number; losses: number; total_matches: number };
type CommunityLeader = {
  playerId: string;
  name: string;
  skillLevel: string;
  wins: number;
  losses: number;
  played: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  winRate: number;
};
type GroupLeader = CommunityLeader & { groupId: string; groupName: string };
type OneOrMany<T> = T | T[] | null;
type CommunityMatch = {
  winner_team: 'A' | 'B' | null;
  score_a: number | null;
  score_b: number | null;
  session?: OneOrMany<{
    id: string;
    group_id: string | null;
    group?: OneOrMany<{ id: string; name: string }>;
  }>;
  teams?: Array<{
    team_label: 'A' | 'B';
    players?: Array<{ player_id: string; profile?: OneOrMany<Profile> }>;
  }>;
};

function isPendingPlayerRequest(invite?: SessionInvite | null) {
  if (!invite || invite.status !== 'pending') return false;
  return invite.kind === 'request' || (!invite.kind && invite.invited_by === invite.player_id);
}

function isPendingAdminInvite(invite?: SessionInvite | null) {
  if (!invite || invite.status !== 'pending') return false;
  return invite.kind === 'invite' || (!invite.kind && invite.invited_by !== invite.player_id);
}

export default function Dashboard({ envFilter = 'prod' }: { envFilter?: Environment }) {
  const { user, profile } = useAuth();
  const [upcomingSessions, setUpcomingSessions] = useState<Session[]>([]);
  const [myAvailability, setMyAvailability] = useState<Record<string, boolean>>({});
  const [myInvites, setMyInvites] = useState<Record<string, SessionInvite>>({});
  const [challengeRosterSessions, setChallengeRosterSessions] = useState<Set<string>>(new Set());
  const [joinRequests, setJoinRequests] = useState<SessionInviteWithDetails[]>([]);
  const [adminInvites, setAdminInvites] = useState<SessionInvite[]>([]);
  const [allPlayers, setAllPlayers] = useState<Profile[]>([]);
  const [sessionAvailability, setSessionAvailability] = useState<Record<string, Set<string>>>({});
  const [inviteSessionId, setInviteSessionId] = useState('');
  const [inviteSearch, setInviteSearch] = useState('');
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [communityLeaders, setCommunityLeaders] = useState<CommunityLeader[]>([]);
  const [groupLeaders, setGroupLeaders] = useState<GroupLeader[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    if (!user) return;
    loadDashboard();
  }, [user, profile?.role, envFilter]);

  function canManageSession(session: Session) {
    return (
      profile?.role === 'super_admin' ||
      session.created_by === user?.id ||
      session.group?.created_by === user?.id
    );
  }

  async function loadDashboard() {
    if (!user) return;
    setLoading(true);

    const sessionsRes = await supabase
      .from('sessions')
      .select('*, group:groups(*)')
      .eq('environment', envFilter)
      .eq('status', 'open')
      .order('session_date', { ascending: true });

    const sessions = (sessionsRes.data || []) as Session[];
    const managedSessionIds = new Set(sessions.filter((session) => session.session_type !== 'group_challenge' && canManageSession(session)).map((session) => session.id));

    const [availRes, invitesRes, historyRes, ownerAvailRes, ownerInvitesRes, playersRes, communityMatchesRes, rankedCompetitionsRes, challengeRosterRes] = await Promise.all([
      supabase
        .from('session_availability')
        .select('*')
        .eq('player_id', user.id),
      supabase
        .from('session_invites')
        .select('*')
        .eq('player_id', user.id),
      supabase
        .from('player_match_history')
        .select('*')
        .eq('player_id', user.id),
      managedSessionIds.size > 0
        ? supabase.from('session_availability').select('*')
        : Promise.resolve({ data: [] }),
      managedSessionIds.size > 0
        ? supabase.from('session_invites').select('*')
        : Promise.resolve({ data: [] }),
      managedSessionIds.size > 0
        ? supabase.from('profiles').select('*').order('full_name', { ascending: true })
        : Promise.resolve({ data: [] }),
      supabase
        .from('matches')
        .select('winner_team, score_a, score_b, session:sessions!inner(id, environment, group_id, counts_for_rankings, group:groups(id, name)), teams:match_teams(team_label, players:match_team_players(player_id, profile:profiles(*)))')
        .eq('status', 'completed')
        .eq('session.environment', envFilter)
        .eq('session.counts_for_rankings', true),
      supabase
        .from('competitions')
        .select('session_id, competition_groups(side, group_id, group:groups(id, name))')
        .eq('environment', envFilter)
        .eq('counts_for_rankings', true),
      supabase
        .from('competition_rosters')
        .select('competition:competitions!inner(session_id, environment)')
        .eq('player_id', user.id)
        .eq('competition.environment', envFilter),
    ]);

    setUpcomingSessions(sessions);
    const rosterSessions = new Set<string>();
    for (const row of (challengeRosterRes.data as unknown as Array<{ competition?: OneOrMany<{ session_id: string }> }>) || []) {
      const competition = Array.isArray(row.competition) ? row.competition[0] : row.competition;
      if (competition?.session_id) rosterSessions.add(competition.session_id);
    }
    setChallengeRosterSessions(rosterSessions);
    const firstManagedSession = sessions.find((session) => managedSessionIds.has(session.id));
    if (firstManagedSession && !managedSessionIds.has(inviteSessionId)) setInviteSessionId(firstManagedSession.id);

    const avMap: Record<string, boolean> = {};
    for (const a of availRes.data || []) avMap[a.session_id] = a.available;
    setMyAvailability(avMap);

    const inviteMap: Record<string, SessionInvite> = {};
    for (const invite of ((invitesRes.data as SessionInvite[]) || [])) inviteMap[invite.session_id] = invite;
    setMyInvites(inviteMap);

    if (managedSessionIds.size > 0) {
      const allInviteRows = (((ownerInvitesRes as { data?: SessionInvite[] }).data) || []).filter((invite) => managedSessionIds.has(invite.session_id));
      const availabilityRows = (((ownerAvailRes as { data?: { session_id: string; player_id: string; available: boolean }[] }).data) || [])
        .filter((row) => managedSessionIds.has(row.session_id) && row.available);

      const availabilityBySession: Record<string, Set<string>> = {};
      for (const row of availabilityRows) {
        if (!availabilityBySession[row.session_id]) availabilityBySession[row.session_id] = new Set<string>();
        availabilityBySession[row.session_id].add(row.player_id);
      }
      setSessionAvailability(availabilityBySession);
      setAdminInvites(allInviteRows);
      setAllPlayers((playersRes.data as Profile[]) || []);

      const requests = allInviteRows.filter((invite) => isPendingPlayerRequest(invite));
      const playerIds = Array.from(new Set(requests.map((invite) => invite.player_id)));
      const { data: profiles } = playerIds.length
        ? await supabase.from('profiles').select('*').in('id', playerIds)
        : { data: [] };

      const profileById = new Map(((profiles as Profile[]) || []).map((item) => [item.id, item]));
      const sessionById = new Map(sessions.filter((session) => managedSessionIds.has(session.id)).map((session) => [session.id, session]));
      setJoinRequests(requests.map((invite) => ({
        ...invite,
        profile: profileById.get(invite.player_id),
        session: sessionById.get(invite.session_id),
      })));
    } else {
      setJoinRequests([]);
      setAdminInvites([]);
      setAllPlayers([]);
      setSessionAvailability({});
    }

    const historyRows = (((historyRes as { data?: PlayerMatchHistory[] }).data) || [])
      .filter((row) => row.environment === envFilter);
    setStats({
      wins: historyRows.filter((row) => row.result === 'win').length,
      losses: historyRows.filter((row) => row.result === 'loss').length,
      total_matches: historyRows.length,
    });
    const challengeGroupsBySession = new Map<string, Partial<Record<'A' | 'B', { id: string; name: string }>>>();
    for (const competition of (rankedCompetitionsRes.data as any[]) || []) {
      const challengeGroups: Partial<Record<'A' | 'B', { id: string; name: string }>> = {};
      for (const entry of competition.competition_groups || []) {
        const group = Array.isArray(entry.group) ? entry.group[0] : entry.group;
        const side = entry.side as 'A' | 'B' | undefined;
        if ((side === 'A' || side === 'B') && group?.id && group?.name) {
          challengeGroups[side] = { id: group.id, name: group.name };
        }
      }
      if (competition.session_id && (challengeGroups.A || challengeGroups.B)) {
        challengeGroupsBySession.set(competition.session_id, challengeGroups);
      }
    }

    const spotlight = buildCommunitySpotlight(
      (communityMatchesRes.data as unknown as CommunityMatch[]) || [],
      challengeGroupsBySession,
    );
    setCommunityLeaders(spotlight.leaders);
    setGroupLeaders(spotlight.groupLeaders);
    setLoading(false);
  }

  async function setAvailabilityForPlayer(sessionId: string, playerId: string, available: boolean) {
    const { data: existing } = await supabase
      .from('session_availability')
      .select('id')
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
      .maybeSingle();

    if (existing) {
      await supabase
        .from('session_availability')
        .update({ available, responded_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await supabase
        .from('session_availability')
        .insert({ session_id: sessionId, player_id: playerId, available });
    }
  }

  async function leaveSession(sessionId: string) {
    if (!user) return;
    setActionLoading(true);
    await setAvailabilityForPlayer(sessionId, user.id, false);
    setMyAvailability((prev) => ({ ...prev, [sessionId]: false }));
    setActionLoading(false);
  }

  async function requestSessionInvite(session: Session) {
    if (!user) return;
    setActionError('');
    setActionLoading(true);

    const requestOwnerId = session.group?.created_by || session.created_by || user.id;

    const { data: existing } = await supabase
      .from('session_invites')
      .select('id')
      .eq('session_id', session.id)
      .eq('player_id', user.id)
      .maybeSingle();

    const result = existing
      ? await supabase
        .from('session_invites')
        .update({ status: 'pending', invited_by: requestOwnerId, kind: 'request' })
        .eq('id', existing.id)
      : await supabase
        .from('session_invites')
        .insert({
          session_id: session.id,
          player_id: user.id,
          invited_by: requestOwnerId,
          status: 'pending',
          kind: 'request',
        });

    if (result.error) {
      setActionError(result.error.message || 'Could not send request. Please try again.');
      setActionLoading(false);
      return;
    }

    setMyInvites((prev) => ({
      ...prev,
      [session.id]: {
        id: existing?.id || `pending-${session.id}-${user.id}`,
        session_id: session.id,
        player_id: user.id,
        invited_by: requestOwnerId,
        status: 'pending',
        kind: 'request',
        created_at: new Date().toISOString(),
      },
    }));
    setActionLoading(false);
  }

  async function respondToInvite(invite: SessionInvite, status: InviteStatus) {
    setActionError('');
    setActionLoading(true);

    const { error } = await supabase
      .from('session_invites')
      .update({ status })
      .eq('id', invite.id);

    if (error) {
      setActionError(error.message || 'Could not update invite.');
      setActionLoading(false);
      return;
    }

    if (status === 'accepted') {
      await setAvailabilityForPlayer(invite.session_id, invite.player_id, true);
      if (invite.player_id === user?.id) {
        setMyAvailability((prev) => ({ ...prev, [invite.session_id]: true }));
      }
    }

    if (invite.player_id === user?.id) {
      setMyInvites((prev) => ({ ...prev, [invite.session_id]: { ...invite, status } }));
    }

    setJoinRequests((prev) => prev.filter((request) => request.id !== invite.id));
    setActionLoading(false);
  }

  async function invitePlayer(sessionId: string, playerId: string) {
    if (!user) return;
    setActionError('');
    setActionLoading(true);

    const { data: existing } = await supabase
      .from('session_invites')
      .select('id')
      .eq('session_id', sessionId)
      .eq('player_id', playerId)
      .maybeSingle();

    const result = existing
      ? await supabase
        .from('session_invites')
        .update({ status: 'pending', invited_by: user.id, kind: 'invite' })
        .eq('id', existing.id)
      : await supabase
        .from('session_invites')
        .insert({
          session_id: sessionId,
          player_id: playerId,
          invited_by: user.id,
          status: 'pending',
          kind: 'invite',
        });

    if (result.error) {
      setActionError(result.error.message || 'Could not invite player.');
      setActionLoading(false);
      return;
    }

    setAdminInvites((prev) => [
      {
        id: existing?.id || `pending-${sessionId}-${playerId}`,
        session_id: sessionId,
        player_id: playerId,
        invited_by: user.id,
        status: 'pending',
        kind: 'invite',
        created_at: new Date().toISOString(),
      },
      ...prev.filter((invite) => !(invite.session_id === sessionId && invite.player_id === playerId)),
    ]);
    setActionLoading(false);
  }

  const winRate = stats && stats.total_matches > 0
    ? Math.round((stats.wins / stats.total_matches) * 100)
    : 0;
  const ownedSessions = upcomingSessions.filter((session) => session.session_type !== 'group_challenge' && canManageSession(session));

  if (loading) return <LoadingState />;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          Welcome back, {profile?.full_name?.split(' ')[0] || 'Player'}
        </h1>
        <p className="text-gray-500 mt-1">Your session actions, invites, and badminton stats.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<Trophy className="w-5 h-5 text-amber-600" />} label="Wins" value={stats?.wins ?? 0} color="amber" />
        <StatCard icon={<XCircle className="w-5 h-5 text-red-500" />} label="Losses" value={stats?.losses ?? 0} color="red" />
        <StatCard icon={<Target className="w-5 h-5 text-sky-600" />} label="Win Rate" value={`${winRate}%`} color="sky" />
        <StatCard icon={<Flame className="w-5 h-5 text-orange-600" />} label="Matches" value={stats?.total_matches ?? 0} color="orange" />
      </div>

      <CommunitySpotlight
        leaders={communityLeaders}
        groupLeaders={groupLeaders}
        currentPlayerId={user?.id}
        environment={envFilter}
      />

      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-600 rounded-2xl px-4 py-3 text-sm font-medium mb-4">
          {actionError}
        </div>
      )}

      {ownedSessions.length > 0 && (
        <div className="grid lg:grid-cols-2 gap-4 mb-6">
          <AdminRequestsPanel requests={joinRequests} loading={actionLoading} onRespond={respondToInvite} />
          <AdminInvitePanel
            sessions={ownedSessions}
            players={allPlayers}
            invites={adminInvites}
            availableBySession={sessionAvailability}
            selectedSessionId={inviteSessionId}
            search={inviteSearch}
            loading={actionLoading}
            onSelectSession={setInviteSessionId}
            onSearch={setInviteSearch}
            onInvite={invitePlayer}
          />
        </div>
      )}

      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Calendar className="w-5 h-5 text-emerald-600" />
          Upcoming Sessions
        </h2>

        {upcomingSessions.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
            <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-3" />
            <p className="text-gray-500">No upcoming sessions. Check back later!</p>
          </div>
        ) : (
          <div className="space-y-3">
            {upcomingSessions.map((session) => (
              (() => {
                const isSessionOwner = canManageSession(session);
                return (
              <div
                key={session.id}
                className="bg-white border border-gray-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-gray-900 font-semibold">{session.title}</h3>
                    <StatusBadge status={session.status} />
                  </div>
                  <p className="text-gray-500 text-sm">
                    {formatDate(session.session_date)} &middot; {session.start_time.slice(0, 5)} - {session.end_time.slice(0, 5)}
                  </p>
                  <p className="text-gray-400 text-sm">{session.venue}</p>
                </div>

                {isSessionOwner ? (
                  <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-sky-50 text-sky-700 border border-sky-200">
                    <Users className="w-4 h-4" /> Session owner
                  </div>
                ) : session.session_type === 'group_challenge' ? (
                  <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold border ${challengeRosterSessions.has(session.id) ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                    <Users className="w-4 h-4" /> {challengeRosterSessions.has(session.id) ? "You're on the challenge roster" : 'Challenge roster is set'}
                  </div>
                ) : (
                  <SessionActionButtons
                    session={session}
                    available={myAvailability[session.id]}
                    invite={myInvites[session.id]}
                    loading={actionLoading}
                    onRequest={requestSessionInvite}
                    onRespond={respondToInvite}
                    onLeave={() => leaveSession(session.id)}
                  />
                )}
              </div>
                );
              })()
            ))}
          </div>
        )}
      </div>

      <div className="mt-8 bg-white border border-gray-200 rounded-2xl p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 font-bold text-lg">
            {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
          </div>
          <div>
            <p className="text-gray-900 font-semibold">{profile?.full_name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Users className="w-3.5 h-3.5 text-gray-400" />
              <span className={`text-xs px-2 py-1 rounded-lg border font-semibold ${skillLevelColor(profile?.skill_level)}`}>
                {skillLevelLabel(profile?.skill_level)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CommunitySpotlight({
  leaders,
  groupLeaders,
  currentPlayerId,
  environment,
}: {
  leaders: CommunityLeader[];
  groupLeaders: GroupLeader[];
  currentPlayerId?: string;
  environment: Environment;
}) {
  const playerIndex = leaders.findIndex((entry) => entry.playerId === currentPlayerId);
  const playerEntry = playerIndex >= 0 ? leaders[playerIndex] : null;
  const topPlayers = leaders.slice(0, 5);
  const environmentLabel = environment === 'prod' ? 'production' : 'dev/testing';

  return (
    <section className="mb-8">
      <div className="flex items-end justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-emerald-600" /> Community Spotlight
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Standings across all {environmentLabel} groups.</p>
        </div>
        {leaders.length > 0 && <span className="text-xs text-gray-400">{leaders.length} ranked players</span>}
      </div>

      {leaders.length === 0 ? (
        <div className="bg-white border border-gray-200 border-dashed rounded-2xl p-6 text-center">
          <Trophy className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-700 text-sm font-semibold">The spotlight is ready</p>
          <p className="text-gray-400 text-xs mt-1">Completed matches will reveal top players and group leaders here.</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
          <div className="grid lg:grid-cols-[0.9fr_1.6fr]">
            <div className="p-4 bg-emerald-50 border-b lg:border-b-0 lg:border-r border-emerald-100">
              <p className="text-xs font-semibold uppercase text-emerald-700">Your standing</p>
              {playerEntry ? (
                <div className="flex items-center gap-3 mt-3">
                  <div className="w-14 h-14 rounded-xl bg-white border border-emerald-200 flex items-center justify-center text-xl font-bold text-emerald-700 flex-shrink-0">
                    #{playerIndex + 1}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-gray-900 break-words">{playerEntry.name}</p>
                    <p className="text-sm text-gray-600 mt-0.5">
                      {playerEntry.wins}W {playerEntry.losses}L | {playerEntry.winRate}%
                    </p>
                    <span className={`inline-flex mt-1 text-xs px-2 py-0.5 rounded-lg border font-semibold ${skillLevelColor(playerEntry.skillLevel)}`}>
                      {skillLevelLabel(playerEntry.skillLevel)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <p className="font-semibold text-gray-900">Your ranking starts with your first result.</p>
                  <p className="text-xs text-gray-500 mt-1">Play a completed match to join the community table.</p>
                </div>
              )}
            </div>

            <div className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-xs font-semibold uppercase text-gray-500">Top performers</p>
                <p className="text-[10px] text-gray-400">Wins, win rate, then point diff</p>
              </div>
              <div className="divide-y divide-gray-100">
                {topPlayers.map((entry, index) => (
                  <div key={entry.playerId} className="grid grid-cols-[28px_minmax(0,1fr)_52px_48px] items-center gap-2 py-2 min-h-[42px]">
                    <div className="text-center">
                      {index === 0 ? (
                        <Crown className="w-4 h-4 text-amber-500 mx-auto" />
                      ) : index < 3 ? (
                        <Medal className={`w-4 h-4 mx-auto ${index === 1 ? 'text-gray-400' : 'text-orange-500'}`} />
                      ) : (
                        <span className="text-xs font-bold text-gray-400">#{index + 1}</span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 leading-tight break-words">{entry.name}</p>
                      <p className="text-[10px] text-gray-400">{skillLevelLabel(entry.skillLevel)} | {entry.played} played</p>
                    </div>
                    <div className="text-center tabular-nums">
                      <p className="text-sm font-bold text-emerald-600">{entry.wins}W</p>
                      <p className="text-[10px] text-gray-400">{entry.winRate}%</p>
                    </div>
                    <p className={`text-xs font-bold text-right tabular-nums ${entry.pointDiff >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                      {entry.pointDiff > 0 ? '+' : ''}{entry.pointDiff}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {groupLeaders.length > 0 && (
            <div className="border-t border-gray-100 px-4 py-3">
              <p className="text-xs font-semibold uppercase text-gray-500 mb-2">Group leaders</p>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {groupLeaders.slice(0, 6).map((entry) => (
                  <div key={entry.groupId} className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 min-w-0">
                    <p className="text-[10px] font-semibold text-emerald-700 break-words">{entry.groupName}</p>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <p className="text-sm font-semibold text-gray-900 break-words min-w-0">{entry.name}</p>
                      <span className="text-xs font-bold text-emerald-600 flex-shrink-0">{entry.wins}W</span>
                    </div>
                  </div>
                ))}
              </div>
              {groupLeaders.length > 6 && (
                <p className="text-[10px] text-gray-400 mt-2">Plus {groupLeaders.length - 6} more group leaders on the Leaderboard page.</p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function buildCommunitySpotlight(
  matches: CommunityMatch[],
  challengeGroupsBySession = new Map<string, Partial<Record<'A' | 'B', { id: string; name: string }>>>(),
) {
  const allPlayers = new Map<string, CommunityLeader>();
  const playersByGroup = new Map<string, { groupName: string; players: Map<string, CommunityLeader> }>();

  const updatePlayer = (
    target: Map<string, CommunityLeader>,
    playerId: string,
    profile: Profile,
    won: boolean,
    hasResult: boolean,
    pointsFor: number,
    pointsAgainst: number,
  ) => {
    const current = target.get(playerId) || {
      playerId,
      name: profile.full_name || 'Unknown player',
      skillLevel: profile.skill_level || 'level_5',
      wins: 0,
      losses: 0,
      played: 0,
      pointsFor: 0,
      pointsAgainst: 0,
      pointDiff: 0,
      winRate: 0,
    };

    current.played += 1;
    current.pointsFor += pointsFor;
    current.pointsAgainst += pointsAgainst;
    if (hasResult) {
      if (won) current.wins += 1;
      else current.losses += 1;
    }
    current.pointDiff = current.pointsFor - current.pointsAgainst;
    current.winRate = current.played > 0 ? Math.round((current.wins / current.played) * 100) : 0;
    current.name = profile.full_name || current.name;
    current.skillLevel = profile.skill_level || current.skillLevel;
    target.set(playerId, current);
  };

  const firstRelation = <T,>(value?: OneOrMany<T>): T | null => {
    if (!value) return null;
    return Array.isArray(value) ? value[0] || null : value;
  };

  for (const match of matches) {
    const session = firstRelation(match.session);
    const group = firstRelation(session?.group);
    const challengeGroups = session?.id ? challengeGroupsBySession.get(session.id) : undefined;
    const normalGroup = !challengeGroups && (session?.group_id || group?.id) && group?.name
      ? { id: session?.group_id || group.id, name: group.name }
      : null;

    for (const team of match.teams || []) {
      const matchGroup = challengeGroups?.[team.team_label] || normalGroup;
      let groupPlayers: Map<string, CommunityLeader> | null = null;
      if (matchGroup) {
        if (!playersByGroup.has(matchGroup.id)) {
          playersByGroup.set(matchGroup.id, { groupName: matchGroup.name, players: new Map<string, CommunityLeader>() });
        }
        groupPlayers = playersByGroup.get(matchGroup.id)!.players;
      }
      const hasResult = match.winner_team === 'A' || match.winner_team === 'B';
      const won = hasResult && match.winner_team === team.team_label;
      const pointsFor = Number(team.team_label === 'A' ? match.score_a : match.score_b) || 0;
      const pointsAgainst = Number(team.team_label === 'A' ? match.score_b : match.score_a) || 0;

      for (const player of team.players || []) {
        const playerProfile = firstRelation(player.profile);
        if (!player.player_id || !playerProfile) continue;
        updatePlayer(allPlayers, player.player_id, playerProfile, won, hasResult, pointsFor, pointsAgainst);
        if (groupPlayers) {
          updatePlayer(groupPlayers, player.player_id, playerProfile, won, hasResult, pointsFor, pointsAgainst);
        }
      }
    }
  }

  const rankPlayers = (entries: CommunityLeader[]) => [...entries].sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.pointDiff !== a.pointDiff) return b.pointDiff - a.pointDiff;
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor;
    if (b.played !== a.played) return b.played - a.played;
    return a.name.localeCompare(b.name);
  });

  const leaders = rankPlayers([...allPlayers.values()]);
  const groupLeaders = [...playersByGroup.entries()]
    .map(([groupId, groupData]) => {
      const leader = rankPlayers([...groupData.players.values()])[0];
      return leader ? { ...leader, groupId, groupName: groupData.groupName } : null;
    })
    .filter((entry): entry is GroupLeader => entry !== null)
    .sort((a, b) => a.groupName.localeCompare(b.groupName));

  return { leaders, groupLeaders };
}

function AdminRequestsPanel({
  requests,
  loading,
  onRespond,
}: {
  requests: SessionInviteWithDetails[];
  loading: boolean;
  onRespond: (invite: SessionInviteWithDetails, status: InviteStatus) => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 mb-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Inbox className="w-5 h-5 text-amber-600" />
        Join Requests ({requests.length})
      </h2>
      {requests.length === 0 ? (
        <p className="text-gray-400 text-sm">No pending player requests.</p>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => (
            <div key={request.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-2xl bg-amber-50 border border-amber-100">
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm font-semibold truncate">{request.profile?.full_name || 'Unknown player'}</p>
                <p className="text-gray-500 text-xs truncate">{request.session?.title || 'Session'} &middot; {request.session ? formatDate(request.session.session_date) : ''}</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => onRespond(request, 'accepted')}
                  disabled={loading}
                  className="flex-1 sm:flex-none bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white px-3 py-2 rounded-xl text-xs font-semibold"
                >
                  Approve
                </button>
                <button
                  onClick={() => onRespond(request, 'declined')}
                  disabled={loading}
                  className="flex-1 sm:flex-none bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-600 px-3 py-2 rounded-xl text-xs font-semibold"
                >
                  Decline
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AdminInvitePanel({
  sessions,
  players,
  invites,
  availableBySession,
  selectedSessionId,
  search,
  loading,
  onSelectSession,
  onSearch,
  onInvite,
}: {
  sessions: Session[];
  players: Profile[];
  invites: SessionInvite[];
  availableBySession: Record<string, Set<string>>;
  selectedSessionId: string;
  search: string;
  loading: boolean;
  onSelectSession: (sessionId: string) => void;
  onSearch: (value: string) => void;
  onInvite: (sessionId: string, playerId: string) => void;
}) {
  const availableIds = availableBySession[selectedSessionId] || new Set<string>();
  const term = search.trim().toLowerCase();
  const candidates = players.filter((player) => {
    if (availableIds.has(player.id)) return false;
    if (!term) return true;
    return (
      player.full_name.toLowerCase().includes(term) ||
      player.phone?.toLowerCase().includes(term) ||
      skillLevelLabel(player.skill_level).toLowerCase().includes(term)
    );
  });

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5">
      <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <Users className="w-5 h-5 text-emerald-600" />
        Invite Players
      </h2>

      {sessions.length === 0 ? (
        <p className="text-gray-400 text-sm">No open sessions available for invites.</p>
      ) : (
        <div className="space-y-3">
          <select
            value={selectedSessionId}
            onChange={(e) => onSelectSession(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 text-gray-900 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title} - {formatDate(session.session_date)}
              </option>
            ))}
          </select>

          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search players, phone, or skill..."
            className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
          />

          {candidates.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-6">No players available to invite.</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {candidates.map((player) => {
                const invite = invites.find((item) => item.session_id === selectedSessionId && item.player_id === player.id);
                const isPendingInvite = isPendingAdminInvite(invite);
                const isPendingRequest = isPendingPlayerRequest(invite);
                return (
                  <div key={player.id} className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50">
                    <div className="w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600 text-sm font-bold flex-shrink-0">
                      {player.full_name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-gray-900 text-sm font-semibold truncate">{player.full_name}</p>
                      <span className={`inline-flex text-xs px-2 py-0.5 rounded-lg border font-semibold ${skillLevelColor(player.skill_level)}`}>
                        {skillLevelLabel(player.skill_level)}
                      </span>
                    </div>
                    <button
                      onClick={() => onInvite(selectedSessionId, player.id)}
                      disabled={loading || isPendingInvite || isPendingRequest}
                      className="bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-xl text-xs font-semibold"
                    >
                      {isPendingInvite ? 'Invited' : isPendingRequest ? 'Requested' : invite?.status === 'declined' ? 'Invite again' : 'Invite'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionActionButtons({
  session,
  available,
  invite,
  loading,
  onRequest,
  onRespond,
  onLeave,
}: {
  session: Session;
  available: boolean | undefined;
  invite?: SessionInvite;
  loading: boolean;
  onRequest: (session: Session) => void;
  onRespond: (invite: SessionInvite, status: InviteStatus) => void;
  onLeave: () => void;
}) {
  const isAdminInvite = isPendingAdminInvite(invite);
  const isPlayerRequest = isPendingPlayerRequest(invite);

  if (available === true) {
    return (
      <div className="flex flex-col items-start sm:items-end gap-2">
        <span className="flex items-center gap-1.5 text-emerald-600 text-sm font-semibold">
          <CheckCircle className="w-4 h-4" /> You're in
        </span>
        <button
          onClick={onLeave}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-500 hover:text-red-500 hover:bg-red-50 border border-gray-200 disabled:opacity-50"
        >
          <XCircle className="w-3.5 h-3.5" /> Leave
        </button>
      </div>
    );
  }

  if (isAdminInvite && invite) {
    return (
      <div className="flex flex-col items-start sm:items-end gap-2">
        <p className="text-xs text-emerald-600 font-semibold">You have been invited</p>
        <div className="flex gap-2">
          <button
            onClick={() => onRespond(invite, 'accepted')}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50"
          >
            <CheckCircle className="w-3.5 h-3.5" /> Accept
          </button>
          <button
            onClick={() => onRespond(invite, 'declined')}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
          >
            <XCircle className="w-3.5 h-3.5" /> Decline
          </button>
        </div>
      </div>
    );
  }

  if (isPlayerRequest) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-amber-50 text-amber-700 border border-amber-200">
        <Send className="w-4 h-4" /> Request sent
      </div>
    );
  }

  if (invite?.status === 'declined') {
    return (
      <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-semibold bg-gray-100 text-gray-500 border border-gray-200">
        <XCircle className="w-4 h-4" /> Declined
      </div>
    );
  }

  return (
    <button
      onClick={() => onRequest(session)}
      disabled={loading}
      className="flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50"
    >
      <Send className="w-4 h-4" /> Request to play
    </button>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  const bg: Record<string, string> = {
    amber: 'bg-amber-50 border-amber-200',
    red: 'bg-red-50 border-red-200',
    sky: 'bg-sky-50 border-sky-200',
    orange: 'bg-orange-50 border-orange-200',
  };
  return (
    <div className={`${bg[color]} border rounded-2xl p-4`}>
      <div className="flex items-center gap-2 mb-2">{icon}<span className="text-gray-500 text-xs">{label}</span></div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
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
    in_progress: 'In Progress',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles[status] || styles.open}`}>
      {labels[status] || status}
    </span>
  );
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  });
}

function LoadingState() {
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-gray-200 rounded-xl w-64" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-200 rounded-2xl" />
          ))}
        </div>
        <div className="h-40 bg-gray-200 rounded-2xl" />
      </div>
    </div>
  );
}
