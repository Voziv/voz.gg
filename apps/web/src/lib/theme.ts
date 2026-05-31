export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'voz-theme';
export const THEME_CHANGE_EVENT = 'voz:themechange';

function isMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function resolveMode(mode: ThemeMode, prefersDark: boolean): ResolvedTheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return prefersDark ? 'dark' : 'light';
}

export function resolveInitialMode(opts: {
  profileTheme?: string | null;
  storedTheme?: string | null;
}): ThemeMode {
  if (isMode(opts.profileTheme)) return opts.profileTheme;
  if (isMode(opts.storedTheme)) return opts.storedTheme;
  return 'system';
}
