'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { VERTICALS, getVertical, type VerticalProfile } from '@queueos/core';

type Mode = 'light' | 'dark';

interface ThemeContextValue {
  mode: Mode;
  toggleMode: () => void;
  vertical: VerticalProfile;
  setVertical: (id: string) => void;
  /** Shorthand — every screen reads terminology off this. */
  t: VerticalProfile['terminology'];
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const MODE_KEY = 'queueos.mode';

export function ThemeProvider({
  children,
  initialVertical = 'hospital',
}: {
  children: ReactNode;
  initialVertical?: string;
}) {
  const [mode, setMode] = useState<Mode>('light');
  const [loadedMode, setLoadedMode] = useState(false);
  const [verticalId, setVerticalId] = useState(initialVertical);

  // Read the stored preference after mount rather than during render, so the
  // server and first client render agree and React does not warn about a
  // hydration mismatch.
  useEffect(() => {
    const stored = window.localStorage.getItem(MODE_KEY) as Mode | null;
    const preferred =
      stored ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setMode(preferred);
    setLoadedMode(true);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');

    // Writing before the stored value has been read would persist the `light`
    // placeholder over the user's real choice. Effects run in order, so that
    // write lands while the state update above is still pending — and Strict
    // Mode's second pass then reads back the value we just clobbered, losing
    // dark mode on every navigation.
    if (loadedMode) window.localStorage.setItem(MODE_KEY, mode);
  }, [mode, loadedMode]);

  useEffect(() => {
    setVerticalId(initialVertical);
  }, [initialVertical]);

  const vertical = useMemo(() => getVertical(verticalId), [verticalId]);

  // The accent is written to the document root rather than passed down as
  // props, so any component can use `text-accent` / `bg-accent` and pick up the
  // right colour for whichever industry it is rendering.
  useEffect(() => {
    const root = document.documentElement;
    const accent = mode === 'dark' ? vertical.theme.accentDark : vertical.theme.accent;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--glow', vertical.theme.glow);
    root.style.setProperty('--tint', vertical.theme.tint);
  }, [vertical, mode]);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === 'light' ? 'dark' : 'light'));
  }, []);

  const setVertical = useCallback((id: string) => {
    if (id in VERTICALS) setVerticalId(id);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, toggleMode, vertical, setVertical, t: vertical.terminology }),
    [mode, toggleMode, vertical, setVertical],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
