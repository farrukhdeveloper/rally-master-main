import { useState, type ReactNode } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import Layout, { AdminSubPage, Page } from './components/Layout';
import Dashboard from './pages/Dashboard';
import SessionsPage from './pages/SessionsPage';
import CourtsPage from './pages/CourtsPage';
import LeaderboardPage from './pages/LeaderboardPage';
import AdminPage from './pages/AdminPage';
import HistoryPage from './pages/HistoryPage';
import MatchManager from './pages/MatchManager';
import HelpPage from './pages/HelpPage';
import ResetPasswordPage from './pages/ResetPasswordPage';
import RotationPlannerPage from './pages/RotationPlannerPage';
import GroupChallengesPage from './pages/GroupChallengesPage';
import ProfilePage from './pages/ProfilePage';
import { Environment } from './lib/supabase';
import { Feather } from 'lucide-react';

function AppContent() {
  const { user, loading, appName, isAdmin, passwordRecovery } = useAuth();
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [adminSubPage, setAdminSubPage] = useState<AdminSubPage>('sessions');
  const [playerEnvFilter, setPlayerEnvFilter] = useState<Environment>('prod');

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-emerald-500 rounded-2xl flex items-center justify-center animate-pulse">
            <Feather className="w-6 h-6 text-white" />
          </div>
          <p className="text-slate-400 text-sm">Loading {appName}...</p>
        </div>
      </div>
    );
  }

  if (!user) return <AuthPage />;
  if (passwordRecovery) return <ResetPasswordPage />;

  const pageEnvFilter: Environment = isAdmin ? playerEnvFilter : 'prod';

  function renderPage(page: Page): ReactNode {
    const pages: Record<Page, ReactNode> = {
      dashboard: <Dashboard envFilter={pageEnvFilter} />,
      sessions: <SessionsPage envFilter={pageEnvFilter} />,
      courts: <CourtsPage envFilter={pageEnvFilter} />,
      matches: <MatchManager envFilter={pageEnvFilter} />,
      planner: <RotationPlannerPage envFilter={pageEnvFilter} />,
      challenges: <GroupChallengesPage envFilter={pageEnvFilter} />,
      leaderboard: <LeaderboardPage envFilter={pageEnvFilter} />,
      history: <HistoryPage envFilter={pageEnvFilter} />,
      help: <HelpPage />,
      profile: <ProfilePage />,
      admin: <AdminPage tab={adminSubPage} />,
    };

    return pages[page];
  }

  return (
    <Layout
      currentPage={currentPage}
      onNavigate={setCurrentPage}
      adminSubPage={adminSubPage}
      onAdminSubPageChange={setAdminSubPage}
      playerEnvFilter={playerEnvFilter}
      onPlayerEnvFilterChange={setPlayerEnvFilter}
    >
      {renderPage(currentPage)}
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}


