import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export const PLAYER_PHOTO_BUCKET = 'player-photos';

export function playerPhotoUrl(path?: string | null) {
  if (!path || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.jpg$/.test(path)) return '';
  return supabase.storage.from(PLAYER_PHOTO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export default function PlayerAvatar({ name, photoPath, className = 'w-9 h-9' }: {
  name?: string | null;
  photoPath?: string | null;
  className?: string;
}) {
  const url = playerPhotoUrl(photoPath);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [url]);

  return <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-emerald-50 text-emerald-700 font-semibold ${className}`} aria-label={name ? `${name}'s photo` : 'Player photo'}>
    <span aria-hidden="true">{name?.trim().charAt(0).toUpperCase() || '?'}</span>
    {url && !imageFailed && <img src={url} alt="" loading="lazy" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" />}
  </span>;
}
