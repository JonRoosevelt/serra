// The Tools (MCP) screen's logic (APP-23): server groups per provider, the load and scope labels, and the summary
// line. Pure functions, tested with `node --test`.
import type { McpLoad, McpOverview, McpScope, McpServer, WorkerDriver } from '../../../src/mcp.ts';

export const DRIVER_NAMES: Record<WorkerDriver, string> = { claude: 'Claude', codex: 'Codex' };

/** A subset of the Badge tones, kept here so this file stays free of .tsx imports for `node --test`. */
export type LoadTone = 'up' | 'warn' | 'neutral';

export const LOAD_LABELS: Record<McpLoad, { text: string; tone: LoadTone }> = {
  loads: { text: 'Loads', tone: 'up' },
  unsure: { text: 'May not load', tone: 'warn' },
  disabled: { text: 'Off', tone: 'neutral' },
};

export const SCOPE_LABELS: Record<McpScope, string> = { user: 'User', project: 'Project', local: 'This folder only' };

const SCOPE_ORDER: Record<McpScope, number> = { user: 0, project: 1, local: 2 };
const LOAD_ORDER: Record<McpLoad, number> = { loads: 0, unsure: 1, disabled: 2 };

/** "HTTP · mcp.example.com", "Local command" or "Unknown transport". */
export const transportLabel = (server: Pick<McpServer, 'transport' | 'host'>): string => {
  if (server.transport === 'stdio') return 'Local command';
  const kind = server.transport === 'sse' ? 'SSE' : server.transport === 'http' ? 'HTTP' : null;
  if (!kind) return server.host ?? 'Unknown transport';
  return server.host ? `${kind} · ${server.host}` : kind;
};

export interface DriverGroup {
  driver: WorkerDriver;
  title: string;
  servers: McpServer[];
  /** "3 load, 1 may not load" or "No MCP servers". */
  summary: string;
  /** Config files that exist but couldn't be read. */
  unreadable: string[];
}

/** One group per provider the worker may use, servers that load first, then by scope and name. */
export const driverGroups = (overview: McpOverview): DriverGroup[] => overview.worker.drivers.map((driver) => {
  const servers = overview.servers
    .filter((server) => server.driver === driver)
    .sort((a, b) => LOAD_ORDER[a.load] - LOAD_ORDER[b.load] || SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope] || a.name.localeCompare(b.name));
  const count = (load: McpLoad) => servers.filter((server) => server.load === load).length;
  const parts = [
    count('loads') && `${count('loads')} ${count('loads') === 1 ? 'loads' : 'load'}`,
    count('unsure') && `${count('unsure')} may not load`,
    count('disabled') && `${count('disabled')} off`,
  ].filter(Boolean);
  return {
    driver,
    title: DRIVER_NAMES[driver],
    servers,
    summary: parts.length ? parts.join(', ') : 'No MCP servers',
    unreadable: overview.files.filter((file) => file.driver === driver && file.state === 'unreadable').map((file) => file.path),
  };
});

/** The line under the title: which provider T3 runs the worker with. */
export const providerLine = (worker: McpOverview['worker']): string =>
  worker.provider
    ? `The worker runs on the "${worker.provider}" provider in T3.`
    : "The profile doesn't name a worker provider, so T3 uses the project's default.";
