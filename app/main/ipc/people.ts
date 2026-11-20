// People (APP-16): allowing a Slack member, on APP-4's `addAllowedUser`. The ⌘K action and the People screen's
// Add button both call this.
import { addAllowedUser } from '../../../src/profile-settings.ts';
import type { Handlers } from '../bridge.ts';
import type { HandlerContext } from './context.ts';

export const peopleHandlers = (context: HandlerContext): Handlers<'people'> => ({
  add: (slackUserId) => {
    if (typeof slackUserId !== 'string') throw new Error('Enter a Slack member ID.');
    const change = addAllowedUser(context.profileDir(), slackUserId);
    return { slackUserId: slackUserId.trim(), changed: change.changed, applies: change.appliesWhen };
  },
});
