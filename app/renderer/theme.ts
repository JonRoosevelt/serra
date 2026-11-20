// The window's theme store (theme.logic.ts) wired to <html> and app prefs, and a hook for components.
import { useSyncExternalStore } from 'react';
import type { Theme } from '../main/bridge.ts';
import { serra } from './bridge.ts';
import { applyTheme, createThemeStore } from './theme.logic.ts';

export const themeStore = createThemeStore({
  apply: (theme) => applyTheme(theme, document.documentElement),
  // Outside the app (a plain browser on the Vite dev server) the theme still applies, it just isn't saved.
  save: async (theme) => {
    const bridge = serra();
    return bridge ? (await bridge.app.setPrefs({ theme })).theme : theme;
  },
});

/** The current theme, re-rendering when it changes from anywhere (the Appearance page, ⌘K). */
export const useTheme = (): Theme => useSyncExternalStore(themeStore.subscribe, themeStore.current);
