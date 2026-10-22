import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft, Mail, Phone, User, Send } from 'lucide-react';

export default function ContactPage({ publicView = false, onBack }: { publicView?: boolean; onBack?: () => void }) {
  const { appName } = useAuth();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  async function submitContact(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    const { error } = await supabase.functions.invoke('notify-super-admin', {
      body: {
        action: 'contact_us',
        full_name: fullName,
        email,
        phone,
        message,
      },
    });

    setLoading(false);
    if (error) {
      setError(error.message || 'Could not send your message.');
      return;
    }

    setFullName('');
    setEmail('');
    setPhone('');
    setMessage('');
    setSuccess('Thanks, your message has been sent.');
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
          <ContactInput icon={<User className="w-4 h-4" />} placeholder="Full name" value={fullName} onChange={setFullName} required />
          <ContactInput icon={<Mail className="w-4 h-4" />} type="email" placeholder="Email address" value={email} onChange={setEmail} required />
          <ContactInput icon={<Phone className="w-4 h-4" />} placeholder="Phone number" value={phone} onChange={setPhone} />
          <textarea
            placeholder="How can we help?"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            required
            rows={5}
            className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-emerald-500 resize-none"
          />
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
}: {
  icon: React.ReactNode;
  type?: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
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
        className="w-full bg-gray-50 border border-gray-200 text-gray-900 placeholder-gray-400 rounded-xl pl-9 pr-4 py-3 text-sm focus:outline-none focus:border-emerald-500"
      />
    </div>
  );
}
