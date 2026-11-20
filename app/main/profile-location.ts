// Where the app finds the bot profile (APP-17). A packaged app opened from Finder gets no `--profile` and no
// `BOT_PROFILE`, so it falls back to the folder it was given before, then to the only profile `pnpm run setup` made.
import { existsSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

/** Profile folders directly under `root` (`~/.local/share/serra/<bot-id>`, where `pnpm run setup` puts them). */
export const profilesUnder = (root: string): string[] => {
  let names: string[];
  try { names = readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); }
  catch { return []; }
  return names.map((name) => join(root, name)).filter((dir) => existsSync(join(dir, 'profile.json')));
};

export interface ProfileSources {
  /** `--profile` or `BOT_PROFILE`, when given. */
  argument?: string;
  /** The folder saved in app prefs. */
  saved: string | null;
  /** Profile folders found in the default location. Only used when there is exactly one. */
  discovered: readonly string[];
}

/** The profile the app starts with: the argument, then the saved folder, then the only discovered profile. */
export const startupProfile = ({ argument, saved, discovered }: ProfileSources): string | null => {
  if (argument) return resolve(argument);
  if (saved) return saved;
  return discovered.length === 1 ? discovered[0] ?? null : null;
};

/** The folder to save in prefs so the next launch from Finder finds the same profile, or null to leave prefs as they are. */
export const profileToRemember = (startup: string | null, saved: string | null): string | null =>
  startup && isAbsolute(startup) && startup !== saved ? startup : null;
