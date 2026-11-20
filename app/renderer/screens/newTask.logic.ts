// Pure helpers for the New task screen (APP-25), kept free of React so `node --test` covers them.
import type { StartedTask } from '../../../src/tasks.ts';

/** The longest request the main process accepts: `MAX_TASK_REQUEST` in src/tasks.ts (a test checks they match). */
export const MAX_REQUEST = 20_000;

/** Why the request can't be started yet, or null when it can. An empty box isn't an error, just not ready. */
export const requestProblem = (text: string): string | null => {
  const length = text.trim().length;
  if (length > MAX_REQUEST) return `${length.toLocaleString('en-US')} characters. Keep it under ${MAX_REQUEST.toLocaleString('en-US')}.`;
  return null;
};

export const canStart = (text: string, busy: boolean): boolean => !busy && text.trim() !== '' && requestProblem(text) === null;

/** The line shown once a task started: what T3 calls it and the branch its worktree is on. */
export const startedText = (task: Pick<StartedTask, 'title' | 'branch'>): string =>
  `Started “${task.title}” on ${task.branch}.`;

/** A T3 link the window may open: `https:` only, as on the Jobs screen. */
export const taskLink = (task: Pick<StartedTask, 'link'>): string | undefined =>
  task.link && /^https:\/\//.test(task.link) ? task.link : undefined;
