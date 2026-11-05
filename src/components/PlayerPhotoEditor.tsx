import { ChangeEvent, useId, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import PlayerAvatar, { PLAYER_PHOTO_BUCKET, playerPhotoUrl } from './PlayerAvatar';

const MAX_INPUT_BYTES = 15 * 1024 * 1024;

async function resizePhoto(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot prepare the photo.');
    const crop = Math.min(bitmap.width, bitmap.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, 512, 512);
    context.drawImage(bitmap, (bitmap.width - crop) / 2, (bitmap.height - crop) / 2, crop, crop, 0, 0, 512, 512);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) throw new Error('Could not prepare the photo.');
    return blob;
  } finally {
    bitmap.close();
  }
}

export default function PlayerPhotoEditor({ playerId, name, photoPath, onSaved }: {
  playerId: string;
  name: string;
  photoPath?: string | null;
  onSaved: () => Promise<void>;
}) {
  const inputId = useId();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function uploadPhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError('');
    setMessage('');
    if (!file.type.startsWith('image/')) { setError('Choose an image file.'); return; }
    if (file.size > MAX_INPUT_BYTES) { setError('Choose an image smaller than 15 MB.'); return; }
    setSaving(true);
    let newPath = '';
    try {
      const image = await resizePhoto(file);
      newPath = `${playerId}/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from(PLAYER_PHOTO_BUCKET)
        .upload(newPath, image, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
      if (uploadError) throw uploadError;
      const { data, error: profileError } = await supabase.from('profiles')
        .update({ avatar_url: newPath }).eq('id', playerId).select('id').single();
      if (profileError || !data) {
        await supabase.storage.from(PLAYER_PHOTO_BUCKET).remove([newPath]);
        throw profileError || new Error('Could not save the photo to the player profile.');
      }
      if (photoPath && playerPhotoUrl(photoPath)) {
        await supabase.storage.from(PLAYER_PHOTO_BUCKET).remove([photoPath]);
      }
      await onSaved();
      setMessage('Photo saved.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not upload the photo.');
    } finally {
      setSaving(false);
    }
  }

  async function removePhoto() {
    if (!photoPath || saving) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data, error: profileError } = await supabase.from('profiles')
        .update({ avatar_url: '' }).eq('id', playerId).select('id').single();
      if (profileError || !data) throw profileError || new Error('Could not remove the photo.');
      if (playerPhotoUrl(photoPath)) await supabase.storage.from(PLAYER_PHOTO_BUCKET).remove([photoPath]);
      await onSaved();
      setMessage('Photo removed.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove the photo.');
    } finally {
      setSaving(false);
    }
  }

  return <div className="flex flex-wrap items-center gap-3">
    <PlayerAvatar name={name} photoPath={photoPath} className="w-16 h-16 text-xl" />
    <div className="flex flex-wrap items-center gap-2">
      <input id={inputId} type="file" accept="image/*" onChange={uploadPhoto} disabled={saving} className="sr-only" />
      <label htmlFor={inputId} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 ${saving ? 'pointer-events-none opacity-50' : ''}`}><Camera className="w-4 h-4" />{saving ? 'Saving...' : photoPath ? 'Change photo' : 'Add photo'}</label>
      {photoPath && <button type="button" onClick={removePhoto} disabled={saving} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs text-red-600 disabled:opacity-50"><Trash2 className="w-4 h-4" />Remove</button>}
    </div>
    {error && <p role="alert" className="w-full text-xs text-red-600">{error}</p>}
    {message && <p role="status" className="w-full text-xs text-emerald-700">{message}</p>}
  </div>;
}
