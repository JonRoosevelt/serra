import type { Command } from '../manage.ts';
import { addAllowedUser, appliesLabel, listPeople, removeAllowedUser } from '../profile-settings.ts';

/** Arguments after the command name, without `--profile <folder>`. */
const positionals = (args: string[]): string[] => args.slice(1).filter((arg, index, rest) => arg !== '--profile' && rest[index - 1] !== '--profile');

const command: Command = {
  summary: 'List, add or remove the Slack members allowed to use the bot. The owner is always allowed.',
  usage: [
    'pnpm bot people --profile /absolute/profile',
    'pnpm bot people add U0123456789 --profile /absolute/profile',
    'pnpm bot people remove U0123456789 --profile /absolute/profile',
  ],
  async run({ args, profileDir, log }) {
    const [action = 'list', id, ...extra] = positionals(args);
    if (extra.length) throw new Error(`Unexpected arguments: ${extra.join(' ')}`);
    if (action === 'list') {
      if (id) throw new Error('people list takes no member ID');
      for (const person of listPeople(profileDir)) log(`${person.slackUserId}  ${person.access}${person.name ? `  ${person.name}` : ''}`);
      return;
    }
    if (action !== 'add' && action !== 'remove') throw new Error(`Unknown people action: ${action}. Use list, add or remove.`);
    if (!id) throw new Error(`people ${action} needs a Slack member ID, like U0123456789`);
    const result = action === 'add' ? addAllowedUser(profileDir, id) : removeAllowedUser(profileDir, id);
    if (!result.changed) log(action === 'add' ? `${id} is already allowed. Nothing changed.` : `${id} is not in allowedUsers. Nothing changed.`);
    else log(`${action === 'add' ? 'Added' : 'Removed'} ${id}. ${appliesLabel(result.appliesWhen)}.`);
  },
};
export default command;
