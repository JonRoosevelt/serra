// The agent backends a long-running Serra follows threads on: T3, and each ACP agent the owner picked, one instance
// each for the life of the process (an ACP agent is one process for all its runs). New work goes to the owner's
// current choice (`agent-backend.json`, read each time); a job or task keeps the backend it started on, by its key
// (`t3`, `acp:<agent>`), so changing the choice never moves a running job.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loginEnvironment } from '../shell-path.ts';
import { createAcpBackend, readRunRecord } from './acp.ts';
import { acpAgents, readAgentBackend } from './acp-agents.ts';
import type { AgentBackend } from './backend.ts';

export interface AgentBackends {
  /** The backend new work starts on. */
  current: () => AgentBackend;
  /** The backend a thread started on. Throws a plain sentence for one Serra can't run any more. */
  get: (key: string) => AgentBackend;
  /** Stops every ACP agent. Runs with a record carry on after the next start. */
  close: () => Promise<void>;
  /** Reopens the ACP runs a stop cut off mid-turn, so they carry on without waiting to be read. Never throws. */
  resume?: () => Promise<void>;
}

/** One backend for everything: T3 alone, as before agent backends, and in tests. */
export const singleBackend = (backend: AgentBackend): AgentBackends => ({
  current: () => backend,
  get: (key) => {
    if (key !== backend.key) throw new Error(`This thread runs on ${key}, which this Serra doesn't run.`);
    return backend;
  },
  close: () => backend.close(),
});

/** Where ACP runs are recorded in a profile: their transcripts, and what a restart carries on. */
export const agentRunsDir = (profileDir: string): string => join(profileDir, 'agent-runs');

/** The login environment an ACP agent runs in: the owner's shell, as T3 gives its providers, with Serra's search PATH. */
export const agentEnv = async (): Promise<NodeJS.ProcessEnv> => {
  const login = await loginEnvironment();
  return { ...(login.env ?? process.env), PATH: login.path };
};

export const createBackendPool = ({ profileDir, t3, log = () => {}, makeAcp = createAcpBackend }: {
  profileDir: string;
  t3: AgentBackend;
  log?: (message: string) => void;
  makeAcp?: typeof createAcpBackend;
}): AgentBackends => {
  const acp = new Map<string, AgentBackend>();
  const get = (key: string): AgentBackend => {
    if (key === 't3') return t3;
    const found = acp.get(key);
    if (found) return found;
    const id = key.startsWith('acp:') ? key.slice(4) : '';
    const settings = readAgentBackend(profileDir);
    const agent = acpAgents(settings).find((entry) => entry.id === id);
    if (!agent) throw new Error(`Serra has no ACP agent "${id}" any more. Add it back in agent-backend.json to carry on its threads.`);
    const model = settings.models[agent.id];
    const backend = makeAcp({ agent, env: agentEnv, runsDir: agentRunsDir(profileDir), attachmentsDir: join(profileDir, 'attachments'), log, ...(model ? { model } : {}) });
    acp.set(key, backend);
    return backend;
  };
  return {
    current: () => {
      const settings = readAgentBackend(profileDir);
      return settings.backend === 'acp' && settings.agent ? get(`acp:${settings.agent}`) : t3;
    },
    get,
    resume: async () => {
      let names: string[] = [];
      try { names = readdirSync(agentRunsDir(profileDir)).filter((name) => name.endsWith('.json')); } catch { return; }
      for (const name of names) {
        const record = readRunRecord(agentRunsDir(profileDir), decodeURIComponent(name.slice(0, -5)));
        if (!record?.active || !record.agent) continue;
        try {
          await get(`acp:${record.agent}`).read(record.sessionId);
        } catch (error) {
          log(`Couldn't carry on ${record.agent} run ${record.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
    close: async () => {
      await Promise.all([...acp.values()].map((backend) => backend.close()));
      acp.clear();
      await t3.close();
    },
  };
};
