import { useEffect, useRef } from 'react';
import { resolveSiteKey } from '../lib/turnstile-site-key';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

function loadScript(): Promise<void> {
  if (typeof document === 'undefined') return Promise.resolve();
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Turnstile failed to load'));
    document.head.appendChild(script);
  });
}

type Props = {
  onVerify: (token: string) => void;
  onExpire?: () => void;
};

export default function Turnstile({ onVerify, onExpire }: Props) {
  const container = useRef<HTMLDivElement>(null);
  // Stash callbacks in refs so the widget renders exactly once (a fresh callback
  // identity each render must not re-trigger the effect).
  const onVerifyRef = useRef(onVerify);
  const onExpireRef = useRef(onExpire);
  onVerifyRef.current = onVerify;
  onExpireRef.current = onExpire;

  useEffect(() => {
    let cancelled = false;
    let widgetId: string | null = null;

    const siteKey = resolveSiteKey({
      hostname: window.location.hostname,
      envKey: import.meta.env.PUBLIC_TURNSTILE_SITE_KEY,
    });
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

    loadScript()
      .then(() => {
        if (cancelled || !container.current || !window.turnstile) return;
        widgetId = window.turnstile.render(container.current, {
          sitekey: siteKey,
          theme,
          callback: (token: string) => onVerifyRef.current(token),
          'expired-callback': () => onExpireRef.current?.(),
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  return <div ref={container} />;
}
