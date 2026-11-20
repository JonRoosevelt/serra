// Settings pages (APP-14), on APP-4's services in src/profile-settings.ts. Handlers check the shape of what the
// window sent, call the service and return its result. The service validates the whole profile with
// `validateProfile` before its atomic write, so an invalid value throws here and never reaches disk.
import { readProfileFile } from '../../../src/config.ts';
import type { ProfileSection } from '../../../src/contracts.ts';
import {
  addAllowedUser, isProfileSection, PROFILE_SECTIONS, PROFILE_SETTINGS, removeAllowedUser, updateProfileSection,
  type SettingChange,
} from '../../../src/profile-settings.ts';
import type { Handlers, SavedSection } from '../bridge.ts';
import type { HandlerContext } from './context.ts';

const saved = ({ profile, appliesWhen, changed }: SettingChange): SavedSection => ({ profile, applies: appliesWhen, changed });

const sectionName = (value: unknown): ProfileSection => {
  if (typeof value !== 'string' || !isProfileSection(value)) {
    throw new Error(`Unknown profile section: ${String(value)}. Sections: ${PROFILE_SECTIONS.join(', ')}`);
  }
  return value;
};

const memberId = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('A Slack member ID must be text.');
  return value;
};

export const settingsHandlers = (context: HandlerContext): Handlers<'settings'> => ({
  read: () => readProfileFile(context.profileDir()),
  sections: () => ({ ...PROFILE_SETTINGS }),
  saveSection: (section, value) => {
    const name = sectionName(section);
    // IPC carries `undefined` inside objects poorly; the window sends `null` to remove an optional section.
    return saved(updateProfileSection(context.profileDir(), name, value === null ? undefined : value as never));
  },
  addPerson: (slackUserId) => saved(addAllowedUser(context.profileDir(), memberId(slackUserId))),
  removePerson: (slackUserId) => saved(removeAllowedUser(context.profileDir(), memberId(slackUserId))),
});
