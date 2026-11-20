import { resolve } from 'node:path';
import { loadConfig, profileArgument } from './config.ts';
import { interviewBrief } from './tasks.ts';

const directory = profileArgument();
if (!directory) throw new Error('Choose a profile: pnpm onboard --profile /absolute/profile/folder');
// Only profile.json: the interview needs no Slack tokens.
const config = loadConfig({ profileDir: resolve(directory), env: {} });
console.log(`The Serra app starts this interview for you: Knowledge, Proposals, then Start interview.
Without the app, start a new T3 thread in ${config.project} and paste:

${interviewBrief(config)}`);
