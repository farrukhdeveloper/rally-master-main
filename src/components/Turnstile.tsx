import { useEffect, useRef } from 'react';

export const turnstileSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY?.trim() || '';

interface TurnstileApi {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => { scriptPromise = null; reject(new Error('Could not load verification. Please refresh and try again.')); };
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
}

export default function Turnstile({ onToken, onError, resetKey }: {
  onToken: (token: string) => void;
  onError?: (message: string) => void;
  resetKey: number;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<string | null>(null);
  const callbackRef = useRef({ onToken, onError });
  callbackRef.current = { onToken, onError };

  useEffect(() => {
    if (!turnstileSiteKey) return;
    let cancelled = false;
    loadTurnstile().then(() => {
      if (cancelled || !elementRef.current || !window.turnstile) return;
      widgetRef.current = window.turnstile.render(elementRef.current, {
        sitekey: turnstileSiteKey,
        callback: (token: string) => callbackRef.current.onToken(token),
        'expired-callback': () => callbackRef.current.onToken(''),
        'error-callback': () => {
          callbackRef.current.onToken('');
          callbackRef.current.onError?.('Verification failed. Please try again.');
        },
      });
    }).catch((error: Error) => callbackRef.current.onError?.(error.message));
    return () => {
      cancelled = true;
      if (widgetRef.current && window.turnstile) window.turnstile.remove(widgetRef.current);
      widgetRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey && widgetRef.current && window.turnstile) window.turnstile.reset(widgetRef.current);
  }, [resetKey]);

  return turnstileSiteKey ? <div ref={elementRef} className="min-h-16" aria-label="Human verification" /> : null;
}
