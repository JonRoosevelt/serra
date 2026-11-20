import { existsSync, readFileSync } from 'node:fs';
import { loadConfig } from '../config.ts';
import { launchd } from '../deploy.ts';
import type { Command } from '../manage.ts';

const command: Command = {
  summary: 'Show whether the service is loaded and which release is active.',
  usage: ['pnpm bot status --profile /absolute/profile'],
  macOnly: true,
  async run({ profileDir: directory, log }) {
    const config = loadConfig({ profileDir: directory, env: {} });
    log(`Service ${config.serviceLabel}: ${await launchd.loaded(config.serviceLabel) ? 'loaded' : 'stopped'}`);
    log(`Profile: ${directory}\nLogs: ${directory}/logs/bot.log`);
    if (existsSync(`${directory}/active.json`)) log(`Active release: ${JSON.parse(readFileSync(`${directory}/active.json`, 'utf8')).release}`);
    else log('No release activated for this profile.');
  },
};
export default command;
