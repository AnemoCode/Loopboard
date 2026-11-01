import { useSyncExternalStore } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const media = window.matchMedia('(prefers-color-scheme: dark)');
const listeners = new Set<() => void>();

function read(): ThemePref {
  try {
    return (localStorage.getItem('theme') as ThemePref | null) ?? 'system';
  } catch {
    return 'system';
  }
}

function apply() {
  const pref = read();
  const dark = pref === 'dark' || (pref === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
  listeners.forEach((l) => l());
}
media.addEventListener('change', apply);

export function setThemePref(pref: ThemePref) {
  try {
    localStorage.setItem('theme', pref);
  } catch {
    /* storage unavailable */
  }
  apply();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useThemePref = () => useSyncExternalStore(subscribe, read);
export const useIsDark = () => useSyncExternalStore(subscribe, () => document.documentElement.classList.contains('dark'));
