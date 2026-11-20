// Keeps app prefs in electron-store (`prefs.json` under Electron's userData folder). Main process only.
import Store from 'electron-store';
import { readPrefs, type PrefsStore } from './prefs.ts';
import type { AppPrefs } from './bridge.ts';

export const electronPrefs = (): PrefsStore => {
  const store = new Store<{ prefs: AppPrefs }>({ name: 'prefs' });
  return {
    // Read leniently so a hand-edited or older prefs file never stops the app from opening.
    get: () => readPrefs(store.get('prefs')),
    set: (prefs) => store.set('prefs', prefs),
  };
};
