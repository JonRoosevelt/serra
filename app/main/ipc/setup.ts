// First-run wizard (APP-27), on the setup service in `src/setup.ts`. Handlers check input, call the service and
// return plain data. Tokens are set through the `secrets` namespace (APP-15), so no value passes through here; the
// owner check resolves the bot token in this process and only Slack's answer, scrubbed, goes back to the window.
import { delimiter, dirname, resolve } from 'node:path';
import { defaultProfileRoot } from '../../../src/config.ts';
import { findNode } from '../../../src/releases.ts';
import { scrub } from '../../../src/secrets.ts';
import {
  confirmOwner, createSetupProfile, detectGithubLogin, detectProject, installService, setupProgress, slackManifest,
  type InstallOptions, type MemberLookup, type ProfileDraft,
} from '../../../src/setup.ts';
import type { Handlers } from '../bridge.ts';
import { mergePrefs } from '../prefs.ts';
import type { HandlerContext } from './context.ts';

export interface SetupDeps {
  /** Where new profiles go by default (tests: a temp folder). */
  root?: string;
  /** Finds the real Node binary for launchd (tests: a fake). */
  findNode?: (profileDir: string) => Promise<string>;
  /** Extra install options (tests: fake launchd driver, fake Slack check, no `pnpm install`). */
  install?: Omit<InstallOptions, 'node' | 'log'>;
  /** Slack's member lookup for the owner check (tests: a fake). */
  lookup?: MemberLookup;
  /** GitHub login detection (tests: a fake, so they don't run `gh`). */
  githubLogin?: () => Promise<string>;
  /** Where log lines go besides the window (default: the main process's console). */
  echo?: (line: string) => void;
}

const DRAFT_FIELDS = [
  'botName', 'botId', 'ownerName', 'ownerSlackUserId', 'githubLogin', 'projectPath', 'remote', 'baseRef', 'githubRepo', 't3Bin', 'directory',
] as const satisfies readonly (keyof ProfileDraft)[];

/** Copies only the known text fields, so nothing else from the window reaches the service. */
const parseDraft = (value: unknown): ProfileDraft => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('The setup form must be an object.');
  const draft: Record<string, string> = {};
  for (const field of DRAFT_FIELDS) {
    const item = (value as Record<string, unknown>)[field];
    if (item === undefined || item === null) continue;
    if (typeof item !== 'string') throw new Error(`${field} must be text.`);
    draft[field] = item;
  }
  return draft as unknown as ProfileDraft;
};

/** Puts the Node binary's folder first on PATH, as the service plist does, so `pnpm` beside it is found from Finder. */
const nodeOnPath = (node: string): void => {
  const folder = dirname(node);
  const path = process.env.PATH ?? '';
  if (!path.split(delimiter).includes(folder)) process.env.PATH = path ? `${folder}${delimiter}${path}` : folder;
};

export const setupHandlers = (context: HandlerContext, deps: SetupDeps = {}): Handlers<'setup'> => {
  const root = deps.root ?? defaultProfileRoot;
  const find = deps.findNode ?? ((profileDir: string) => findNode(profileDir));
  const echo = deps.echo ?? ((line: string) => console.log(`[serra] ${line}`));
  let installing = false;

  const line = (text: string): void => {
    for (const part of scrub(text).split('\n')) {
      echo(part);
      context.push?.('releaseLog', part);
    }
  };

  return {
    progress: () => setupProgress(context.profileDirOrNull()),

    defaults: async () => ({ githubLogin: await (deps.githubLogin ?? detectGithubLogin)(), profileRoot: root }),

    detectProject: (path, remote) => {
      if (typeof path !== 'string') throw new Error('The repository path must be text.');
      if (remote !== undefined && typeof remote !== 'string') throw new Error('The remote must be text.');
      return detectProject(path.trim(), remote?.trim() || 'origin');
    },

    create: async (value) => {
      const directory = await createSetupProfile(parseDraft(value), { root });
      // Remember the new profile so the app (and its next launch from Finder) manages it.
      context.prefs.set(mergePrefs(context.prefs.get(), { profileDir: directory }));
      const current = context.profileDirOrNull();
      if (!current || resolve(current) !== directory) {
        throw new Error(`Profile created at ${directory}, but the app was started with --profile ${current}. Quit and open Serra without --profile to finish setting it up.`);
      }
      return setupProgress(directory);
    },

    manifest: () => slackManifest(context.profileDir()),

    confirmOwner: (slackUserId) => {
      if (typeof slackUserId !== 'string') throw new Error('The member ID must be text.');
      return confirmOwner(context.profileDir(), slackUserId, deps.lookup ? { lookup: deps.lookup } : {});
    },

    installService: async () => {
      if (context.runtime.platform !== 'darwin') throw new Error('The background service uses launchd, so it installs on macOS only.');
      const profileDir = context.profileDir();
      if (installing) throw new Error('The service is already being installed. Wait for it to finish.');
      installing = true;
      try {
        line('Looking for Node');
        const node = await find(profileDir);
        line(`Using ${node}`);
        nodeOnPath(node);
        const outcome = await installService(profileDir, { ...deps.install, node, log: line });
        line(outcome.ok ? `Installed and started ${outcome.release}` : `Not installed: ${outcome.error}`);
        return outcome;
      } catch (error) {
        const message = scrub(error instanceof Error ? error.message : String(error));
        line(`Install failed: ${message}`);
        throw new Error(message);
      } finally { installing = false; }
    },
  };
};
