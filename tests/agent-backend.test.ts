// The AgentBackend contract (src/agent/backend.ts): what every backend gives the features that run on it. Each backend
// runs the same checks against a fake of what it drives: T3 against a scripted `t3` CLI and tool endpoint.
import assert from 'node:assert/strict';
import test from 'node:test';
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
