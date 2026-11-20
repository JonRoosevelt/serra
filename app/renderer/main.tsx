// The window's entry point: apply prefs (theme, last screen), then render the app.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { serra } from './bridge.ts';
import { initialPath } from './routes.ts';
import { WELCOME_PATH } from './screens/Welcome/welcome.logic.ts';
import { themeStore } from './theme.ts';
import './styles.css';

const boot = async (): Promise<void> => {
  const prefs = await serra()?.app.getPrefs().catch(() => null);
  if (prefs) themeStore.load(prefs.theme);
  // Open on the saved screen unless the URL already names one (a reload keeps where it was).
  if (!window.location.hash || window.location.hash === '#/') {
    // With no profile yet, open the first-run wizard (APP-27) instead.
    const setup = await serra()?.setup.progress().catch(() => null);
    window.location.hash = setup?.next === 'profile' ? WELCOME_PATH : initialPath(prefs?.lastScreen);
  }
  const root = document.getElementById('root');
  if (!root) throw new Error('The page has no #root element.');
  createRoot(root).render(<StrictMode><App /></StrictMode>);
};

void boot();
