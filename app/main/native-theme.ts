// Keeps Electron's `nativeTheme.themeSource` equal to the theme pref (APP-28), so what Chromium and macOS draw
// (window chrome, menus, the menubar item's menu, scrollbars, dialogs, the placeholder page) matches the window.
// Kept free of Electron so tests can pass a plain object for `nativeTheme`.
import type { Theme } from './bridge.ts';
import type { PrefsStore } from './prefs.ts';

/** The part of Electron's `nativeTheme` this uses. */
export interface NativeThemeTarget { themeSource: Theme }

/** Sets the native theme from the saved prefs now, and again whenever a save changes the theme. */
export const followTheme = (prefs: PrefsStore, native: NativeThemeTarget): PrefsStore => {
  native.themeSource = prefs.get().theme;
  return {
    get: () => prefs.get(),
    set: (next) => {
      prefs.set(next);
      if (native.themeSource !== next.theme) native.themeSource = next.theme;
    },
  };
};
