import { cleanupWorktrees, formatCleanup } from '../cleanup.ts';
import { loadConfig } from '../config.ts';
import type { Command } from '../manage.ts';

const command: Command = {
  summary: 'List job worktrees that are quiet, clean, pushed and without an open PR. --apply removes them.',
  usage: ['pnpm bot cleanup --profile /absolute/profile [--days 3] [--apply]'],
  async run({ option, flag, profileDir, log }) {
    // Reads state.json and never writes it. Only worktrees under ~/.t3/worktrees are ever removed.
    const config = loadConfig({ profileDir, env: {} });
    const daysOption = option('--days');
    const days = daysOption === undefined ? 3 : Number(daysOption);
    if (!Number.isFinite(days) || days < 0) throw new Error('--days needs a number of days, like 3');
    const apply = flag('--apply');
    const verdicts = await cleanupWorktrees({ statePath: config.statePath, t3Bin: config.t3Bin, days, apply });
    log(formatCleanup(verdicts, apply));
  },
};
export default command;
