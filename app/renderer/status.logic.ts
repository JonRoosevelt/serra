// The bot's status as the sidebar header (and later the menubar) shows it. Labels come only from the status the
// daemon reports, never from timers: before the first report the header says "checking".
import type { BotStatus } from '../../src/contracts.ts';

/** Which status icon to show. `unknown` is before the first report arrives. */
export type StatusTone = 'up' | 'needs-you' | 'down' | 'unknown';

export interface StatusView {
  tone: StatusTone;
  /** Short state after the name: "Serra · up". */
  label: string;
  /** One sentence for a tooltip or screen reader. */
  detail: string;
}

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

export const statusView = (status: BotStatus | null): StatusView => {
  if (!status) return { tone: 'unknown', label: 'checking', detail: 'Waiting for the bot to report its status.' };
  if (status.state === 'stopped') return { tone: 'down', label: 'stopped', detail: 'The bot is not running.' };
  if (!status.slackConnected) return { tone: 'down', label: 'Slack disconnected', detail: 'The bot is running but not connected to Slack.' };
  const { needsYou, running } = status.counts;
  const work = `${plural(running, 'job', 'jobs')} running.`;
  if (needsYou > 0) return { tone: 'needs-you', label: 'up', detail: `Slack connected. ${plural(needsYou, 'job needs', 'jobs need')} you. ${work}` };
  return { tone: 'up', label: 'up', detail: `Slack connected. ${work}` };
};

/** The sidebar header: the app's name and its state. */
export const statusHeader = (view: StatusView): string => `Serra · ${view.label}`;
