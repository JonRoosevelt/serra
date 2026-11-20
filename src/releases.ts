/**
 * Release status and the owner's update actions, for the CLI and the app's Updates screen.
 *
 * Builds on `deploy.ts`: prepare snapshots the code, activate switches launchd to it (draining the old daemon and
 * restoring the previous installation when the new one fails to start), rollback switches back. These wrappers add
 * a read-only status, a preflight that lists running jobs, streamed log lines and results the UI can act on.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join, resolve } from 'node:path';
import { codeRoot } from './config.ts';
import type { ReleaseStatus } from './contracts.ts';
import {
  activate, activationPhase, CutoverError, preparedProblems, prepareRelease, rollback,
  type DeployLog, type DeployOptions, type Prepared, type PrepareOptions,
} from './deploy.ts';
import { createStore } from './state.ts';
import { run } from './t3.ts';

const readRelease = (path: string): Prepared | null => existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as Prepared : null;
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);

// ---------------------------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------------------------

export interface ReleaseOverview extends ReleaseStatus {
  /** The ref new commits were counted on, like `origin/main`. Null when no ref was found. */
  ref: string | null;
  /** Why `newCommits` couldn't be listed. Null when the list is real (an empty list then means up to date). */
  commitsProblem: string | null;
  /** The last cutover: none yet, interrupted (`switching`), done (`active`) or undone (`rolled-back`). */
  activation: 'switching' | 'active' | 'rolled-back' | null;
  /** Rollback can run: the last cutover is active or was interrupted. */
  canRollback: boolean;
  /** Why the prepared release can't be activated right now. Empty when it can. */
  activateProblems: string[];
}

export interface StatusOptions {
  /** The code checkout whose commits are compared. Defaults to the code this module runs from. */
  root?: string;
  /** The ref to compare against. Defaults to `origin/main`, then `main`, whichever exists. */
  ref?: string;
  /** Run `git fetch origin main` first. Off by default so status stays fast and offline. */
  fetch?: boolean;
}

const git = (root: string, args: string[]): Promise<string> => run('git', ['-C', root, ...args], { timeoutMs: 30_000 });
const refExists = async (root: string, ref: string): Promise<boolean> => {
  try { await git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]); return true; } catch { return false; }
};

const listNewCommits = async (root: string, active: Prepared | null, options: StatusOptions):
Promise<Pick<ReleaseOverview, 'ref' | 'newCommits' | 'commitsProblem'>> => {
  const none = (commitsProblem: string, ref: string | null = null) => ({ ref, newCommits: [], commitsProblem });
  if (options.fetch) {
    try { await git(root, ['fetch', '--quiet', 'origin', 'main']); }
    catch (error) { return none(`Fetching origin failed: ${errorText(error)}`); }
  }
  let ref = options.ref;
  if (!ref) for (const candidate of ['origin/main', 'main']) if (await refExists(root, candidate)) { ref = candidate; break; }
  if (!ref || !await refExists(root, ref)) return none(`No ${ref ?? 'main'} branch in ${root}`);
  if (!active) return none('No active release to compare with', ref);
  if (!active.commit) return none('The active release does not record its commit. Prepare and activate a new release to track commits.', ref);
  try {
    const out = await git(root, ['log', '--max-count=200', '--format=%H%x1f%s', `${active.commit}..${ref}`]);
    const newCommits = out.split('\n').filter(Boolean).map((line) => {
      const [sha = '', subject = ''] = line.split('\x1f');
      return { sha, subject };
    });
    return { ref, newCommits, commitsProblem: null };
  } catch (error) { return none(`Could not compare ${active.commit.slice(0, 12)} with ${ref}: ${errorText(error)}`, ref); }
};

/** Active release, prepared release and new commits on `main`. Reads files and git only; works while the bot is stopped. */
export const releaseStatus = async (directory: string, options: StatusOptions = {}): Promise<ReleaseOverview> => {
  directory = resolve(directory);
  const active = readRelease(join(directory, 'active.json'));
  const preparedFile = readRelease(join(directory, 'prepared.json'));
  // prepared.json stays after activation; it is only "prepared" while it isn't the active one.
  const prepared = preparedFile && preparedFile.release !== active?.release ? preparedFile : null;
  const activation = activationPhase(directory);
  let activateProblems: string[];
  try { activateProblems = prepared ? preparedProblems(directory) : ['No prepared release. Run prepare first.']; }
  catch (error) { activateProblems = [errorText(error)]; }
  return {
    active, prepared, activation,
    canRollback: activation === 'active' || activation === 'switching',
    activateProblems,
    ...await listNewCommits(options.root ?? codeRoot, active, options),
  };
};

// ---------------------------------------------------------------------------------------------------------------
// Activation preflight
// ---------------------------------------------------------------------------------------------------------------

/** A job whose worker the bot is still following. Its T3 run keeps going during a restart; replies resume after. */
export interface RunningJob {
  key: string;
  requester: string;
  channel: string;
  t3ThreadId: string;
  createdAt: string;
  lastActivityAt: string;
}

export interface ActivationPreflight {
  prepared: Prepared | null;
  active: Prepared | null;
  /** Why activation would be refused. Empty when it can go ahead. */
  problems: string[];
  /** Jobs running now, most recently active first, so the owner can choose a quiet moment. */
  runningJobs: RunningJob[];
}

/** Jobs the bot is following now, read from `state.json` without writing it. */
export const runningJobs = (directory: string): RunningJob[] => createStore(join(resolve(directory), 'state.json')).allJobs()
  .filter(([, job]) => job.watching)
  .map(([key, job]) => ({
    key, requester: job.requester, channel: job.channel, t3ThreadId: job.t3ThreadId,
    createdAt: job.createdAt, lastActivityAt: job.lastActivityAt ?? job.createdAt,
  }))
  .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

/** What the owner sees before Activate: whether it can run and which jobs a restart would pause. Reads files only. */
export const activationPreflight = (directory: string): ActivationPreflight => {
  directory = resolve(directory);
  const active = readRelease(join(directory, 'active.json'));
  const preparedFile = readRelease(join(directory, 'prepared.json'));
  let problems: string[];
  try { problems = preparedProblems(directory); } catch (error) { problems = [errorText(error)]; }
  let jobs: RunningJob[] = [];
  try { jobs = runningJobs(directory); } catch (error) { problems.push(`Could not read state.json: ${errorText(error)}`); }
  return { prepared: preparedFile && preparedFile.release !== active?.release ? preparedFile : null, active, problems, runningJobs: jobs };
};

// ---------------------------------------------------------------------------------------------------------------
// Node binary
// ---------------------------------------------------------------------------------------------------------------

/** Node versions the daemon supports, from package.json `engines`: `^22.18.0 || >=24.0.0`. */
export const supportedNode = (version: string): boolean => {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return (major === 22 && minor >= 18) || major >= 24;
};

const probeNode = async (path: string): Promise<{ node: string; electron: string }> => {
  const [node = '', electron = ''] = (await run(path, ['-p', 'process.versions.node + " " + (process.versions.electron ?? "")'], { timeoutMs: 5_000 })).trim().split(' ');
  return { node, electron };
};

/** The Node binaries nvm installed under `root`, newest version first. */
export const nvmNodes = (root: string): string[] => {
  let versions: string[];
  try { versions = readdirSync(root).filter((name) => /^v\d+\.\d+\.\d+$/.test(name)); } catch { return []; }
  const parts = (name: string): number[] => name.slice(1).split('.').map(Number);
  return versions
    .sort((a, b) => { const [x, y] = [parts(a), parts(b)]; return (y[0]! - x[0]!) || (y[1]! - x[1]!) || (y[2]! - x[2]!); })
    .map((name) => join(root, name, 'bin/node'));
};

/**
 * Find a real Node binary for launchd and the release scripts. Inside the app `process.execPath` is Electron, so
 * prepare must be given this instead. Tries the Node the active and prepared releases use, then `PATH` and the
 * usual Homebrew, Volta and nvm folders. Only files named `node` that report a supported version and no Electron are accepted.
 */
export const findNode = async (directory: string, {
  candidates, probe = probeNode,
}: { candidates?: string[]; probe?: (path: string) => Promise<{ node: string; electron: string }> } = {}): Promise<string> => {
  directory = resolve(directory);
  const list = candidates ?? [
    readRelease(join(directory, 'active.json'))?.node,
    readRelease(join(directory, 'prepared.json'))?.node,
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean).map((dir) => join(dir, 'node')),
    '/opt/homebrew/bin/node', '/usr/local/bin/node', join(homedir(), '.volta/bin/node'),
    // Opened from Finder, the app's PATH has no nvm: its installs are found in its folder.
    ...nvmNodes(join(homedir(), '.nvm/versions/node')),
  ].filter((path): path is string => Boolean(path));
  const tried: string[] = [];
  for (const path of [...new Set(list)]) {
    if (basename(path) !== 'node' || !existsSync(path)) continue;
    try {
      const { node, electron } = await probe(path);
      if (!electron && supportedNode(node)) return path;
      tried.push(`${path} (${electron ? 'Electron' : `Node ${node}`})`);
    } catch (error) { tried.push(`${path} (${errorText(error)})`); }
  }
  throw new Error(`No supported Node (22.18+ or 24+) found${tried.length ? `. Tried: ${tried.join(', ')}` : ''}. Install Node or pass its path.`);
};

// ---------------------------------------------------------------------------------------------------------------
// Actions with streamed log lines
// ---------------------------------------------------------------------------------------------------------------

/**
 * Snapshot the code into a new release and install its dependencies. The live service is untouched.
 * Inside Electron, finds a real Node when `node` isn't given, so launchd never runs the bot with Electron.
 */
export const prepareNextRelease = async (directory: string, options: PrepareOptions = {}): Promise<Prepared> => {
  const node = options.node ?? (process.versions.electron ? await findNode(directory) : undefined);
  return prepareRelease(directory, { ...options, ...(node ? { node } : {}) });
};

export type ActivationOutcome =
  | { ok: true; release: string }
  | {
    ok: false;
    /** `checks`: refused before anything changed. `cutover`: failed after the old bot was stopped. */
    stage: 'checks' | 'cutover';
    error: string;
    /** The previous installation is running again (or nothing was touched). */
    restored: boolean;
    /** The owner should run rollback: the automatic restore didn't finish. */
    rollbackAvailable: boolean;
  };

/** Switch the service to the prepared release. Never throws: the outcome says what happened and what to offer next. */
export const activateRelease = async (directory: string, options: DeployOptions = {}): Promise<ActivationOutcome> => {
  try {
    await activate(directory, options);
    return { ok: true, release: readRelease(join(resolve(directory), 'active.json'))!.release };
  } catch (error) {
    const cutover = error instanceof CutoverError;
    const phase = activationPhase(directory);
    return {
      ok: false, stage: cutover ? 'cutover' : 'checks', error: errorText(error),
      restored: cutover ? error.restored : true,
      rollbackAvailable: phase === 'switching' || (cutover && !error.restored),
    };
  }
};

export type RollbackOutcome = { ok: true; release: string | null } | { ok: false; error: string };

/** Switch back to the installation before the last activation. `release` is the one now active, or null for none. */
export const rollbackRelease = async (directory: string, options: DeployOptions = {}): Promise<RollbackOutcome> => {
  try {
    await rollback(directory, options);
    return { ok: true, release: readRelease(join(resolve(directory), 'active.json'))?.release ?? null };
  } catch (error) { return { ok: false, error: errorText(error) }; }
};

export type { DeployLog };
