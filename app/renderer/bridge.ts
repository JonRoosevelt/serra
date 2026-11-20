// The window's only way to the main process: `window.serra` from the preload (app/main/bridge.ts).
import type { SerraBridge } from '../main/bridge.ts';

declare global {
  interface Window {
    /** Absent when the page runs outside Electron (a plain browser on the Vite dev server). */
    serra?: SerraBridge;
  }
}

export const serra = (): SerraBridge | null => window.serra ?? null;
