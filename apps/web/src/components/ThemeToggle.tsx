import { useEffect, useRef, useState } from 'react';
import { Monitor, Sun, Moon } from 'lucide-react';
import { toast } from 'sonner';
import { authClient } from '../lib/auth-client';
import { cn } from '../lib/utils';
import {
  type ThemeMode,
  THEME_CHANGE_EVENT,
  getStoredMode,
  setStoredMode,
  applyMode,
} from '../lib/theme';

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Monitor }[] = [
  { mode: 'system', label: 'System', Icon: Monitor },
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
];

export default function ThemeToggle() {
  const { data: session } = authClient.useSession();
  const [mode, setMode] = useState<ThemeMode>('system');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMode(getStoredMode());
    const onChange = (e: Event) => setMode((e as CustomEvent<ThemeMode>).detail);
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, onChange);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  function choose(next: ThemeMode) {
    setMode(next);
    setStoredMode(next);
    applyMode(next);
    if (!session?.user) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const { error } = await authClient.updateUser({ theme: next });
      if (error) toast.error(error.message ?? 'Could not save theme preference.');
    }, 400);
  }

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
    >
      {OPTIONS.map(({ mode: optionMode, label, Icon }) => (
        <button
          key={optionMode}
          type="button"
          role="radio"
          aria-checked={mode === optionMode}
          title={label}
          onClick={() => choose(optionMode)}
          className={cn(
            'inline-flex size-7 items-center justify-center rounded-[min(var(--radius-md),8px)] text-muted-foreground transition-colors hover:text-foreground',
            mode === optionMode && 'bg-muted text-foreground',
          )}
        >
          <Icon className="size-4" />
          <span className="sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
