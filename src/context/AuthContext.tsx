import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { Session, User } from '@supabase/supabase-js';
import { supabase, Profile } from '../lib/supabase';

export const DEFAULT_APP_NAME = 'Rally Master';

function clearSupabaseAuthStorage() {
  if (typeof window === 'undefined') return;

  const clearFrom = (storage: Storage) => {
    for (let i = storage.length - 1; i >= 0; i--) {
      const key = storage.key(i);
      if (!key) continue;
      if ((key.startsWith('sb-') && key.endsWith('-auth-token')) || key === 'sb-admin-create-user') {
        storage.removeItem(key);
      }
    }
  };

  clearFrom(window.localStorage);
  clearFrom(window.sessionStorage);
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  appName: string;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  passwordRecovery: boolean;
  completePasswordRecovery: () => void;
  refreshAppName: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  profile: null,
  loading: true,
  appName: DEFAULT_APP_NAME,
  isAdmin: false,
  isSuperAdmin: false,
  passwordRecovery: false,
  completePasswordRecovery: () => {},
  refreshAppName: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [appName, setAppName] = useState(DEFAULT_APP_NAME);
  const [passwordRecovery, setPasswordRecovery] = useState(false);

  async function recordLogin(userId: string) {
    if (typeof window === 'undefined') return;

    const storageKey = `rally-master-login-recorded-${userId}`;
    if (window.sessionStorage.getItem(storageKey)) return;
    window.sessionStorage.setItem(storageKey, '1');

    const loggedInAt = new Date().toISOString();
    const userAgent = window.navigator?.userAgent || null;

    const { error: profileError } = await supabase
      .from('profiles')
      .update({ last_login_at: loggedInAt })
      .eq('id', userId);
    if (profileError) console.warn('Last login update skipped.', profileError.message);

    const { error: eventError } = await supabase
      .from('user_login_events')
      .insert({ user_id: userId, logged_in_at: loggedInAt, user_agent: userAgent });
    if (eventError) console.warn('Login event insert skipped.', eventError.message);
  }

  async function fetchProfile(userId: string) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    setProfile(data);
    recordLogin(userId);
  }

  async function refreshProfile() {
    if (user) await fetchProfile(user.id);
  }

  async function refreshAppName() {
    const { data } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'app_name')
      .maybeSingle();
    const savedName = data?.value?.trim();
    setAppName(savedName && savedName !== 'ShuttleSync' ? savedName : DEFAULT_APP_NAME);
  }

  useEffect(() => { refreshAppName(); }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const userId = session.user.id;
        // Supabase auth callbacks must return immediately. A deferred profile
        // query prevents token-refresh events from deadlocking the auth client.
        window.setTimeout(() => {
          fetchProfile(userId)
            .catch((error) => console.warn('Profile refresh after auth change failed.', error))
            .finally(() => setLoading(false));
        }, 0);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function signOut() {
    setLoading(true);
    try {
      await supabase.auth.signOut({ scope: 'local' });
    } catch (error) {
      console.warn('Supabase sign out failed, clearing local session instead.', error);
    } finally {
      clearSupabaseAuthStorage();
      setSession(null);
      setUser(null);
      setProfile(null);
      setLoading(false);
    }
  }

  const isSuperAdmin = profile?.role === 'super_admin';
  const isAdmin = profile?.role === 'admin' || isSuperAdmin;
  const completePasswordRecovery = () => setPasswordRecovery(false);

  return (
    <AuthContext.Provider value={{ user, session, profile, loading, appName, isAdmin, isSuperAdmin, passwordRecovery, completePasswordRecovery, refreshAppName, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);


