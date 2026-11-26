// An ACP agent behind Serra's agent interface (src/agent/backend.ts): the owner's other choice to T3. Serra is the
// ACP client: it spawns the agent command the owner picked (src/agent/acp-agents.ts) over stdio and speaks the Agent
// Client Protocol v1 with the official SDK: `initialize`, `session/new`, `session/prompt`, `session/cancel`, the
// streamed `session/update`s, and the agent's `session/request_permission`s.
//
// What ACP doesn't give, Serra keeps itself or does without, and says so in `capabilities`:
// - A run lives in this process: Serra keeps its messages and tool calls in memory, and a restart (or `close()`) ends
//   the agent and every run in it. No link to open a run in, no runs to list after a crash.
// - No worktrees: Serra makes one itself (src/agent/worktree.ts) and starts the session in it.
// - No steer: a message sent while a turn runs is queued, and sent when the turn ends.
//
// Permissions are Serra's to answer, and never wider than T3's:
// - a read-only run refuses every request (T3's `approval-required`), and counts it as waiting, so a meeting run
//   stops it just as it stops a T3 run that asks;
// - any other run allows a read, search, fetch, think or other tool once, and refuses edits, deletes, moves,
//   commands and mode switches. T3's default mode allows everything, so this is narrower.
// Serra offers the agent no file system or terminal of its own, and opens no server: stdio only.
import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';
import { pollUntilSettled, type AgentBackend, type BackendCapabilities, type RunDetail, type RunToolCall, type StartRun } from './backend.ts';
import { launchFor, type AcpAgent } from './acp-agents.ts';
import { makeWorktree } from './worktree.ts';

const ACP_CAPABILITIES: BackendCapabilities = {
  steer: false, worktrees: false, persistentRuns: false, transcriptLink: false, readOnly: true, toolResults: true,
};

/** Tool kinds a run that isn't read-only may use without asking the owner. Everything else is refused. */
const ALLOWED_KINDS = new Set<acp.ToolKind>(['read', 'search', 'fetch', 'think', 'other']);

export interface AcpBackendOptions {
  agent: AcpAgent;
  /** The environment the agent runs in (the owner's login environment), asked for when the agent starts; `agent.env` is added on top. */
  env?: () => Promise<NodeJS.ProcessEnv>;
  /** Where Serra makes worktrees for runs that need one. */
  worktreeRoot?: string;
  /** Starts the agent; a test passes a fake agent's command. */
  spawnAgent?: (agent: AcpAgent, env: NodeJS.ProcessEnv) => ChildProcess;
  log?: (message: string) => void;
  /** MCP servers handed to every session, on top of the agent's own configuration. None by default: the agent's own connections are used, as in T3. */
  mcpServers?: acp.McpServer[];
}

interface ToolRecord { id: string; runId: string; title: string; kind: string | null; status: string | null; rawInput: unknown; rawOutput: unknown; content: unknown }

interface Session {
  sessionId: string;
  runs: number;
  active: string | null;
  /** Requests the agent made that Serra refused: a read-only run that asked is waiting, as far as Serra's concerned. */
  refused: number;
  failed: string | null;
  messages: { role: 'user' | 'assistant'; runId: string; text: string }[];
  /** The running turn's reply so far. */
  reply: string;
  tools: Map<string, ToolRecord>;
  queue: string[];
  readOnly: boolean;
  /** What the running turn cost so far, as the agent reports it. */
  cost: { amount: number; currency: string } | null;
}

/** Modes in which an agent uses tools without asking. */
const PERMISSIVE = /auto|bypass|accept|yolo|full|dont-?ask|never/i;

/**
 * The mode a run goes in: for a read-only run, the agent's read-only mode if it has one; else a mode that asks before
 * using tools (the current one when it does). Null when the agent has nothing better than what it's in.
 */
const askingMode = (modes: acp.SessionModeState, readOnly: boolean): string | null => {
  const readOnlyMode = modes.availableModes.find((choice) => /^read-?only$/i.test(choice.id));
  if (readOnly && readOnlyMode) return readOnlyMode.id;
  if (!PERMISSIVE.test(modes.currentModeId)) return modes.currentModeId;
  return modes.availableModes.find((choice) => /^(default|manual|ask)$/i.test(choice.id))?.id ?? null;
};

/**
 * Why a turn failed, as a fixed sentence: the adapter's error kind or ACP's auth error, never the agent's own text
 * (it can quote the brief, which may hold a transcript).
 */
const turnFailure = (error: unknown, name: string): string => {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; data?: unknown }) : {};
  const kind = typeof record.data === 'object' && record.data !== null && 'errorKind' in record.data ? String(record.data.errorKind) : null;
  if (record.code === -32000 || kind === 'authentication_failed') return `${name} needs you to sign in. Sign in with its own CLI, then try again.`;
  if (kind === 'rate_limit') return `${name} hit its usage or rate limit. Try again later.`;
  if (kind === 'billing_error') return `${name}'s account has a billing problem. Check it in ${name}.`;
  if (kind === 'server_error' || kind === 'transport_lost') return `${name} lost its connection to its provider. Try again.`;
  return `${name} stopped with an error${kind ? ` (${kind})` : ''}.`;
};

const textOf = (content: acp.ContentBlock): string => (content.type === 'text' ? content.text : '');

/** A tool call's output as the meeting reader expects one: the agent's raw output, else its text content as MCP parts. */
const toolOutput = (record: ToolRecord): unknown => {
  if (record.rawOutput !== undefined && record.rawOutput !== null) return record.rawOutput;
  const parts = Array.isArray(record.content) ? record.content : [];
  const texts = parts.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null || !('type' in part) || part.type !== 'content' || !('content' in part)) return [];
    const inner = part.content;
    return typeof inner === 'object' && inner !== null && 'type' in inner && inner.type === 'text' && 'text' in inner && typeof inner.text === 'string' ? [{ type: 'text', text: inner.text }] : [];
  });
  return texts.length ? { content: texts } : undefined;
};

/**
 * Starts the agent from the PATH in its environment: its own command, or a bundled adapter run by this Node on the
 * owner's CLI. In a process group of its own, so `close()` stops the agent and everything it started (the CLI).
 */
const defaultSpawn = (agent: AcpAgent, env: NodeJS.ProcessEnv): ChildProcess => {
  const launch = launchFor(agent, env.PATH ?? '');
  if ('missing' in launch) throw new Error(launch.missing);
  return spawn(launch.command, launch.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...env, ...agent.env, ...launch.env }, detached: true });
};

/** Signals the agent's process group, else the agent alone. */
const signal = (running: ChildProcess, name: NodeJS.Signals): void => {
  try {
    if (running.pid) { process.kill(-running.pid, name); return; }
  } catch { /* not a group leader (a test's fake): signal it alone */ }
  running.kill(name);
};

export const createAcpBackend = ({ agent, env = async () => process.env, worktreeRoot, spawnAgent = defaultSpawn, log = () => {}, mcpServers = [] }: AcpBackendOptions): AgentBackend => {
  const sessions = new Map<string, Session>();
  /** Bumped whenever a turn ends or a request is refused, so a wait reads at once instead of on its next poll. */
  let version = 0;
  const waiters = new Set<() => void>();
  const changed = (): void => {
    version += 1;
    for (const wake of waiters) wake();
    waiters.clear();
  };
  let child: ChildProcess | null = null;
  let connection: Promise<acp.ClientConnection> | null = null;
  let stderr = '';
  let exited: string | null = null;

  const session = (threadId: string): Session => {
    const found = sessions.get(threadId);
    if (!found) throw new Error(`${agent.name} has no run ${threadId}: runs on an ACP agent end when Serra restarts.`);
    return found;
  };

  /** Ends every running turn: the agent is gone. */
  const failAll = (why: string): void => {
    for (const current of sessions.values()) {
      if (current.active) current.failed = why;
      current.active = null;
      current.queue = [];
    }
    changed();
  };

  const app = acp.client({ name: 'serra' })
    .onNotification(acp.methods.client.session.update, ({ params }) => {
      const current = sessions.get(params.sessionId);
      if (!current) return;
      const update = params.update;
      const runId = current.active ?? `run-${current.runs}`;
      // Serra keeps the reply and the tool calls; plans, thoughts, modes and usage it doesn't need.
      if (update.sessionUpdate === 'agent_message_chunk') current.reply += textOf(update.content);
      else if (update.sessionUpdate === 'usage_update' && update.cost) current.cost = { amount: update.cost.amount, currency: update.cost.currency };
      else if (update.sessionUpdate === 'tool_call') {
        current.tools.set(update.toolCallId, { id: update.toolCallId, runId, title: update.title, kind: update.kind ?? null, status: update.status ?? null, rawInput: update.rawInput, rawOutput: update.rawOutput, content: update.content });
      } else if (update.sessionUpdate === 'tool_call_update') {
        const known = current.tools.get(update.toolCallId) ?? { id: update.toolCallId, runId, title: '', kind: null, status: null, rawInput: undefined, rawOutput: undefined, content: undefined };
        current.tools.set(update.toolCallId, {
          ...known,
          ...(update.title ? { title: update.title } : {}), ...(update.kind ? { kind: update.kind } : {}), ...(update.status ? { status: update.status } : {}),
          ...(update.rawInput !== undefined ? { rawInput: update.rawInput } : {}), ...(update.rawOutput !== undefined ? { rawOutput: update.rawOutput } : {}),
          ...(update.content ? { content: update.content } : {}),
        });
      }
    })
    .onRequest(acp.methods.client.session.requestPermission, ({ params }) => {
      const current = sessions.get(params.sessionId);
      const kind = params.toolCall.kind ?? 'other';
      const allow = current !== undefined && !current.readOnly && ALLOWED_KINDS.has(kind);
      const option = params.options.find((choice) => choice.kind === (allow ? 'allow_once' : 'reject_once'))
        ?? (allow ? undefined : params.options.find((choice) => choice.kind === 'reject_always'));
      if (!allow && current) { current.refused += 1; changed(); }
      log(`${agent.name} asked to use ${params.toolCall.title ?? kind} (${kind}): ${allow ? 'allowed once' : 'refused'}.`);
      return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
    });

  /** Starts the agent and says hello, once. */
  const connect = (): Promise<acp.ClientConnection> => (connection ??= (async () => {
    let started: ChildProcess;
    try { started = spawnAgent(agent, await env()); } catch (error) {
      exited = error instanceof Error ? error.message : String(error);
      throw new Error(exited);
    }
    child = started;
    started.stderr?.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString()}`.slice(-4000); });
    const gone = new Promise<never>((_resolve, reject) => {
      started.once('error', (error: NodeJS.ErrnoException) => {
        exited = error.code === 'ENOENT' ? `Serra can't find \`${agent.command}\`. Install ${agent.name}'s ACP adapter, or pick another agent.` : `${agent.name} couldn't start: ${error.message}`;
        failAll(exited);
        reject(new Error(exited));
      });
      started.once('exit', (code, signal) => {
        exited ??= `${agent.name} stopped (${signal ?? `exit ${code ?? '?'}`}).`;
        if (stderr.trim()) log(`${agent.name} said before it stopped: ${stderr.trim().slice(-1000)}`);
        failAll(exited);
        reject(new Error(exited));
      });
    });
    gone.catch(() => {});
    if (!started.stdin || !started.stdout) throw new Error(`${agent.name} has no stdio to talk over.`);
    const stream = acp.ndJsonStream(Writable.toWeb(started.stdin), Readable.toWeb(started.stdout) as ReadableStream<Uint8Array>);
    const open = app.connect(stream);
    const hello = await Promise.race([
      open.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'serra', version: '1' },
      }),
      gone,
    ]);
    if (hello.protocolVersion !== acp.PROTOCOL_VERSION) log(`${agent.name} speaks ACP ${hello.protocolVersion}; Serra speaks ${acp.PROTOCOL_VERSION}.`);
    return open;
  })());

  /** A plain sentence for an agent's error: sign-in problems say where to sign in. Never the agent's raw output. */
  const plain = (error: unknown): Error => {
    if (exited) return new Error(exited);
    const text = error instanceof Error ? error.message : String(error);
    if (/auth|sign[- ]?in|log[- ]?in|credential|api key/i.test(text)) return new Error(`${agent.name} needs you to sign in. Sign in with its own CLI, then try again.`);
    return new Error(`${agent.name}: ${text.slice(0, 300)}`);
  };

  /** Runs one prompt turn, then the next queued message, if any. */
  const turn = (current: Session, text: string): void => {
    current.runs += 1;
    const runId = `run-${current.runs}`;
    current.active = runId;
    current.reply = '';
    current.failed = null;
    current.cost = null;
    current.messages.push({ role: 'user', runId, text });
    void (async () => {
      try {
        const open = await connect();
        const done = await open.agent.request(acp.methods.agent.session.prompt, { sessionId: current.sessionId, prompt: [{ type: 'text', text }] });
        if (done.stopReason !== 'end_turn') log(`${agent.name}'s turn ${runId} ended: ${done.stopReason}.`);
      } catch (error) {
        current.failed = exited ?? turnFailure(error, agent.name);
        log(`${agent.name}'s turn ${runId} failed: ${current.failed}`);
      }
      if (current.active !== runId) return;
      if (current.cost) log(`${agent.name}'s turn ${runId} cost ${current.cost.amount.toFixed(4)} ${current.cost.currency}.`);
      if (current.reply) current.messages.push({ role: 'assistant', runId, text: current.reply });
      current.active = null;
      changed();
      const next = current.queue.shift();
      if (next !== undefined) turn(current, next);
    })();
  };

  const start = async (input: StartRun): Promise<string> => {
    const cwd = input.workspace.kind === 'folder'
      ? input.workspace.path
      : await makeWorktree({ ...input.workspace, ...(worktreeRoot ? { root: worktreeRoot } : {}) });
    let created: acp.NewSessionResponse;
    let open: acp.ClientConnection;
    try {
      open = await connect();
      created = await open.agent.request(acp.methods.agent.session.new, { cwd, mcpServers });
    } catch (error) { throw plain(error); }
    const { sessionId } = created;
    // Serra's permission answers only hold if the agent asks. An agent may start in the owner's own mode that never
    // asks (Claude Code's `auto`, `bypassPermissions`), so every run moves to one that does: read-only when the agent
    // has it (Codex), else its asking mode (`default`, Manual). A read-only run that can't get one doesn't start.
    const modes = created.modes;
    const mode = modes ? askingMode(modes, input.readOnly === true) : null;
    if (mode && mode !== modes?.currentModeId) {
      try { await open.agent.request(acp.methods.agent.session.setMode, { sessionId, modeId: mode }); } catch (error) {
        if (input.readOnly) throw new Error(`${agent.name} wouldn't switch to a mode that asks before using tools, so Serra can't make this run read-only. ${plain(error).message}`);
        log(`${agent.name} kept its mode: ${plain(error).message}`);
      }
    } else if (!mode && modes && input.readOnly && PERMISSIVE.test(modes.currentModeId)) {
      throw new Error(`${agent.name} runs in "${modes.currentModeId}" mode and has none that asks before using tools, so Serra can't make this run read-only.`);
    }
    if (input.model) {
      const option = created.configOptions?.find((choice) => choice.category === 'model' || choice.id === 'model');
      if (option) {
        await open.agent.request(acp.methods.agent.session.setConfigOption, { sessionId, configId: option.id, value: input.model })
          .catch((error: unknown) => log(`${agent.name} kept its own model: ${plain(error).message}`));
      } else log(`${agent.name} offers no model choice over ACP; it uses its own default.`);
    }
    const current: Session = { sessionId, runs: 0, active: null, refused: 0, failed: null, messages: [], reply: '', tools: new Map(), queue: [], readOnly: input.readOnly === true, cost: null };
    sessions.set(sessionId, current);
    turn(current, input.brief);
    return sessionId;
  };

  const read = async (threadId: string, messages = 1): Promise<RunDetail> => {
    const current = session(threadId);
    const latest = current.runs ? `run-${current.runs}` : null;
    return {
      thread: {
        threadId, link: '', status: current.active ? 'running' : current.failed ? 'failed' : 'idle',
        latestRunId: latest, activeRunId: current.active, pendingRequestCount: current.refused,
        ...(current.failed && !current.active ? { error: current.failed } : {}),
      },
      messages: current.messages.slice(-messages).map((message) => ({ ...message })),
    };
  };

  const toolCall = async (threadId: string, runId: string, match: string): Promise<RunToolCall | null> => {
    const current = session(threadId);
    const found = [...current.tools.values()].filter((record) => record.runId === runId && JSON.stringify(record.rawInput ?? record.title ?? '').includes(match)).at(-1);
    if (!found) return null;
    return { input: found.rawInput, output: toolOutput(found), failed: found.status === 'failed' };
  };

  return {
    id: 'acp',
    label: agent.name,
    capabilities: ACP_CAPABILITIES,
    start,
    send: async (threadId, message) => {
      const current = session(threadId);
      if (current.active) current.queue.push(message);
      else turn(current, message);
    },
    interrupt: async (threadId) => {
      const current = session(threadId);
      current.queue = [];
      if (!connection || !current.active) return;
      await (await connection).agent.notify(acp.methods.agent.session.cancel, { sessionId: current.sessionId });
    },
    read,
    // Polling stays the contract; a turn ending or a refusal wakes the wait at once, so a run isn't left a poll late.
    wait: (threadId, options) => {
      let seen = -1;
      const wake = async (ms: number): Promise<void> => {
        if (version !== seen) { seen = version; return; }
        await Promise.race([options.sleep(ms), new Promise<void>((resolve) => { waiters.add(resolve); })]);
        seen = version;
      };
      return pollUntilSettled(read, threadId, { ...options, sleep: wake });
    },
    // Runs live in this process: there's nothing to find after a crash.
    list: async () => [],
    settle: async (threadId) => { sessions.delete(threadId); },
    toolCall,
    close: async () => {
      sessions.clear();
      const running = child;
      child = null;
      if (connection) {
        const open = connection;
        connection = null;
        await open.then((value) => value.close(), () => {});
      }
      if (!running || running.exitCode !== null || running.signalCode !== null) return;
      const ended = new Promise<void>((resolve) => { running.once('exit', () => resolve()); });
      running.stdin?.end();
      signal(running, 'SIGTERM');
      const timer = setTimeout(() => signal(running, 'SIGKILL'), 3_000);
      await ended;
      clearTimeout(timer);
    },
  };
};
