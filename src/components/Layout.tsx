import { ReactNode, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Environment } from '../lib/supabase';
import { skillLevelColor, skillLevelLabel } from '../lib/skillLevels';
import {
  Feather, LayoutDashboard, Calendar, Monitor, BarChart2, PlayCircle,
  LogOut, Menu, X, Shield, ChevronRight, History, HelpCircle, Shuffle, Swords
} from 'lucide-react';

export type Page = 'dashboard' | 'sessions' | 'courts' | 'matches' | 'planner' | 'challenges' | 'leaderboard' | 'admin' | 'history' | 'help';
export type AdminSubPage = 'sessions' | 'groups' | 'players' | 'rankings' | 'whatsapp' | 'settings';

interface LayoutProps {
  children: ReactNode;
  currentPage: Page;
  onNavigate: (page: Page) => void;
  adminSubPage: AdminSubPage;
  onAdminSubPageChange: (page: AdminSubPage) => void;
  playerEnvFilter: Environment;
  onPlayerEnvFilterChange: (env: Environment) => void;
}

const NAV_ITEMS: { id: Page; label: string; icon: React.FC<any>; adminOnly?: boolean; playerOnly?: boolean }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'sessions', label: 'Sessions', icon: Calendar },
  { id: 'courts', label: 'Live Courts', icon: Monitor },
  { id: 'matches', label: 'Match Management', icon: PlayCircle },
  { id: 'planner', label: 'Rotation Planner', icon: Shuffle },
  { id: 'challenges', label: 'Group Challenges', icon: Swords },
  { id: 'leaderboard', label: 'Leaderboard', icon: BarChart2 },
  { id: 'history', label: 'My History', icon: History },
  { id: 'help', label: 'Help & Features', icon: HelpCircle },
  { id: 'admin', label: 'Admin Panel', icon: Shield, adminOnly: true },
];

const ADMIN_SUB_ITEMS: { id: AdminSubPage; label: string }[] = [
  { id: 'sessions', label: 'Sessions & Courts' },
  { id: 'groups', label: 'Groups' },
  { id: 'players', label: 'Players' },
  { id: 'rankings', label: 'Player Rankings' },
  { id: 'whatsapp', label: 'WhatsApp Poll' },
  { id: 'settings', label: 'Settings' },
];

const ROLE_BADGE: Record<string, string> = {
  super_admin: 'bg-rose-50 text-rose-600',
  admin: 'bg-blue-50 text-blue-600',
  player: '',
};

const ROLE_LABEL: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  player: '',
};

export default function Layout({ children, currentPage, onNavigate, adminSubPage, onAdminSubPageChange, playerEnvFilter, onPlayerEnvFilterChange }: LayoutProps) {
  const { profile, isAdmin, signOut, appName } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || isAdmin
  );

  return (
    <div className="min-h-screen bg-gray-50 flex overflow-x-hidden">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed md:static inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-300 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        }`}
      >
        {/* Logo */}
        <div className="h-16 flex items-center px-5 border-b border-gray-200 gap-3">
          <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center shadow-lg shadow-emerald-500/30">
            <Feather className="w-4 h-4 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-gray-900 font-bold text-lg tracking-tight">{appName}</span>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto md:hidden text-gray-500 hover:text-gray-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ id, label, icon: Icon }) => {
            const active = currentPage === id;
            return (
              <div key={id}>
                <button
                  onClick={() => { onNavigate(id); if (id !== 'admin') setSidebarOpen(false); }}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group ${
                    active
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100'
                  }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                  {active && <ChevronRight className="w-3 h-3 ml-auto opacity-60" />}
                </button>
                {id === 'admin' && active && (
                  <div className="ml-7 mt-1 space-y-0.5 border-l border-emerald-100 pl-2">
                    {ADMIN_SUB_ITEMS.map((sub) => (
                      <button
                        key={sub.id}
                        onClick={() => {
                          onNavigate('admin');
                          onAdminSubPageChange(sub.id);
                          setSidebarOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                          adminSubPage === sub.id
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'text-gray-400 hover:text-gray-800 hover:bg-gray-50'
                        }`}
                      >
                        {sub.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Profile */}
        <div className="p-4 border-t border-gray-200">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 bg-emerald-50 rounded-full flex items-center justify-center text-emerald-600 font-semibold text-sm">
              {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-gray-900 text-sm font-medium truncate">{profile?.full_name || 'Player'}</p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className={`text-xs px-1.5 py-0.5 rounded-md border font-medium ${skillLevelColor(profile?.skill_level)}`}>
                  {skillLevelLabel(profile?.skill_level)}
                </span>
                {profile?.role && profile.role !== 'player' && (
                  <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${ROLE_BADGE[profile.role]}`}>
                    {ROLE_LABEL[profile.role]}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={signOut}
            className="w-full flex items-center gap-2 text-gray-500 hover:text-red-500 text-sm px-3 py-2 rounded-lg hover:bg-red-50 transition-all"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Topbar (mobile) */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center px-4 md:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-500 hover:text-gray-900 mr-3"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center">
            <Feather className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </div>
          <span className="text-gray-900 font-bold ml-2">{appName}</span>
        </header>

        <main className="flex-1 overflow-y-auto overflow-x-hidden bg-gray-50">
          {isAdmin && currentPage !== 'admin' && (
            <div className="px-4 sm:px-6 pt-4 flex justify-end">
              <label className="flex items-center gap-2 bg-white border border-gray-200 rounded-2xl px-3 py-2 shadow-sm">
                <span className="text-xs font-semibold text-gray-400">Environment</span>
                <select
                  value={playerEnvFilter}
                  onChange={(e) => onPlayerEnvFilterChange(e.target.value as Environment)}
                  className="bg-transparent text-gray-900 text-sm font-medium focus:outline-none"
                >
                  <option value="prod">Production</option>
                  <option value="dev">Dev / Testing</option>
                </select>
              </label>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}


