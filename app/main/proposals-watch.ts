// Pushes `proposals` to the window when the profile's `knowledge/proposals/` changes (APP-26), so a proposal written
// by a worker or the knowledge interview shows in the Proposals queue without a restart or a click. It follows the
// profile when Settings picks another one. Free of Electron, so tests drive it with a real folder.
import { join } from 'node:path';
import { watchProposals, type ProfileWatcher } from '../../src/profile-reload.ts';

export interface ProposalsFollower {
  /** Watches this profile's proposals instead, or nothing for null. The same folder again changes nothing. */
  follow(profileDir: string | null): void;
  close(): void;
}

export const followProposals = (
  changed: () => void,
  { debounceMs = 200, log = (message: string) => console.error(message) }: { debounceMs?: number; log?: (message: string) => void } = {},
): ProposalsFollower => {
  let current: string | null = null;
  let watcher: ProfileWatcher | null = null;
  return {
    follow(profileDir) {
      if (profileDir === current) return;
      watcher?.close();
      watcher = null;
      current = profileDir;
      if (!profileDir) return;
      // A watcher that fails only costs the live refresh: the screen still rereads on focus and daemon events.
      // The message names the folder, never anything read from it.
      watcher = watchProposals(join(profileDir, 'knowledge'), changed, {
        debounceMs,
        onError: (error) => log(`[serra] not watching ${join(profileDir, 'knowledge', 'proposals')}: ${error.message}`),
      });
    },
    close() {
      watcher?.close();
      watcher = null;
      current = null;
    },
  };
};
