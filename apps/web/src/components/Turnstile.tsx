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

// The resolved theme is reflected by the `dark` class on <html> (see lib/theme.ts
// and the inline script in Base.astro), which already accounts for system mode
// following the OS preference.
function currentTheme(): 'light' | 'dark' {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
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
    let renderedTheme: 'light' | 'dark' | null = null;

    const siteKey = resolveSiteKey({
      hostname: window.location.hostname,
      envKey: import.meta.env.PUBLIC_TURNSTILE_SITE_KEY,
    });

    function renderWidget() {
      if (cancelled || !container.current || !window.turnstile) return;
      renderedTheme = currentTheme();
      widgetId = window.turnstile.render(container.current, {
        sitekey: siteKey,
        theme: renderedTheme,
        callback: (token: string) => onVerifyRef.current(token),
        'expired-callback': () => onExpireRef.current?.(),
      });
    }

    // Turnstile has no live theme-update API, so re-render the widget when the
    // page theme changes. A re-render discards any solved token, so clear it.
    function syncTheme() {
      if (cancelled || !window.turnstile || currentTheme() === renderedTheme) return;
      if (widgetId) {
        window.turnstile.remove(widgetId);
        widgetId = null;
      }
      onExpireRef.current?.();
      renderWidget();
    }

    const observer = new MutationObserver(syncTheme);

    loadScript()
      .then(() => {
        if (cancelled) return;
        renderWidget();
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      observer.disconnect();
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, []);

  return <div ref={container} />;
}
