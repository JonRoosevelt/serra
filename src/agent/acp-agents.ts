// Which agent backend the owner picked, and the ACP agents Serra can offer. Stored in `agent-backend.json` in the
// profile, read on every run, so a change applies to the next one. Without the file, T3 runs everything.
//
// The common ACP agents come built in; an agent is offered only when its command is on the owner's PATH. Serra never
// installs one. The owner can add their own in the file (name, command, args, env); env values come from the owner's
// own file, never from Serra's code, and are never shown or logged.
import { accessSync, constants, readFileSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { writeFileAtomic } from '../config.ts';
import { isRecord, parseJson } from '../json-guards.ts';
import type { AcpAgent } from './acp.ts';

const FILE = 'agent-backend.json';

/** The ACP agents Serra knows, in the order it offers them. Each one's own login stays with it. */
export const KNOWN_ACP_AGENTS: readonly AcpAgent[] = [
  // Anthropic's Claude Code through Zed's adapter (`npm i -g @agentclientprotocol/claude-agent-acp`), on the owner's own `claude` login.
  { id: 'claude', name: 'Claude Code', command: 'claude-agent-acp', args: [] },
  // OpenAI's Codex through Zed's adapter (`codex-acp`), on the owner's own `codex` login.
  { id: 'codex', name: 'Codex', command: 'codex-acp', args: [] },
  { id: 'opencode', name: 'OpenCode', command: 'opencode', args: ['acp'] },
  { id: 'gemini', name: 'Gemini CLI', command: 'gemini', args: ['--acp'] },
];

export interface AgentBackendSettings {
  backend: 't3' | 'acp';
  /** The ACP agent's id, when `backend` is `acp`. */
  agent: string | null;
  /** Agents the owner added in the file, or built-in ones they changed (same id). */
  custom: AcpAgent[];
}

const DEFAULTS: AgentBackendSettings = { backend: 't3', agent: null, custom: [] };

const agentFrom = (value: unknown): AcpAgent | null => {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.command !== 'string' || !value.command.trim()) return null;
  if (!/^[\w-]{1,40}$/.test(value.id)) return null;
  const args = Array.isArray(value.args) ? value.args.filter((arg): arg is string => typeof arg === 'string') : [];
  const env = isRecord(value.env) ? Object.fromEntries(Object.entries(value.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : undefined;
  return { id: value.id, name: typeof value.name === 'string' && value.name.trim() ? value.name.trim().slice(0, 40) : value.id, command: value.command, args, ...(env ? { env } : {}) };
};

export const readAgentBackend = (profileDir: string): AgentBackendSettings => {
  let text: string;
  try { text = readFileSync(join(profileDir, FILE), 'utf8'); } catch { return DEFAULTS; }
  const value = parseJson(text);
  if (!isRecord(value)) return DEFAULTS;
  const custom = Array.isArray(value.agents) ? value.agents.map(agentFrom).filter((agent): agent is AcpAgent => agent !== null) : [];
  const agent = typeof value.agent === 'string' ? value.agent : null;
  return { backend: value.backend === 'acp' && agent ? 'acp' : 't3', agent, custom };
};

/** Saves the owner's choice, keeping the agents they added. */
export const writeAgentBackend = (profileDir: string, choice: { backend: 't3' | 'acp'; agent?: string | null }): AgentBackendSettings => {
  const current = readAgentBackend(profileDir);
  if (choice.backend === 'acp' && !choice.agent) throw new Error('Pick an ACP agent.');
  let raw: Record<string, unknown> = {};
  try { const parsed = parseJson(readFileSync(join(profileDir, FILE), 'utf8')); if (isRecord(parsed)) raw = parsed; } catch { /* a new file */ }
  const next = { ...raw, backend: choice.backend, agent: choice.backend === 'acp' ? choice.agent : current.agent };
  writeFileAtomic(join(profileDir, FILE), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  return readAgentBackend(profileDir);
};

/** Every agent Serra can offer: the built-in ones, with the owner's own changes and additions. */
export const acpAgents = (settings: AgentBackendSettings): AcpAgent[] => {
  const custom = new Map(settings.custom.map((agent) => [agent.id, agent]));
  return [...KNOWN_ACP_AGENTS.map((agent) => custom.get(agent.id) ?? agent), ...settings.custom.filter((agent) => !KNOWN_ACP_AGENTS.some((known) => known.id === agent.id))];
};

/** The command's full path on `path`, or null. An absolute command is checked as is. */
export const findCommand = (command: string, path: string): string | null => {
  const executable = (file: string): boolean => { try { accessSync(file, constants.X_OK); return true; } catch { return false; } };
  if (isAbsolute(command)) return executable(command) ? command : null;
  if (command.includes('/')) return null;
  for (const folder of path.split(delimiter)) if (folder && executable(join(folder, command))) return join(folder, command);
  return null;
};

/** One agent as the Settings picker shows it: whether its command is on PATH. Never its env. */
export interface AcpAgentChoice { id: string; name: string; command: string; installed: boolean }

export const agentChoices = (settings: AgentBackendSettings, path: string): AcpAgentChoice[] =>
  acpAgents(settings).map((agent) => ({ id: agent.id, name: agent.name, command: [agent.command, ...agent.args].join(' '), installed: findCommand(agent.command, path) !== null }));

/** Settings › Meetings' agent backend card: the choice, and every agent with whether it's installed. */
export interface AgentBackendView { backend: 't3' | 'acp'; agent: string | null; agents: AcpAgentChoice[] }
