import { FormEvent, useEffect, useState } from 'react';
import { Mail, Save, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [emailSaving, setEmailSaving] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState('');
  const [emailMessage, setEmailMessage] = useState('');
  const [detailsError, setDetailsError] = useState('');
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    setFullName(profile?.full_name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.full_name, profile?.phone]);

  useEffect(() => setEmail(user?.email ?? ''), [user?.email]);

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const name = fullName.trim();
    if (!name) {
      setDetailsError('Enter your name.');
      return;
    }
    setDetailsSaving(true);
    setDetailsError('');
    setDetailsMessage('');
    try {
      const { data, error } = await supabase.from('profiles')
        .update({ full_name: name, phone: phone.trim() })
        .eq('id', user.id)
        .select('id')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Your profile could not be updated.');
      await refreshProfile();
      setDetailsMessage('Personal details saved.');
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Could not save your details.');
    } finally {
      setDetailsSaving(false);
    }
  }

  async function changeEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    const nextEmail = email.trim().toLowerCase();
    if (!nextEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setEmailError('Enter a valid email address.');
      return;
    }
    if (nextEmail === user.email?.toLowerCase()) {
      setEmailError('This is already your sign-in email.');
      return;
    }
    setEmailSaving(true);
    setEmailError('');
    setEmailMessage('');
    try {
      const { error } = await supabase.auth.updateUser(
        { email: nextEmail },
        { emailRedirectTo: window.location.origin },
      );
      if (error) throw error;
      setEmailMessage('Check your new email for a confirmation link. Supabase may also ask you to confirm the change from your current email. Until confirmation is complete, keep using your current email to sign in.');
    } catch (error) {
      setEmailError(error instanceof Error ? error.message : 'Could not request the email change.');
    } finally {
      setEmailSaving(false);
    }
  }

  return <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
    <div><h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><UserRound className="w-6 h-6 text-emerald-600" /> My Profile</h1><p className="text-sm text-gray-500 mt-1">Update your contact details and sign-in email.</p></div>

    <form onSubmit={saveDetails} className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-4">
      <div><h2 className="font-semibold text-gray-900">Personal details</h2><p className="text-sm text-gray-500 mt-1">Your name appears in groups, sessions, and match history.</p></div>
      <label className="block text-sm font-medium text-gray-700">Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} required maxLength={100} autoComplete="name" className="block w-full mt-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-500" /></label>
      <label className="block text-sm font-medium text-gray-700">Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" maxLength={30} autoComplete="tel" className="block w-full mt-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-500" /></label>
      {detailsError && <p role="alert" className="text-sm text-red-600">{detailsError}</p>}
      {detailsMessage && <p role="status" className="text-sm text-emerald-700">{detailsMessage}</p>}
      <button disabled={detailsSaving || !profile} className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold"><Save className="w-4 h-4" />{detailsSaving ? 'Saving...' : 'Save details'}</button>
    </form>

    <form onSubmit={changeEmail} className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-4">
      <div><h2 className="font-semibold text-gray-900 flex items-center gap-2"><Mail className="w-4 h-4 text-emerald-600" /> Sign-in email</h2><p className="text-sm text-gray-500 mt-1">Current email: {user?.email || 'Unavailable'}. Changing it requires email confirmation.</p></div>
      <label className="block text-sm font-medium text-gray-700">New email<input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required autoComplete="email" className="block w-full mt-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-500" /></label>
      {emailError && <p role="alert" className="text-sm text-red-600">{emailError}</p>}
      {emailMessage && <p role="status" className="text-sm text-emerald-700">{emailMessage}</p>}
      <button disabled={emailSaving || !user} className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold">{emailSaving ? 'Sending...' : 'Change email'}</button>
    </form>
  </div>;
}
