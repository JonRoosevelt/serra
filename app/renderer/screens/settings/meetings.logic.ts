// Settings › Meetings, the pure half (SERRA-63): what the "Runs on" row says about the provider meetings use.
import type { MeetingProviderView } from '../../../../src/meeting-runtime.ts';

type Tone = 'up' | 'warn';

export interface ProviderLine {
  title: string;
  badge: { label: string; tone: Tone };
  detail: string;
  /** Granola, Meet and file rows: only for a provider meetings can run on. Never another provider's. */
  showSources: boolean;
}

const WHY: Record<NonNullable<NonNullable<MeetingProviderView['provider']>['chosenBy']>, string> = {
  profile: 'Your worker provider',
  't3-project': "This project's default provider in T3",
  't3-default': "T3's default provider",
};

/** The row for a provider check: supported and ready, supported but failing its checks, or not supported yet. */
export const providerLine = (view: MeetingProviderView): ProviderLine => {
  const title = `Runs on ${view.provider?.label ?? 'an unknown provider'}`;
  if (view.unsupported) return { title, badge: { label: 'Not supported yet', tone: 'warn' }, detail: view.unsupported, showSources: false };
  if (!view.extraction?.ok) {
    return { title, badge: { label: 'Not ready', tone: 'warn' }, detail: view.extraction?.reason ?? 'Serra couldn\'t check this provider.', showSources: false };
  }
  const why = view.provider?.chosenBy ? WHY[view.provider.chosenBy] : 'The provider your jobs use';
  return { title, badge: { label: 'Ready', tone: 'up' }, detail: `${why}. It passed Serra's no-tools self-test.`, showSources: true };
};
