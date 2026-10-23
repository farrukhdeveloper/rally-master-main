import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import HelpPage from './HelpPage';
import ContactPage from './ContactPage';
import Turnstile, { turnstileSiteKey } from '../components/Turnstile';
import { Feather, Mail, Lock, User, Phone, CalendarCheck, Monitor, Trophy, HelpCircle, MessageCircle, ArrowLeft } from 'lucide-react';

type Mode = 'login' | 'register';

export default function AuthPage() {
  const { appName } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (turnstileSiteKey && !captchaToken) {
      setError('Complete the verification before continuing.');
      return;
    }
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password, options: { captchaToken } });
        if (error) throw error;
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password, options: { captchaToken } });
        if (error) throw error;
        if (data.user) {
          const { error: profileError } = await supabase.from('profiles').insert({
            id: data.user.id,
            full_name: fullName,
            skill_level: 'level_5',
            phone,
            role: 'player',
          });
          if (profileError) throw profileError;
          supabase.functions.invoke('notify-super-admin', {
            body: { action: 'account_created', full_name: fullName, email, phone },
          }).catch((notifyError) => {
            console.warn('Account notification failed', notifyError);
          });
        }
        setSuccess('Account created! You can now log in.');
        setMode('login');
      }
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
      setCaptchaToken('');
      setCaptchaReset((value) => value + 1);
    }
  }

  async function handleForgotPassword(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (turnstileSiteKey && !captchaToken) {
      setError('Complete the verification before continuing.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
      captchaToken,
    });
    setLoading(false);
    setCaptchaToken('');
    setCaptchaReset((value) => value + 1);
    if (error) {
      setError(error.message);
      return;
    }
    setSuccess('Password reset email sent. Open the link in your email to set a new password.');
    setShowForgot(false);
  }

  if (showHelp) return <HelpPage publicView onBack={() => setShowHelp(false)} />;
  if (showContact) return <ContactPage publicView onBack={() => setShowContact(false)} />;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-emerald-50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid lg:grid-cols-[1.05fr_0.95fr] gap-8 items-center">
        <div className="hidden lg:block">
          <div className="inline-flex items-center gap-3 mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-emerald-500 rounded-2xl shadow-lg shadow-emerald-500/25">
              <Feather className="w-7 h-7 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-sm font-semibold text-emerald-600">Rally Master</p>
              <p className="text-xs text-gray-400">Badminton session management</p>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-gray-950 tracking-tight leading-tight max-w-lg">
            Badminton sessions made easier to run.
          </h1>
          <p className="text-gray-500 text-base mt-4 max-w-lg leading-relaxed">
            Organise players, manage live courts, rotate fairly, record results, and keep group leaderboards in one place.
          </p>
          <div className="grid grid-cols-3 gap-3 mt-7 max-w-lg">
            <FeaturePill icon={<CalendarCheck className="w-5 h-5" />} title="Sessions" text="Invite and manage players" />
            <FeaturePill icon={<Monitor className="w-5 h-5" />} title="Live Courts" text="Show who plays next" />
            <FeaturePill icon={<Trophy className="w-5 h-5" />} title="Rankings" text="Track wins and pairs" />
          </div>
          <button
            onClick={() => setShowHelp(true)}
            className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:text-emerald-600"
          >
            <HelpCircle className="w-4 h-4" />
            View Help & Features
          </button>
          <button
            onClick={() => setShowContact(true)}
            className="mt-3 ml-5 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-emerald-700"
          >
            <MessageCircle className="w-4 h-4" />
            Contact Us
          </button>
        </div>

      <div className="w-full max-w-md mx-auto">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-emerald-500 rounded-2xl mb-4 shadow-lg shadow-emerald-500/30">
            <Feather className="w-8 h-8 text-white" strokeWidth={2.5} />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">{appName}</h1>
          <p className="text-gray-500 mt-2 text-sm max-w-xs mx-auto">
            Plan sessions, balance courts, record results, and keep your badminton group moving.
          </p>
        </div>

        {/* Card */}
        <div className="bg-white border border-gray-200 rounded-2xl p-8 shadow-sm">
          {/* Tabs */}
          {!showForgot && (
            <div className="flex bg-gray-100 rounded-xl p-1 mb-6">
              {(['login', 'register'] as Mode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(''); setSuccess(''); setCaptchaToken(''); setCaptchaReset((value) => value + 1); }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                    mode === m
                      ? 'bg-emerald-500 text-white shadow-sm'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                >
                  {m === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-500 text-sm rounded-lg px-4 py-3 mb-4">
              {error}
            </div>
          )}
          {success && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-600 text-sm rounded-lg px-4 py-3 mb-4">
              {success}
            </div>
          )}

          {showForgot ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <button
                type="button"
                onClick={() => { setShowForgot(false); setError(''); setSuccess(''); }}
                className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
              >
                <ArrowLeft className="w-4 h-4" /> Back to sign in
              </button>
              <p className="text-gray-500 text-sm">
                Enter your email address and we will send a password reset link.
              </p>
              <InputField
                icon={<Mail className="w-4 h-4" />}
                type="email"
                placeholder="Email Address"
                value={email}
                onChange={setEmail}
                required
              />
              <Turnstile onToken={setCaptchaToken} onError={setError} resetKey={captchaReset} />
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 mt-2"
              >
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>
          ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'register' && (
              <>
                <InputField
                  icon={<User className="w-4 h-4" />}
                  type="text"
                  placeholder="Full Name"
                  value={fullName}
                  onChange={setFullName}
                  required
                />
                <InputField
                  icon={<Phone className="w-4 h-4" />}
                  type="tel"
                  placeholder="Phone Number"
                  value={phone}
                  onChange={setPhone}
                />
              </>
            )}

            <InputField
              icon={<Mail className="w-4 h-4" />}
              type="email"
              placeholder="Email Address"
              value={email}
              onChange={setEmail}
              required
            />
            <InputField
              icon={<Lock className="w-4 h-4" />}
              type="password"
              placeholder="Password"
              value={password}
              onChange={setPassword}
              required
            />
            <Turnstile onToken={setCaptchaToken} onError={setError} resetKey={captchaReset} />

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/40 mt-2"
            >
              {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
            {mode === 'login' && (
              <button
                type="button"
                onClick={() => { setShowForgot(true); setError(''); setSuccess(''); }}
                className="w-full text-center text-sm font-semibold text-emerald-700 hover:text-emerald-600"
              >
                Forgot password?
              </button>
            )}
          </form>
          )}
        </div>

        <p className="text-center text-gray-400 text-xs mt-6">
          {appName} - Built for badminton communities
        </p>
        <button
          onClick={() => setShowHelp(true)}
          className="mt-3 mx-auto flex items-center gap-2 text-xs font-semibold text-emerald-700 hover:text-emerald-600"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          Help & Features
        </button>
        <button
          onClick={() => setShowContact(true)}
          className="mt-2 mx-auto flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-emerald-700"
        >
          <MessageCircle className="w-3.5 h-3.5" />
          Contact Us
        </button>
      </div>
      </div>
    </div>
  );
}

function FeaturePill({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="bg-white/80 border border-gray-200 rounded-2xl p-4 shadow-sm">
      <div className="text-emerald-600 mb-3">{icon}</div>
      <p className="text-gray-900 text-sm font-semibold">{title}</p>
      <p className="text-gray-500 text-xs mt-1 leading-snug">{text}</p>
    </div>
  );
}

function InputField({
  icon,
  type,
  placeholder,
  value,
  onChange,
  required,
}: {
  icon: React.ReactNode;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div className="relative">
      <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{icon}</div>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
      />
    </div>
  );
}


