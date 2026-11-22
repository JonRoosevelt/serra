// The T3 providers Serra works with (SERRA-63). T3 runs every job through a provider instance (`worker.provider` in
// the profile, else T3's default). Each instance has a driver kind (`claudeAgent`, `codex`, `cursor`, …). Serra has an
// adapter for some kinds: it can read their MCP config (Tools) and run meeting capture through their own CLI in its
// strictest no-tools mode. For every other kind it says "not supported yet" and never guesses at its config.
//
// Where the list comes from: T3's built-in instances (one per driver, the id is the driver) and the instances in T3's
// `settings.json` (`providerInstances`: id → driver).
//
// Which one jobs use is resolved the way `t3 thread start` does: the profile's `worker.provider`, else the T3
// project's own default model (`projection_projects.default_model_selection_json` in T3's state database, opened
// read-only), else T3's global default (`defaultModelSelection`). When the project's default can't be read, Serra
// can't tell, and says so: it never takes the global default in its place. Serra only reads these files.
import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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
  /** T3's global default instance, used for a job when neither the profile nor the T3 project names one. */
  defaultInstance: string | null;
  /**
   * The T3 project's own default instance: `none` when the project sets none (T3 then uses the global default),
   * `unknown` when Serra couldn't read it (then Serra can't tell which provider jobs use).
   */
  projectDefault?: { state: 'set'; instance: string } | { state: 'none' } | { state: 'unknown' };
  /** Where the settings were read, with the home folder as `~`, and whether they could be. */
  source: string;
  state: 'read' | 'missing' | 'unreadable';
}

/** T3's data folder: `T3CODE_HOME` when set, else `~/.t3`. */
const t3Home = (home: string = homedir(), env: Record<string, string | undefined> = process.env): string => env.T3CODE_HOME || join(home, '.t3');

/** T3's provider instances and default, from its `settings.json`. Missing or unreadable is reported, never filled in. */
/**
 * The default model T3 has for the project at `projectPath`, from its state database, read-only. Any surprise (no
 * database, another schema, a lock) is `unknown`, never a guess.
 */
export const readProjectDefault = (projectPath: string, { home = homedir(), env = process.env }: { home?: string; env?: Record<string, string | undefined> } = {}): NonNullable<T3ProviderSettings['projectDefault']> => {
  const path = join(t3Home(home, env), 'userdata', 'statev2.sqlite');
  if (!existsSync(path)) return { state: 'unknown' };
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(path, { readOnly: true });
    const rows = db.prepare('SELECT default_model_selection_json AS selection FROM projection_projects WHERE workspace_root = ? AND deleted_at IS NULL').all(projectPath);
    // Not a T3 project (or registered twice): T3 would refuse or pick one, and Serra can't tell which.
    if (rows.length !== 1) return { state: 'unknown' };
    const raw = isRecord(rows[0]) ? rows[0].selection : null;
    if (raw === null || raw === undefined || raw === '') return { state: 'none' };
    const selection = typeof raw === 'string' ? parseJson(raw) : undefined;
    const instance = isRecord(selection) ? stringField(selection.instanceId) : undefined;
    return instance ? { state: 'set', instance } : { state: 'unknown' };
  } catch { return { state: 'unknown' }; } finally { db?.close(); }
};

export const readT3Providers = ({ home = homedir(), env = process.env, projectPath }: { home?: string; env?: Record<string, string | undefined>; projectPath?: string } = {}): T3ProviderSettings => {
  const path = join(t3Home(home, env), 'userdata', 'settings.json');
  const projectDefault = projectPath ? { projectDefault: readProjectDefault(projectPath, { home, env }) } : {};
  const source = path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
  if (!existsSync(path)) return { instances: [], defaultInstance: null, source, state: 'missing', ...projectDefault };
  let value: unknown;
  try { value = parseJson(readFileSync(path, 'utf8')); } catch { value = undefined; }
  if (!isRecord(value)) return { instances: [], defaultInstance: null, source, state: 'unreadable', ...projectDefault };
  const configured = isRecord(value.providerInstances) ? value.providerInstances : {};
  const instances = Object.entries(configured).flatMap(([id, entry]) => {
    const driver = isRecord(entry) ? stringField(entry.driver) : undefined;
    if (!driver || !isRecord(entry)) return [];
    const config = isRecord(entry.config) ? entry.config : {};
    const binaryPath = stringField(config.binaryPath);
    return [{ id, driver, ...(binaryPath ? { binaryPath } : {}), otherConfig: Object.keys(config).filter((key) => key !== 'binaryPath') }];
  });
  const selection = isRecord(value.defaultModelSelection) ? value.defaultModelSelection : {};
  return { instances, defaultInstance: stringField(selection.instanceId) ?? null, source, state: 'read', ...projectDefault };
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
  // As `t3 thread start` does: the profile, else the project's default, else the global default. A project default
  // Serra couldn't read leaves the job provider unknown. Callers that don't name the project only get the profile's.
  const project = settings.projectDefault;
  const fromProject = project?.state === 'set' ? project.instance : null;
  const global = project?.state === 'none' ? settings.defaultInstance : null;
  const jobsId = worker?.trim() || fromProject || global;
  const chosenBy: ProviderEntry['chosenBy'] = worker?.trim() ? 'profile' : fromProject ? 't3-project' : global ? 't3-default' : null;
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
