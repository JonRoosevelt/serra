// Which provider meeting capture runs on (SERRA-63): the one Serra's jobs run on, from the T3 provider layer
// (providers.ts): the profile's `worker.provider`, else T3's default. Its own CLI fetches the transcript through its
// own Granola or Drive connection, and extracts in its strictest no-tools mode, behind the same self-test.
//
// Claude and Codex have adapters. Any other provider gets a plain "can't run on X yet", and capture is refused:
// Serra never falls back to another provider, because the owner chose where their jobs, and their meetings, go.
import { createCodexAdapter } from './meeting-codex.ts';
import { createExtractor } from './meeting-extractor.ts';
import { createSourceReader, type Fetched, type MeetingLink, type ProviderStatus } from './meeting-sources.ts';
import { jobProvider, providerEntries, readT3Providers, type T3ProviderSettings } from './providers.ts';
import type { ProviderEntry } from './tool-catalog.ts';

/** What meeting capture needs from a provider: the same contract for every adapter. */
export interface MeetingRuntime {
  provider: ProviderEntry;
  /** Run the extractor on a prompt: preflight, self-test once per binary, then the launch. Throws why not. */
  extract: (prompt: string) => Promise<string>;
  fetchTranscript: (link: MeetingLink) => Promise<Fetched>;
  /** Whether Granola and Meet can be read through this provider now. */
  sources: () => Promise<ProviderStatus[]>;
  /** Whether extraction is ready, without a model call. */
  check: () => Promise<{ ok: boolean; reason: string | null }>;
}

export type MeetingRuntimeChoice = { runtime: MeetingRuntime; unsupported: null } | { runtime: null; provider: ProviderEntry | null; unsupported: string };

export interface RuntimeOptions {
  /** PATH to find provider CLIs in. */
  path: string;
  /** The profile's `worker.provider` and `worker.model`. */
  worker?: { provider?: string; model?: string };
  /** T3's settings, for tests; read from T3's data folder otherwise. */
  t3?: T3ProviderSettings;
  /** Builds adapters; tests pass fakes. */
  adapters?: Partial<Record<'claude' | 'codex', (provider: ProviderEntry, path: string, model: string | undefined) => MeetingRuntime>>;
}

const claudeRuntime = (provider: ProviderEntry, path: string, model: string | undefined): MeetingRuntime => {
  const binary = provider.binaryPath;
  const extractor = createExtractor({ path, ...(binary ? { binary } : {}), ...(model ? { model } : {}) });
  const reader = createSourceReader({ path, ...(binary ? { binary } : {}) });
  return { provider, extract: extractor.extract, fetchTranscript: reader.fetchTranscript, sources: reader.status, check: extractor.check };
};

const codexRuntime = (provider: ProviderEntry, path: string, model: string | undefined): MeetingRuntime => {
  const codex = createCodexAdapter({ path, ...(provider.binaryPath ? { binary: provider.binaryPath } : {}), ...(model ? { model } : {}) });
  return { provider, extract: codex.extract, fetchTranscript: codex.fetchTranscript, sources: codex.status, check: codex.check };
};

/** The sentence Settings and the DM reply show when meetings can't run on the job provider. */
export const unsupportedMeetings = (provider: ProviderEntry | null): string => (provider
  ? `Meetings can't run on ${provider.label} yet, the provider your jobs use. ${provider.unsupported ?? ''} Serra won't use another provider instead.`.replace(/\s+/g, ' ').trim()
  : "Serra can't tell which provider your jobs use: neither your profile nor T3's settings name one. Set it in Settings › Worker.");

/**
 * The meeting runtime for the provider jobs run on, or why there is none. The worker's model goes with it only when
 * the profile names the provider: a model is specific to one provider.
 */
export const meetingRuntime = ({ path, worker, t3, adapters = {} }: RuntimeOptions): MeetingRuntimeChoice => {
  const provider = jobProvider(providerEntries(t3 ?? readT3Providers(), worker?.provider));
  if (!provider?.adapter) return { runtime: null, provider, unsupported: unsupportedMeetings(provider) };
  const model = worker?.provider?.trim() ? worker.model : undefined;
  const build = provider.adapter === 'claude' ? adapters.claude ?? claudeRuntime : adapters.codex ?? codexRuntime;
  return { runtime: build(provider, path, model), unsupported: null };
};

/** What Settings › Meetings shows: the provider meetings run on, whether it's ready, and its Granola and Meet sources. */
export interface MeetingProviderView {
  provider: ProviderEntry | null;
  /** Why meetings can't run on it, or null. Never followed by another provider. */
  unsupported: string | null;
  /** The extractor's readiness (no model call), or null when unsupported. */
  extraction: { ok: boolean; reason: string | null } | null;
  sources: ProviderStatus[];
}

export const meetingProviderView = async (options: RuntimeOptions): Promise<MeetingProviderView> => {
  const choice = meetingRuntime(options);
  if (!choice.runtime) return { provider: choice.provider, unsupported: choice.unsupported, extraction: null, sources: [] };
  const [extraction, sources] = await Promise.all([
    choice.runtime.check().catch((error: unknown) => ({ ok: false, reason: error instanceof Error ? error.message : String(error) })),
    choice.runtime.sources(),
  ]);
  return { provider: choice.runtime.provider, unsupported: null, extraction, sources };
};
