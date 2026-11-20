import type { MessageTrigger } from './config.ts';

/** Match actual Slack identities, preferring a sender-specific rule over a channel-wide rule. */
export const matchMessageTrigger = (triggers: readonly MessageTrigger[], channel: string,
  sender: { botId?: string; userId?: string }): MessageTrigger | undefined => {
  const rules = triggers.filter((rule) => rule.channel === channel);
  return rules.find((rule) => sender.botId
    ? rule.botId?.trim() === sender.botId
    : Boolean(sender.userId) && rule.userId?.trim() === sender.userId)
    ?? rules.find((rule) => !rule.botId?.trim() && !rule.userId?.trim());
};
