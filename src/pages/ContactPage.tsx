import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Mail, Phone, User, Send } from 'lucide-react';
import Turnstile, { turnstileSiteKey } from '../components/Turnstile';

export default function ContactPage({ publicView = false, onBack }: { publicView?: boolean; onBack?: () => void }) {
  const { appName } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const [website, setWebsite] = useState('');

  async function submitContact(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (turnstileSiteKey && !captchaToken) {
      setError('Complete the verification before sending your message.');
      return;
    }
    setLoading(true);

    const { data, error: functionError } = await supabase.functions.invoke('notify-super-admin', {
      body: {
        action: 'contact_us',
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        message: message.trim(),
        website,
        captcha_token: captchaToken,
      },
    });

    setLoading(false);
    setCaptchaToken('');
    setCaptchaReset((value) => value + 1);
    if (functionError || data?.error) {
      let message = data?.error || 'Could not send your message. Please try again later.';
      if (functionError && 'context' in functionError && functionError.context instanceof Response) {
        const response = await functionError.context.clone().json().catch(() => null);
        if (response?.error) message = response.error;
      }
      setError(message);
      return;
    }

    setFullName('');
    setEmail('');
    setPhone('');
    setMessage('');
    setSuccess(data?.email_status === 'failed'
      ? 'Thanks, your message has been received and is available to the administrators.'
      : 'Thanks, your message has been sent.');
  }

  return (
    <div className={publicView ? 'min-h-screen bg-gradient-to-br from-gray-50 via-white to-emerald-50 p-4 flex items-center justify-center' : 'p-6 max-w-3xl mx-auto'}>
      <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Contact Us</h1>
            <p className="text-gray-500 text-sm mt-1">Send a message to the {appName} Super Admin.</p>
          </div>
          {onBack && (
            <button
              onClick={onBack}
              className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          )}
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-500 text-sm rounded-xl px-4 py-3 mb-4">{error}</div>}
        {success && <div className="bg-emerald-50 border border-emerald-200 text-emerald-600 text-sm rounded-xl px-4 py-3 mb-4">{success}</div>}

        <form onSubmit={submitContact} className="space-y-4">
          <div className="hidden" aria-hidden="true"><label>Website<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label></div>
          <ContactInput icon={<User className="w-4 h-4" />} placeholder="Full name" value={fullName} onChange={setFullName} maxLength={100} required />
          <ContactInput icon={<Mail className="w-4 h-4" />} type="email" placeholder="Email address" value={email} onChange={setEmail} required />
          <ContactInput icon={<Phone className="w-4 h-4" />} placeholder="Phone number" value={phone} onChange={setPhone} maxLength={30} />
          <textarea
            placeholder="How can we help?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            maxLength={4000}
            rows={5}
            className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 resize-none"
          />
          <Turnstile onToken={setCaptchaToken} onError={setError} resetKey={captchaReset} />
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-all"
          >
            <Send className="w-4 h-4" />
            {loading ? 'Sending...' : 'Send Message'}
          </button>
        </form>
      </div>
    </div>
  );
}

function ContactInput({
  icon,
  type = 'text',
  placeholder,
  value,
  onChange,
  required,
  maxLength,
}: {
  icon: React.ReactNode;
  type?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  maxLength?: number;
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
        maxLength={maxLength}
        className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-500"
      />
    </div>
  );
}
