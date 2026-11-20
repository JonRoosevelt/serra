// The Diagnostics screen's logic (APP-22): the summary line, when a status change should rerun the checks, and the
// plain-text report the Copy button exports. Main has already scrubbed every detail and log line of token values.
import type { BotStatus, Diagnostic } from '../../../src/contracts.ts';
import type { AppInfo } from '../../main/bridge.ts';

export const LOG_LINE_CHOICES = [100, 200, 500, 1000] as const;
export const DEFAULT_LOG_LINES = 200;

export type SummaryTone = 'up' | 'down';

/** "All 9 checks pass" or "2 of 9 checks fail: Tokens, GitHub CLI". */
export const summarize = (results: Diagnostic[]): { tone: SummaryTone; text: string; failing: Diagnostic[] } => {
  const failing = results.filter((result) => !result.ok);
  const total = `${results.length} check${results.length === 1 ? '' : 's'}`;
  if (!failing.length) return { tone: 'up', text: results.length === 1 ? 'The check passes' : `All ${total} pass`, failing };
  return {
    tone: 'down',
    text: `${failing.length} of ${total} ${failing.length === 1 ? 'fails' : 'fail'}: ${failing.map((result) => result.name).join(', ')}`,
    failing,
  };
};

/**
 * What about the daemon's status should rerun the checks: it starting, stopping, restarting (a new pid) or its Slack
 * connection changing. Job counts change all the time and don't matter here.
 */
export const statusKey = (status: BotStatus | null): string => {
  if (!status) return 'unknown';
  if (status.state === 'stopped') return 'stopped';
  return `up:${status.pid}:${status.slackConnected ? 'slack' : 'no-slack'}`;
};

/** The app's own runtime, labelled so nobody mistakes Electron's bundled Node for the bot's. */
export const runtimeLine = (info: Pick<AppInfo, 'version' | 'electron' | 'node'>): string =>
  `Serra app ${info.version} runs on Electron ${info.electron} (bundled Node ${info.node}). The bot runs on its own Node, shown in the Node check.`;

/** A plain-text report for pasting into an issue or a message. */
export const reportText = ({ results, checkedAt, info, log }: {
  results: Diagnostic[];
  checkedAt: Date | null;
  info: Pick<AppInfo, 'version' | 'electron' | 'node' | 'platform'> | null;
  log: string[];
}): string => [
  `Serra diagnostics${checkedAt ? ` (${checkedAt.toISOString()})` : ''}`,
  ...(info ? [`App: Serra ${info.version}, Electron ${info.electron} (bundled Node ${info.node}), ${info.platform}`] : []),
  '',
  summarize(results).text,
  ...results.map((result) => `${result.ok ? 'PASS' : 'FAIL'} ${result.name}: ${result.detail}`),
  ...(log.length ? ['', `Last ${log.length} log line${log.length === 1 ? '' : 's'}:`, ...log] : []),
].join('\n');
