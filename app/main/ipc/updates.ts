// Updates (APP-19), on APP-18's release service in src/releases.ts. Handlers only check input and call it; the one
// thing they add is the app's own activity: one action at a time, and its log lines pushed to the window and kept so
// the screen shows them again after navigating away. Everything reads and writes the profile's files and launchd
// directly, so it works while the daemon is stopped.
import { delimiter, dirname } from 'node:path';
import {
  activateRelease, findNode, prepareNextRelease, releaseStatus, rollbackRelease, runningJobs,
  type StatusOptions,
} from '../../../src/releases.ts';
import type { DeployOptions, PrepareOptions } from '../../../src/deploy.ts';
import type { Handlers } from '../bridge.ts';
import type { HandlerContext } from './context.ts';

export type UpdateAction = 'prepare' | 'activate' | 'rollback';

export interface UpdatesDeps {
  /** Finds the real Node binary for the release (APP-18's `findNode`). Tests pass a fake. */
  findNode?: (profileDir: string) => Promise<string>;
  /** Extra prepare options (tests: `root`, `install: false`). `node` and `log` are always set here. */
  prepare?: Omit<PrepareOptions, 'node' | 'log'>;
  /** Extra activate/rollback options (tests: a fake launchd driver). `log` is always set here. */
  deploy?: Omit<DeployOptions, 'log'>;
  /** Extra status options (tests: the code checkout to count commits in). */
  status?: Omit<StatusOptions, 'fetch'>;
  /** Where the log lines go besides the window (default: the main process's console). */
  echo?: (line: string) => void;
}

/** The most lines kept for the screen; `pnpm install` can be chatty. */
const MAX_LOG_LINES = 500;

/** Puts the Node binary's folder first on PATH, as the service plist does, so `pnpm` beside it is found from Finder. */
const nodeOnPath = (node: string): void => {
  const folder = dirname(node);
  const path = process.env.PATH ?? '';
  if (!path.split(delimiter).includes(folder)) process.env.PATH = path ? `${folder}${delimiter}${path}` : folder;
};

export const updatesHandlers = (context: HandlerContext, deps: UpdatesDeps = {}): Handlers<'updates'> => {
  const find = deps.findNode ?? ((profileDir: string) => findNode(profileDir));
  const echo = deps.echo ?? ((line: string) => console.log(`[serra] ${line}`));
  let running: UpdateAction | null = null;
  let log: string[] = [];

  const line = (text: string): void => {
    for (const part of text.split('\n')) {
      log.push(part);
      if (log.length > MAX_LOG_LINES) log.splice(0, log.length - MAX_LOG_LINES);
      echo(part);
      context.push?.('releaseLog', part);
    }
  };

  /** Runs one action at a time: a second one while the first runs is refused before anything changes. */
  const exclusive = async <T>(action: UpdateAction, work: (profileDir: string) => Promise<T>): Promise<T> => {
    if (running) throw new Error(`${running[0]!.toUpperCase()}${running.slice(1)} is still running. Wait for it to finish.`);
    const profileDir = context.profileDir();
    running = action;
    log = [];
    try { return await work(profileDir); }
    finally { running = null; }
  };

  return {
    status: async (options) => ({
      ...await releaseStatus(context.profileDir(), { ...deps.status, fetch: options?.fetch === true }),
      running,
      log: [...log],
    }),
    runningJobs: () => runningJobs(context.profileDir()),
    // Inside Electron `process.execPath` is Electron, so the release always gets the Node `findNode` resolved.
    prepare: () => exclusive('prepare', async (profileDir) => {
      try {
        line('Looking for Node');
        const node = await find(profileDir);
        line(`Using ${node}`);
        nodeOnPath(node);
        return await prepareNextRelease(profileDir, { ...deps.prepare, node, log: line });
      } catch (error) { line(`Prepare failed: ${error instanceof Error ? error.message : String(error)}`); throw error; }
    }),
    activate: () => exclusive('activate', async (profileDir) => {
      const outcome = await activateRelease(profileDir, { ...deps.deploy, log: line });
      if (!outcome.ok && outcome.stage === 'checks') line(`Activation refused: ${outcome.error}`);
      return outcome;
    }),
    rollback: () => exclusive('rollback', async (profileDir) => {
      const outcome = await rollbackRelease(profileDir, { ...deps.deploy, log: line });
      if (!outcome.ok) line(`Rollback failed: ${outcome.error}`);
      return outcome;
    }),
  };
};
