// What the menubar item shows, from the daemon's real status only (spike, UX rules: honest state, no timers).
// Kept free of Electron so it can be tested; `tray.ts` turns it into a Tray and its menu.
import type { BotStatus } from '../../src/contracts.ts';

/** Which brand status icon (`assets/brand/serra-status-<icon>.png`) the menubar shows. */
export type TrayIcon = 'up' | 'needs-you' | 'down';

export interface TrayState {
  status: BotStatus;
  /** Whether the app has a bot profile to manage. Without one there is nothing to restart. */
  profileSelected: boolean;
  /** True while a restart started from the app is in progress. */
  restarting: boolean;
  /** Why the last restart failed, until the next one starts. */
  restartError: string | null;
}

export interface TrayView {
  icon: TrayIcon;
  /** Hover text on the menubar item. */
  tooltip: string;
  /** The first, disabled line of the menu: "Serra is up · Slack connected" or what is wrong. */
  headline: string;
  /** Disabled lines under the headline: job counts while the bot is up, and the last restart failure. */
  details: { kind: 'needs-you' | 'running' | 'error'; label: string }[];
  restart: { label: string; enabled: boolean };
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** Menu items are one line. Long errors (a launchctl transcript) are cut so the menu stays readable. */
const MAX_ERROR = 90;
const oneLine = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > MAX_ERROR ? `${line.slice(0, MAX_ERROR - 1)}…` : line;
};

export const trayView = ({ status, profileSelected, restarting, restartError }: TrayState): TrayView => {
  let icon: TrayIcon = 'down';
  let headline: string;
  const details: TrayView['details'] = [];
  if (!profileSelected) headline = 'No bot profile selected';
  else if (status.state === 'stopped') headline = 'Serra is stopped';
  else {
    headline = `Serra is up · Slack ${status.slackConnected ? 'connected' : 'disconnected'}`;
    const { needsYou, running } = status.counts;
    if (status.slackConnected) icon = needsYou > 0 ? 'needs-you' : 'up';
    details.push({ kind: 'needs-you', label: plural(needsYou, 'needs you', 'need you') });
    details.push({ kind: 'running', label: `${running} running` });
  }
  if (restartError && !restarting) details.push({ kind: 'error', label: `Restart failed: ${oneLine(restartError)}` });
  const counts = details.filter((detail) => detail.kind !== 'error').map((detail) => detail.label);
  return {
    icon,
    tooltip: [headline, ...counts].join(' · '),
    headline,
    details,
    restart: { label: restarting ? 'Restarting…' : 'Restart bot', enabled: profileSelected && !restarting },
  };
};

/** The status feed the controller needs; `StatusSource` in `status.ts` fits. */
export interface TrayStatusFeed {
  current(): BotStatus;
  subscribe(listener: { status(status: BotStatus): void; event(event: unknown): void }): () => void;
}

export interface TrayControllerOptions {
  status: TrayStatusFeed;
  profileSelected(): boolean;
  /** The bridge's `bot.restart`, so the menubar and the window share one restart at a time. */
  restart(): Promise<void>;
  /** Draws the view. Called now and on every change. */
  render(view: TrayView): void;
  log?: (message: string) => void;
}

export interface TrayController {
  /** Restarts the bot (or starts it when stopped). A failure shows in the menu, never throws. */
  restart(): Promise<void>;
  /** Draws again, for example after the profile changed. */
  refresh(): void;
  stop(): void;
}

/** Keeps the menubar in step with the daemon's status and the restarts started from it. */
export const trayController = ({ status, profileSelected, restart, render, log = console.error }: TrayControllerOptions): TrayController => {
  let restarting = false;
  let restartError: string | null = null;
  let stopped = false;
  const draw = (): void => {
    if (stopped) return;
    try { render(trayView({ status: status.current(), profileSelected: profileSelected(), restarting, restartError })); }
    catch (error) { log(`[serra] could not update the menubar: ${String(error)}`); }
  };
  const unsubscribe = status.subscribe({ status: draw, event: () => {} });
  draw();
  return {
    restart: async () => {
      if (restarting) return;
      restarting = true;
      restartError = null;
      draw();
      try { await restart(); }
      catch (error) { restartError = error instanceof Error ? error.message : String(error); }
      finally { restarting = false; draw(); }
    },
    refresh: draw,
    stop: () => { stopped = true; unsubscribe(); },
  };
};
