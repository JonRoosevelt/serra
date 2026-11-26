// The AgentBackend contract (src/agent/backend.ts): what every backend gives the features that run on it. Each backend
// runs the same checks against a fake of what it drives: T3 against a scripted `t3` CLI and tool endpoint, ACP against
// a scripted ACP agent on stdio (tests/fakes/acp-agent.ts) that speaks the real protocol through the official SDK.
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createAcpBackend, type AcpAgent } from '../src/agent/acp.ts';
import { agentChoices, readAgentBackend, writeAgentBackend } from '../src/agent/acp-agents.ts';
import { createMeetingRuns } from '../src/meeting-runs.ts';
import { pollUntilSettled, worktreeRun, type AgentBackend, type RunDetail, type WaitOptions } from '../src/agent/backend.ts';
import { createT3Backend } from '../src/agent/t3.ts';
import type { T3Session } from '../src/t3-session.ts';
import { createFakeT3 } from './fakes/t3.ts';

/** A backend under test, and the agent's side of it: end the running turn with `text`. */
interface ContractSubject {
  backend: AgentBackend;
  /** The agent ends its running turn with `text`. Resolves once the backend can see it. */
  reply: (threadId: string, text: string) => Promise<void>;
  workspace: StartWorkspace;
  cleanup?: () => Promise<void>;
}
type StartWorkspace = Parameters<AgentBackend['start']>[0]['workspace'];

const fast: Omit<WaitOptions, 'after'> = { timeoutMs: 5_000, pollMs: 1, sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }), now: Date.now };

/** The checks every backend passes. */
const backendContract = (name: string, make: () => Promise<ContractSubject>): void => {
  test(`${name}: declares every capability as a yes or no`, async () => {
    const { backend, cleanup } = await make();
    try {
      assert.deepEqual(Object.keys(backend.capabilities).sort(), ['persistentRuns', 'readOnly', 'steer', 'toolResults', 'transcriptLink', 'worktrees']);
      assert.ok(Object.values(backend.capabilities).every((value) => typeof value === 'boolean'));
      assert.ok(backend.label.length > 0);
    } finally { await backend.close(); await cleanup?.(); }
  });

  test(`${name}: a run starts, is followed until it settles, and gives its final answer; a follow-up is the next run`, async () => {
    const { backend, reply, workspace, cleanup } = await make();
    try {
      const threadId = await backend.start({ workspace, title: 'Contract: first', brief: 'Say hello.' });
      const going = await backend.read(threadId);
      assert.equal(going.thread.threadId, threadId);
      assert.notEqual(going.thread.activeRunId, null, 'a started run is going until the agent ends it');
      await reply(threadId, 'hello');
      const first = await backend.wait(threadId, { ...fast, after: null });
      assert.equal(first.kind, 'settled');
      assert.ok(first.kind === 'settled' && first.answer === 'hello', 'the run\'s final answer');
      const firstRun = first.kind === 'settled' ? first.runId : '';

      await backend.send(threadId, 'Say it again.');
      await reply(threadId, 'hello again');
      const second = await backend.wait(threadId, { ...fast, after: firstRun });
      assert.ok(second.kind === 'settled' && second.runId !== firstRun && second.answer === 'hello again', 'the follow-up is a run of its own');
      const detail: RunDetail = await backend.read(threadId, 10);
      assert.equal(detail.thread.activeRunId, null);
      assert.ok(detail.messages.some((message) => message.role === 'assistant' && message.text === 'hello'));
      assert.equal(typeof detail.thread.link, 'string', backend.capabilities.transcriptLink ? 'a link to open' : 'empty: no link');
      if (backend.capabilities.transcriptLink) assert.ok(detail.thread.link.length > 0);
      assert.ok(Array.isArray(await backend.list({ project: '/Users/you/project', title: 'Contract: first', since: new Date(0).toISOString() })));
      await backend.settle(threadId);
    } finally { await backend.close(); await backend.close(); await cleanup?.(); }
  });
};

/** A tool-endpoint session that answers settle and interrupt, and counts what's opened and closed. */
const fakeSession = (calls: string[]) => async (): Promise<T3Session> => {
  calls.push('open');
  return {
    call: async (tool) => { calls.push(tool); return { ok: true }; },
    close: async () => { calls.push('close'); },
  };
};

backendContract('T3', async () => {
  const fake = createFakeT3();
  const calls: string[] = [];
  return {
    backend: createT3Backend({ bin: '/Users/you/.t3/bin/t3', cli: fake.t3, session: fakeSession(calls) }),
    reply: async (threadId, text) => { fake.reply(text, threadId); },
    workspace: { kind: 'worktree', project: '/Users/you/project', baseRef: 'origin/main', branch: 'serra/contract' },
  };
});

test('T3: a worktree run is `t3 thread start` with the job\'s branch, title and worker, unchanged', async () => {
  const fake = createFakeT3();
  const backend = createT3Backend({ bin: '/Users/you/.t3/bin/t3', cli: fake.t3, session: fakeSession([]) });
  const input = { project: '/Users/you/project', baseRef: 'origin/main', branch: 'serra/x', title: 'Serra: x', brief: 'Do x.', provider: 'codex', model: 'gpt-6.1-sol' };
  await backend.start(worktreeRun(input));
  assert.deepEqual(fake.started, [input]);
  await backend.start(worktreeRun({ ...input, provider: undefined, model: undefined }));
  assert.equal('provider' in fake.started[1]!, false, 'no worker: T3 picks');
});

test('T3: the tool-endpoint session opens only when a call needs it, and close revokes it once', async () => {
  const fake = createFakeT3();
  const calls: string[] = [];
  const backend = createT3Backend({ bin: '/Users/you/.t3/bin/t3', cli: fake.t3, session: fakeSession(calls) });
  const threadId = await backend.start(worktreeRun({ project: '/Users/you/project', baseRef: 'origin/main', branch: 'b', title: 't', brief: 'x' }));
  await backend.send(threadId, 'queued');
  assert.deepEqual(calls, [], 'a job never opens a session');
  await backend.send(threadId, 'steered', { mode: 'steer' });
  await backend.interrupt(threadId, 'stop');
  await backend.close();
  await backend.close();
  assert.deepEqual(calls, ['open', 't3_thread_send', 't3_thread_interrupt', 'close']);
  assert.deepEqual(fake.sends.map((send) => send.message), ['queued'], 'a queued message goes through the CLI');
});

test('a wait ends on a request the run waits on, or when time runs out, as well as on a settled run', async () => {
  const detail = (over: Partial<RunDetail['thread']>): RunDetail => ({ thread: { threadId: 't', link: '', status: 'running', latestRunId: 'r1', activeRunId: 'r1', ...over }, messages: [{ role: 'assistant', runId: 'r1', text: 'done' }] });
  const pending = await pollUntilSettled(async () => detail({ pendingRequestCount: 1 }), 't', { ...fast, after: null });
  assert.equal(pending.kind, 'pending');
  let clock = 0;
  const timeout = await pollUntilSettled(async () => detail({}), 't', { ...fast, after: null, timeoutMs: 10, now: () => (clock += 5), sleep: async () => {} });
  assert.equal(timeout.kind, 'timeout');
  const settled = await pollUntilSettled(async () => detail({ activeRunId: null }), 't', { ...fast, after: null });
  assert.deepEqual(settled.kind === 'settled' ? [settled.runId, settled.answer] : [], ['r1', 'done']);
  const before = await pollUntilSettled(async () => detail({ activeRunId: null }), 't', { ...fast, after: 'r1', timeoutMs: 10, now: () => (clock += 5), sleep: async () => {} });
  assert.equal(before.kind, 'timeout', 'the run it was told to skip doesn\'t count');
});

// ACP ---------------------------------------------------------------------------------------------------------------

const FAKE_AGENT = new URL('./fakes/acp-agent.ts', import.meta.url).pathname;

/** The fake ACP agent in a folder of its own, with the processes it started, to check none is left running. */
const fakeAcp = (t?: TestContext) => {
  const dir = mkdtempSync(join(tmpdir(), 'serra-acp-'));
  const children: ChildProcess[] = [];
  const agent: AcpAgent = { id: 'fake', name: 'Fake Agent', command: process.execPath, args: [FAKE_AGENT], env: { FAKE_ACP_DIR: dir } };
  const logs: string[] = [];
  const backend = (over: Partial<Parameters<typeof createAcpBackend>[0]> = {}) => createAcpBackend({
    agent, log: (line) => logs.push(line), worktreeRoot: join(dir, 'worktrees'),
    spawnAgent: (chosen, env) => {
      const child = execAgent(chosen, env);
      children.push(child);
      return child;
    },
    ...over,
  });
  let turn = 0;
  /** The agent ends its next turn with `text`. */
  const reply = (text: string, at = turn + 1): void => { turn = at; writeFileSync(join(dir, `turn-${at}`), text); };
  const cleanup = async (): Promise<void> => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    rmSync(dir, { recursive: true, force: true });
  };
  t?.after(cleanup);
  return { dir, agent, backend, reply, children, logs, cleanup, read: (name: string) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null) };
};

/** The real spawn, in a process group of its own like the backend's own; the fake's env on top. */
const execAgent: NonNullable<Parameters<typeof createAcpBackend>[0]['spawnAgent']> = (chosen, env) =>
  spawn(chosen.command, chosen.args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...env, ...chosen.env }, detached: true });

const alive = (child: ChildProcess): boolean => child.exitCode === null && child.signalCode === null;

backendContract('ACP', async () => {
  const fake = fakeAcp();
  return {
    backend: fake.backend(),
    reply: async (_threadId, text) => { fake.reply(text); },
    workspace: { kind: 'folder', path: fake.dir, name: 'Contract' },
    cleanup: fake.cleanup,
  };
});

test('ACP: a read-only run refuses every permission request and counts it as waiting; others allow reads once and refuse writes and commands', async (t) => {
  const fake = fakeAcp(t);
  const backend = fake.backend();
  try {
    const guarded = await backend.start({ workspace: { kind: 'folder', path: fake.dir, name: 'x' }, title: 'g', brief: 'ASK:read', readOnly: true });
    for (let n = 0; n < 200 && fake.read('permission-1') === null; n += 1) await new Promise((resolve) => { setTimeout(resolve, 5); });
    assert.equal(fake.read('permission-1'), 'no', 'even a read is refused in a read-only run');
    assert.equal(fake.read(`mode-${guarded}`), 'read-only', 'an agent with a read-only mode is put in it');
    assert.equal((await backend.read(guarded)).thread.pendingRequestCount, 1, 'a meeting run sees it and stops the run, as on T3');
    const outcome = await backend.wait(guarded, { ...fast, after: null });
    assert.equal(outcome.kind, 'pending');
    await backend.interrupt(guarded, 'stop');
    assert.equal((await backend.wait(guarded, { ...fast, after: null, timeoutMs: 2_000 })).kind, 'pending', 'still counted after the stop');
    for (const [kind, answer] of [['read', 'yes'], ['search', 'yes'], ['edit', 'no'], ['execute', 'no'], ['delete', 'no'], ['move', 'no'], ['switch_mode', 'no']] as const) {
      const threadId = await backend.start({ workspace: { kind: 'folder', path: fake.dir, name: 'x' }, title: kind, brief: `ASK:${kind}` });
      const turn = Number(threadId.split('-')[1]);
      for (let n = 0; n < 200 && fake.read(`permission-${turn}`) === null; n += 1) await new Promise((resolve) => { setTimeout(resolve, 5); });
      assert.equal(fake.read(`permission-${turn}`), answer, `${kind} is ${answer === 'yes' ? 'allowed' : 'refused'}`);
      fake.reply('ok', turn);
      await backend.wait(threadId, { ...fast, after: null });
    }
  } finally { await backend.close(); }
});

test('ACP: a tool\'s own result is read back from the run, a stop ends the turn, and close leaves no agent running', async (t) => {
  const fake = fakeAcp(t);
  const backend = fake.backend();
  const threadId = await backend.start({ workspace: { kind: 'folder', path: fake.dir, name: 'x' }, title: 't', brief: 'TOOL:abc-123' });
  fake.reply('<meeting-read>done</meeting-read>');
  const done = await backend.wait(threadId, { ...fast, after: null });
  assert.ok(done.kind === 'settled');
  const call = await backend.toolCall!(threadId, done.runId, 'abc-123');
  assert.deepEqual(call, { input: { meeting_id: 'abc-123' }, output: { content: [{ type: 'text', text: 'Ana: Hi\nBo: Hello' }] }, failed: false });
  assert.equal(await backend.toolCall!(threadId, done.runId, 'other-id'), null);

  await backend.send(threadId, 'a long turn');
  assert.notEqual((await backend.read(threadId)).thread.activeRunId, null);
  await backend.interrupt(threadId, 'stop');
  const stopped = await backend.wait(threadId, { ...fast, after: done.runId });
  assert.ok(stopped.kind === 'settled' && stopped.answer === null, 'a stopped turn ends without an answer');

  assert.equal(fake.children.length, 1, 'one agent process for every run of a backend');
  await backend.close();
  assert.equal(alive(fake.children[0]!), false, 'close stops the agent');
  await assert.rejects(backend.read(threadId), /end when Serra restarts/, 'its runs are gone with it');
});

test('ACP: an agent that starts in a mode that never asks (Claude Code\'s auto) is moved to one that asks; read-only refuses to start without one', async (t) => {
  const fake = fakeAcp(t);
  const claudeLike = { currentModeId: 'auto', availableModes: [{ id: 'default', name: 'Manual' }, { id: 'acceptEdits', name: 'Accept edits' }, { id: 'plan', name: 'Plan' }, { id: 'auto', name: 'Auto' }, { id: 'bypassPermissions', name: 'Bypass' }] };
  const backend = fake.backend({ agent: { ...fake.agent, env: { ...fake.agent.env, FAKE_ACP_MODES: JSON.stringify(claudeLike) } } });
  try {
    const guarded = await backend.start({ workspace: { kind: 'folder', path: fake.dir, name: 'x' }, title: 'g', brief: 'x', readOnly: true });
    assert.equal(fake.read(`mode-${guarded}`), 'default', 'a read-only run asks before every tool, and Serra refuses');
    const open = await backend.start({ workspace: { kind: 'folder', path: fake.dir, name: 'x' }, title: 'o', brief: 'x' });
    assert.equal(fake.read(`mode-${open}`), 'default', 'any run asks, so Serra\'s permission answers hold');
  } finally { await backend.close(); }
  const permissive = fake.backend({ agent: { ...fake.agent, env: { ...fake.agent.env, FAKE_ACP_MODES: JSON.stringify({ currentModeId: 'yolo', availableModes: [{ id: 'yolo', name: 'YOLO' }] }) } } });
  try {
    await assert.rejects(permissive.start({ workspace: { kind: 'folder', path: fake.dir, name: 'x' }, title: 'g', brief: 'x', readOnly: true }), /runs in "yolo" mode and has none that asks.*can't make this run read-only/);
  } finally { await permissive.close(); }
});

test('ACP: a missing agent command is a plain sentence, and a worktree run gets a worktree Serra made', async (t) => {
  const fake = fakeAcp(t);
  const missing = createAcpBackend({ agent: { id: 'gone', name: 'Gone Agent', command: join(fake.dir, 'no-such-agent'), args: [] } });
  await assert.rejects(missing.start({ workspace: { kind: 'folder', path: fake.dir, name: 'x' }, title: 't', brief: 'x' }), /can't find .*no-such-agent.*Install Gone Agent/);
  await missing.close();

  const repo = join(fake.dir, 'repo');
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe', env: { ...process.env, GIT_AUTHOR_NAME: 'You', GIT_AUTHOR_EMAIL: 'you@example.com', GIT_COMMITTER_NAME: 'You', GIT_COMMITTER_EMAIL: 'you@example.com' } });
  git('init', '-q', '-b', 'main');
  git('commit', '-q', '--allow-empty', '-m', 'start');
  const backend = fake.backend();
  try {
    const threadId = await backend.start({ workspace: { kind: 'worktree', project: repo, baseRef: 'main', branch: 'serra/try-it' }, title: 'w', brief: 'x' });
    const cwd = fake.read(`session-${threadId.split('-')[1]}`)!;
    assert.equal(cwd, join(fake.dir, 'worktrees', 'repo', 'serra-try-it'));
    assert.match(git('worktree', 'list').toString(), /serra-try-it/);
    assert.equal(git('rev-parse', '--abbrev-ref', 'HEAD').toString().trim(), 'main', 'the project itself is untouched');
    fake.reply('done');
  } finally { await backend.close(); }
});

test('ACP: meeting runs work on an ACP agent: read-only extraction, and a link read from the tool\'s own result', async (t) => {
  const fake = fakeAcp(t);
  const workspace = join(fake.dir, 'meetings');
  const runs = createMeetingRuns({ t3Bin: '/Users/you/.t3/bin/t3', provider: 'cursor', model: 'composer-2', workspace, pollMs: 2, backend: () => fake.backend() });
  fake.reply('DIGEST');
  assert.equal(await runs.extract('TRANSCRIPT'), 'DIGEST');
  assert.equal(fake.read('mode-session-1'), 'read-only');
  assert.equal(fake.children.length, 1);
  assert.equal(alive(fake.children[0]!), false, 'the agent stops when the run ends');
  fake.reply('<meeting-title>Sync</meeting-title><meeting-read>done</meeting-read>');
  const fetched = await runs.fetchTranscript({ provider: 'granola', id: 'abc-123', url: 'https://notes.granola.ai/d/abc-123' });
  assert.equal(fetched.text, 'Ana: Hi\nBo: Hello', 'the tool\'s result, not the model\'s copy');
  assert.equal(fetched.title, 'Sync');
  assert.ok(fake.children.every((child) => !alive(child)));
  assert.deepEqual(readdirSync(workspace), []);
  // A run that asks for anything is stopped, and says where it ran.
  writeFileSync(join(fake.dir, 'turn-3'), 'never read');
  const asking = createMeetingRuns({ t3Bin: '/Users/you/.t3/bin/t3', workspace, pollMs: 2, backend: () => fake.backend() });
  await assert.rejects(asking.ask('t', 'ASK:execute'), /The Fake Agent run stopped to ask for approval or a question.*Serra stopped it in Fake Agent\./);
});

test('the agent backend choice: T3 until the owner picks an installed ACP agent; agents the owner adds keep their env out of the picker', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'serra-agent-choice-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(readAgentBackend(dir), { backend: 't3', agent: null, custom: [] });
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude-agent-acp'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(dir, 'agent-backend.json'), JSON.stringify({ agents: [{ id: 'mine', name: 'My agent', command: 'my-acp', args: ['--stdio'], env: { MY_TOKEN: 'xoxb-1111-2222-fixturevalue' } }] }));
  const choices = agentChoices(readAgentBackend(dir), bin);
  assert.deepEqual(choices.map((choice) => [choice.id, choice.installed]), [['claude', true], ['codex', false], ['opencode', false], ['gemini', false], ['mine', false]]);
  assert.doesNotMatch(JSON.stringify(choices), /fixturevalue/, 'the picker never carries an agent\'s env');
  assert.throws(() => writeAgentBackend(dir, { backend: 'acp' }), /Pick an ACP agent/);
  assert.deepEqual(writeAgentBackend(dir, { backend: 'acp', agent: 'claude' }).backend, 'acp');
  assert.equal(readAgentBackend(dir).custom.length, 1, 'the owner\'s own agents are kept');
  assert.equal(writeAgentBackend(dir, { backend: 't3' }).backend, 't3');
});
