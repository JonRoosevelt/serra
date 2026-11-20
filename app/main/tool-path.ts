// A packaged app opened from Finder gets launchd's PATH (/usr/bin:/bin:/usr/sbin:/sbin), not the login shell's,
// so tools from Homebrew such as `op` (1Password secrets) would not be found (APP-17). Add the usual install
// folders after what is already there.
import { delimiter, join } from 'node:path';

export const toolPath = (current: string | undefined, home: string): string => {
  const parts = (current ?? '').split(delimiter).filter(Boolean);
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin')]) if (!parts.includes(dir)) parts.push(dir);
  return parts.join(delimiter);
};
