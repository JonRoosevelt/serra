// The T3 providers Serra works with (SERRA-63). T3 runs every job through a provider instance (`worker.provider` in
// the profile, else T3's default). Each instance has a driver kind (`claudeAgent`, `codex`, `cursor`, …). Serra has an
// adapter for some kinds: it can read their MCP config (Tools) and run meeting capture through their own CLI in its
// strictest no-tools mode. For every other kind it says "not supported yet" and never guesses at its config.
//
// Where the list comes from: T3's built-in instances (one per driver, the id is the driver) and the instances in T3's
// `settings.json` (`providerInstances`: id → driver), with T3's default instance (`defaultModelSelection`). Serra
// only reads that file.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { isRecord, parseJson, stringField } from './json-guards.ts';
import { T3_PROVIDERS, unsupportedProvider, type ProviderEntry, type ProviderKind } from './tool-catalog.ts';

export interface T3ProviderSettings {
  /**
   * Instances T3's settings configure: id, driver kind, the binary its config names, and any other config keys
   * (a different home folder, say), which Serra can't follow yet.
   */
  instances: { id: string; driver: string; binaryPath?: string; otherConfig: string[] }[];
  /** T3's default instance, used for a job when the profile names none. */
  defaultInstance: string | null;
  /** Where the settings were read, with the home folder as `~`, and whether they could be. */
  source: string;
  state: 'read' | 'missing' | 'unreadable';
}

/** T3's data folder: `T3CODE_HOME` when set, else `~/.t3`. */
const t3Home = (home: string = homedir(), env: Record<string, string | undefined> = process.env): string => env.T3CODE_HOME || join(home, '.t3');

/** T3's provider instances and default, from its `settings.json`. Missing or unreadable is reported, never filled in. */
export const readT3Providers = ({ home = homedir(), env = process.env }: { home?: string; env?: Record<string, string | undefined> } = {}): T3ProviderSettings => {
  const path = join(t3Home(home, env), 'userdata', 'settings.json');
  const source = path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  if (!existsSync(path)) return { instances: [], defaultInstance: null, source, state: 'missing' };
  let value: unknown;
  try { value = parseJson(readFileSync(path, 'utf8')); } catch { value = undefined; }
  if (!isRecord(value)) return { instances: [], defaultInstance: null, source, state: 'unreadable' };
  const configured = isRecord(value.providerInstances) ? value.providerInstances : {};
  const instances = Object.entries(configured).flatMap(([id, entry]) => {
    const driver = isRecord(entry) ? stringField(entry.driver) : undefined;
    if (!driver || !isRecord(entry)) return [];
    const config = isRecord(entry.config) ? entry.config : {};
    const binaryPath = stringField(config.binaryPath);
    return [{ id, driver, ...(binaryPath ? { binaryPath } : {}), otherConfig: Object.keys(config).filter((key) => key !== 'binaryPath') }];
  });
  const selection = isRecord(value.defaultModelSelection) ? value.defaultModelSelection : {};
  return { instances, defaultInstance: stringField(selection.instanceId) ?? null, source, state: 'read' };
};

const kindOf = (driver: string): ProviderKind | undefined => T3_PROVIDERS.find((kind) => kind.driver === driver);

/**
 * Every T3 provider instance, with the one Serra's jobs run on marked. `worker` is the profile's `worker.provider`.
 * An instance whose driver Serra doesn't know, or a job provider T3's settings don't list, is "not supported yet":
 * Serra never maps a name to a provider by guessing.
 */
export const providerEntries = (settings: T3ProviderSettings, worker: string | undefined): ProviderEntry[] => {
  const byId = new Map<string, string>(T3_PROVIDERS.map((kind) => [kind.driver, kind.driver]));
  for (const instance of settings.instances) byId.set(instance.id, instance.driver);
  const configOf = new Map(settings.instances.map((instance) => [instance.id, instance]));
  const jobsId = worker?.trim() || settings.defaultInstance;
  const chosenBy: ProviderEntry['chosenBy'] = worker?.trim() ? 'profile' : settings.defaultInstance ? 't3-default' : null;
  const entries: ProviderEntry[] = [...byId].map(([id, driver]) => {
    const kind = kindOf(driver);
    const label = kind ? (id === driver ? kind.label : `${kind.label} (${id})`) : id;
    const config = configOf.get(id);
    // An instance whose T3 config changes more than its binary (a home folder, say) keeps its MCP config where Serra
    // would have to guess: not supported until Serra reads that setting too.
    const unsupported = !kind ? `Serra doesn't know T3's "${driver}" provider yet.`
      : !kind.adapter ? unsupportedProvider(kind.label, 'work with')
        : config?.otherConfig.length ? `Serra can't follow this instance's T3 settings (${config.otherConfig.join(', ')}) yet.` : null;
    return {
      id, driver, label, icon: kind?.icon ?? 'bot', adapter: unsupported ? null : kind?.adapter ?? null,
      jobs: id === jobsId, chosenBy: id === jobsId ? chosenBy : null, unsupported,
      ...(config?.binaryPath ? { binaryPath: config.binaryPath } : {}),
    };
  });
  if (jobsId && !byId.has(jobsId)) {
    entries.push({
      id: jobsId, driver: null, label: jobsId, icon: 'bot', adapter: null, jobs: true, chosenBy,
      unsupported: `Serra can't tell which provider "${jobsId}" is: T3's settings don't list an instance with that id.`,
    });
  }
  // The job provider first, then the ones Serra works with, then the rest, each in T3's order.
  return entries.sort((a, b) => Number(b.jobs) - Number(a.jobs) || Number(b.adapter !== null) - Number(a.adapter !== null));
};

/** The provider Serra's jobs run on, or null when neither the profile nor T3's settings name one. */
export const jobProvider = (entries: ProviderEntry[]): ProviderEntry | null => entries.find((entry) => entry.jobs) ?? null;
