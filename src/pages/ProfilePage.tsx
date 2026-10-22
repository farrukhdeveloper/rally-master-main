import { FormEvent, useEffect, useState } from 'react';
import { LockKeyhole, Save, UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

export default function ProfilePage() {
  const { user, profile, refreshProfile } = useAuth();
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [detailsSaving, setDetailsSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [detailsMessage, setDetailsMessage] = useState('');
  const [passwordMessage, setPasswordMessage] = useState('');
  const [detailsError, setDetailsError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => setPhone(profile?.phone ?? ''), [profile?.phone]);

  async function saveDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    setDetailsSaving(true);
    setDetailsError('');
    setDetailsMessage('');
    try {
      const { data, error } = await supabase.from('profiles')
        .update({ phone: phone.trim() })
        .eq('id', user.id)
        .select('id')
        .single();
      if (error) throw error;
      if (!data) throw new Error('Your profile could not be updated.');
      await refreshProfile();
      setDetailsMessage('Phone number saved.');
    } catch (error) {
      setDetailsError(error instanceof Error ? error.message : 'Could not save your details.');
    } finally {
      setDetailsSaving(false);
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) return;
    if (password.length < 8) {
      setPasswordError('Use at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setPasswordSaving(true);
    setPasswordError('');
    setPasswordMessage('');
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setConfirmPassword('');
      setPasswordMessage('Password updated. Use your new password the next time you sign in.');
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : 'Could not update your password.');
    } finally {
      setPasswordSaving(false);
    }
  }

  return <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
    <div><h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><UserRound className="w-6 h-6 text-emerald-600" /> My Profile</h1><p className="text-sm text-gray-500 mt-1">Update your phone number and password.</p></div>

    <form onSubmit={saveDetails} className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-4">
      <div><h2 className="font-semibold text-gray-900">Contact details</h2><p className="text-sm text-gray-500 mt-1">Your name is managed by an administrator.</p></div>
      <div className="text-sm"><span className="block font-medium text-gray-700">Full name</span><p className="mt-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-600">{profile?.full_name || 'Unavailable'}</p></div>
      <label className="block text-sm font-medium text-gray-700">Phone<input value={phone} onChange={(event) => setPhone(event.target.value)} type="tel" maxLength={30} autoComplete="tel" className="block w-full mt-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-500" /></label>
      {detailsError && <p role="alert" className="text-sm text-red-600">{detailsError}</p>}
      {detailsMessage && <p role="status" className="text-sm text-emerald-700">{detailsMessage}</p>}
      <button disabled={detailsSaving || !profile} className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold"><Save className="w-4 h-4" />{detailsSaving ? 'Saving...' : 'Save phone'}</button>
    </form>

    <form onSubmit={changePassword} className="bg-white border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-4">
      <div><h2 className="font-semibold text-gray-900 flex items-center gap-2"><LockKeyhole className="w-4 h-4 text-emerald-600" /> Password</h2><p className="text-sm text-gray-500 mt-1">Choose a new password with at least 8 characters.</p></div>
      <label className="block text-sm font-medium text-gray-700">New password<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required minLength={8} autoComplete="new-password" className="block w-full mt-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-500" /></label>
      <label className="block text-sm font-medium text-gray-700">Confirm new password<input value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} type="password" required minLength={8} autoComplete="new-password" className="block w-full mt-1.5 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:border-emerald-500" /></label>
      {passwordError && <p role="alert" className="text-sm text-red-600">{passwordError}</p>}
      {passwordMessage && <p role="status" className="text-sm text-emerald-700">{passwordMessage}</p>}
      <button disabled={passwordSaving || !user} className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-sm font-semibold">{passwordSaving ? 'Updating...' : 'Update password'}</button>
    </form>
  </div>;
}
