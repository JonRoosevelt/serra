// The main window: created with the locked-down options from window-options.ts, kept on screen, and its size and
// place saved to prefs when it closes.
import { BrowserWindow, screen, shell } from 'electron';
import type { AppPrefs } from './bridge.ts';
import type { PrefsStore } from './prefs.ts';
import { allowsPermission, isExternalUrl, windowOptions } from './window-options.ts';

/** Drops a saved position that is no longer on any display (a monitor was unplugged), keeping the size. */
const onScreen = (bounds: AppPrefs['window']): AppPrefs['window'] => {
  const { x, y, ...rest } = bounds;
  if (x === undefined || y === undefined) return rest;
  const visible = screen.getAllDisplays().some(({ workArea: a }) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height);
  return visible ? bounds : rest;
};

export const createMainWindow = ({ preload, prefs, isAppUrl }: {
  preload: string;
  prefs: PrefsStore;
  /** Whether the window may navigate to this URL (the app's own pages). */
  isAppUrl: (url: string) => boolean;
}): BrowserWindow => {
  const saved = prefs.get().window;
  const window = new BrowserWindow(windowOptions(preload, onScreen(saved)));
  if (saved.maximized) window.maximize();
  window.once('ready-to-show', () => window.show());

  const { webContents } = window;
  // New windows and navigation away from the app are refused; web links open in the browser instead.
  webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    if (isExternalUrl(url)) void shell.openExternal(url);
  });
  webContents.on('will-attach-webview', (event) => event.preventDefault());
  // The app needs no camera, microphone, notifications from the page, etc.; only the copy buttons' clipboard writes.
  webContents.session.setPermissionRequestHandler((_contents, permission, callback) => callback(allowsPermission(permission)));

  window.on('close', () => {
    const { x, y, width, height } = window.getNormalBounds();
    prefs.set({ ...prefs.get(), window: { x, y, width, height, maximized: window.isMaximized() } });
  });
  return window;
};
