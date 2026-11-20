// The first-run wizard's logic (APP-27): the steps, which one to show, the profile form's checks and how an install
// outcome reads. Pure data and functions: imported by `node --test` as well as the renderer.
import type { ActivationOutcome } from '../../../../src/releases.ts';
import type { ProfileDraft, SetupProgress, SetupStepId } from '../../../../src/setup.ts';

export const WELCOME_PATH = '/welcome';

export interface StepInfo { id: SetupStepId; title: string; summary: string }

/** The wizard's steps, in order. */
export const STEPS: readonly StepInfo[] = [
  { id: 'profile', title: 'Create the profile', summary: 'Name the bot, say who owns it and which repository it works in.' },
  { id: 'slackApp', title: 'Create the Slack app', summary: 'Make the Slack app from the bot’s manifest and install it to your workspace.' },
  { id: 'tokens', title: 'Connect the tokens', summary: 'Store the bot and app tokens in Keychain or point at 1Password, then check them with Slack.' },
  { id: 'owner', title: 'Confirm the owner', summary: 'Check your Slack member ID with the bot’s token, so the bot knows who to ask.' },
  { id: 'service', title: 'Install the service', summary: 'Run every check, then install and start the bot under launchd.' },
];

export type StepState = 'done' | 'current' | 'open' | 'locked';

/**
 * How a step shows in the list. Steps before the first unfinished one stay open to revisit; steps after it are
 * locked until the profile exists (everything else needs it). Tokens and owner can be redone in any order once
 * the profile exists, but the list points at the first unfinished one.
 */
export const stepState = (progress: SetupProgress, id: SetupStepId): StepState => {
  const step = progress.steps.find((item) => item.id === id);
  if (step?.done) return 'done';
  if (progress.next === id) return 'current';
  return progress.profileDir && progress.steps[0]?.done ? 'open' : 'locked';
};

/** The step to show: the one the owner picked if it isn't locked, otherwise the first unfinished one. */
export const visibleStep = (progress: SetupProgress, picked: SetupStepId | null): SetupStepId | 'finished' => {
  if (picked && stepState(progress, picked) !== 'locked') return picked;
  return progress.next ?? 'finished';
};

/** The form as typed. Every field is text so the inputs stay controlled. */
export type DraftForm = Required<Omit<ProfileDraft, 't3Bin' | 'directory'>> & { t3Bin: string; directory: string };

export const emptyDraft = (): DraftForm => ({
  botName: '', botId: '', ownerName: '', ownerSlackUserId: '', githubLogin: '',
  projectPath: '', remote: 'origin', baseRef: '', githubRepo: '', t3Bin: '', directory: '',
});

/** A bot ID from a display name, as `pnpm run setup` suggests it. Kept equal to `suggestBotId` in src/setup.ts. */
export const suggestId = (name: string): string => {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  return id || 'bot';
};

export type DraftErrors = Partial<Record<keyof DraftForm, string>>;

/** Field messages before anything is sent. Main validates again with `validateProfile`. */
export const draftErrors = (draft: DraftForm): DraftErrors => {
  const errors: DraftErrors = {};
  const id = draft.botId.trim() || suggestId(draft.botName);
  if (!draft.botName.trim()) errors.botName = 'Give the bot a name.';
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(id)) errors.botId = 'Start with a letter; use up to 48 lowercase letters, digits or hyphens.';
  if (!draft.ownerName.trim()) errors.ownerName = 'Enter your name.';
  if (!/^[UW][A-Z0-9]+$/.test(draft.ownerSlackUserId.trim())) errors.ownerSlackUserId = 'A member ID looks like U0123456789 (Slack profile › ⋮ › Copy member ID).';
  if (!/^[\w-]+$/.test(draft.githubLogin.trim())) errors.githubLogin = 'Enter your GitHub login.';
  if (!draft.projectPath.trim().startsWith('/')) errors.projectPath = 'Enter the repository’s absolute path.';
  if (!draft.remote.trim() || draft.remote.trim().startsWith('-')) errors.remote = 'Enter the Git remote, usually origin.';
  if (draft.githubRepo.trim() && !/^[\w.-]+\/[\w.-]+$/.test(draft.githubRepo.trim())) errors.githubRepo = 'Use owner/repo.';
  if (draft.t3Bin.trim() && !draft.t3Bin.trim().startsWith('/')) errors.t3Bin = 'Use an absolute path, or leave empty for ~/.t3/bin/t3.';
  if (draft.directory.trim() && !draft.directory.trim().startsWith('/')) errors.directory = 'Use an absolute path, or leave empty.';
  return errors;
};

/** What Create sends: trimmed, with empty optional fields left out so main fills in its defaults. */
export const draftRequest = (draft: DraftForm): ProfileDraft => {
  const request: Record<string, string> = {};
  for (const [key, value] of Object.entries(draft)) if (value.trim()) request[key] = value.trim();
  return request as unknown as ProfileDraft;
};

/** Where the profile will go, for the hint under the folder field. */
export const profileFolder = (draft: DraftForm, root: string): string =>
  draft.directory.trim() || `${root.replace(/\/+$/, '')}/${draft.botId.trim() || suggestId(draft.botName)}`;

/** How an install outcome reads under the Install button. */
export const outcomeText = (outcome: ActivationOutcome): { tone: 'up' | 'down'; text: string } => {
  if (outcome.ok) return { tone: 'up', text: 'The bot is installed and running. It starts again when you log in.' };
  if (outcome.stage === 'checks') return { tone: 'down', text: `Nothing was installed. Fix this and try again: ${outcome.error}` };
  if (outcome.restored) return { tone: 'down', text: `The bot didn’t start, and nothing changed: ${outcome.error}` };
  return { tone: 'down', text: `The bot didn’t start: ${outcome.error}. Open Updates and roll back.` };
};
