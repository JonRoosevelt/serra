import { readFileSync } from 'node:fs';
import type { Command } from '../manage.ts';
import {
  appliesLabel, isProfileSection, PROFILE_SECTIONS, readProfileSettings, updateProfileSection,
} from '../profile-settings.ts';

/** Arguments after the command name, without `--profile <folder>` and `--file <path>`. */
const positionals = (args: string[]): string[] =>
  args.slice(1).filter((arg, index, rest) => !['--profile', '--file'].includes(arg) && !['--profile', '--file'].includes(rest[index - 1]!));

const sectionArgument = (name: string | undefined, action: string): string => {
  if (!name) throw new Error(`settings ${action} needs a section: ${PROFILE_SECTIONS.join(', ')}`);
  if (!isProfileSection(name)) throw new Error(`Unknown profile section: ${name}. Sections: ${PROFILE_SECTIONS.join(', ')}`);
  return name;
};

const parseJson = (text: string): unknown => {
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`The value must be JSON: ${error instanceof Error ? error.message : String(error)}`); }
};

const command: Command = {
  summary: 'Show profile.json sections and when changes apply, or replace one section after validating it.',
  usage: [
    'pnpm bot settings --profile /absolute/profile',
    'pnpm bot settings show worker --profile /absolute/profile',
    'pnpm bot settings set worker \'{"model":"example-model"}\' --profile /absolute/profile',
    'pnpm bot settings set repositories --file repositories.json --profile /absolute/profile',
    'pnpm bot settings unset review --profile /absolute/profile',
  ],
  async run({ args, option, profileDir, log }) {
    const [action = 'list', name, text, ...extra] = positionals(args);
    if (extra.length) throw new Error(`Unexpected arguments: ${extra.join(' ')}`);
    const views = readProfileSettings(profileDir);
    if (action === 'list') {
      const width = Math.max(...views.map((view) => view.section.length));
      for (const view of views) {
        log(`${view.section.padEnd(width)}  ${view.value === undefined ? 'not set' : 'set    '}  ${appliesLabel(view.appliesWhen)}${view.note ? `. ${view.note}` : ''}`);
      }
      return;
    }
    const section = sectionArgument(name, action);
    if (action === 'show') {
      const view = views.find((item) => item.section === section)!;
      log(view.value === undefined ? `${section} is not set.` : JSON.stringify(view.value, null, 2));
      log(`${appliesLabel(view.appliesWhen)}.`);
      return;
    }
    if (action !== 'set' && action !== 'unset') throw new Error(`Unknown settings action: ${action}. Use list, show, set or unset.`);
    let value: unknown;
    if (action === 'set') {
      const file = option('--file');
      if (file && text !== undefined) throw new Error('Give the value inline or with --file, not both');
      if (!file && text === undefined) throw new Error(`settings set ${section} needs a JSON value or --file path`);
      value = parseJson(file ? readFileSync(file, 'utf8') : text!);
      if (value === null) throw new Error(`Use settings unset ${section} to remove a section`);
    } else if (text !== undefined) throw new Error('settings unset takes no value');
    // The CLI passes untyped JSON; validateProfile inside the service decides whether it fits.
    const result = updateProfileSection(profileDir, section as never, value as never);
    if (!result.changed) log(`${section} already has that value. Nothing changed.`);
    else log(`${action === 'set' ? 'Saved' : 'Removed'} ${section}. ${appliesLabel(result.appliesWhen)}.`);
  },
};
export default command;
