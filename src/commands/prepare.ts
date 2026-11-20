import { loadConfig } from '../config.ts';
import { prepareRelease } from '../deploy.ts';
import { assertHealthy } from '../doctor.ts';
import type { Command } from '../manage.ts';

const command: Command = {
  summary: 'Build and check a release for the profile. Never changes a running service.',
  usage: ['pnpm bot prepare --profile /absolute/profile'],
  async run({ profileDir: directory, log }) {
    const plan = await prepareRelease(directory, { log });
    await assertHealthy(loadConfig({ profileDir: directory, env: {} }));
    log(`Prepared and checked: ${plan.release}\nLive service unchanged.\n\nWhen ready, run:\npnpm bot activate --profile ${JSON.stringify(directory)}\n\nRollback after activation:\npnpm bot rollback --profile ${JSON.stringify(directory)}`);
  },
};
export default command;
