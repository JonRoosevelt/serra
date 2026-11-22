// Meetings on every T3 provider (SERRA-63): capture runs on the provider jobs use, through that provider's own CLI in
// its strictest no-tools mode, and an unsupported provider is refused, never swapped for another. Fake CLIs only.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { ChildProcess } from 'node:child_process';
import { CODEX_EXTRACT_FLAGS, createCodexAdapter } from '../src/meeting-codex.ts';
import type { SpawnClaude } from '../src/meeting-extractor.ts';
import { meetingRuntime, type MeetingRuntime } from '../src/meeting-runtime.ts';
import type { T3ProviderSettings } from '../src/providers.ts';
import { driverGroups, providerLine, unsupportedProviders } from '../app/renderer/screens/tools.logic.ts';
import type { McpOverview } from '../src/mcp.ts';
import { providerEntries, readT3Providers } from '../src/providers.ts';

const settings = (over: Partial<T3ProviderSettings> = {}): T3ProviderSettings => ({ instances: [], defaultInstance: null, source: '~/.t3/userdata/settings.json', state: 'read', ...over });

const fakeAdapters = () => {
  const built: string[] = [];
  const make = (name: string) => (provider: MeetingRuntime['provider'], _path: string, model: string | undefined): MeetingRuntime => {
    built.push(`${name}:${provider.id}:${model ?? ''}`);
    const fail = async (): Promise<never> => { throw new Error('not in this test'); };
    return { provider, extract: fail, fetchTranscript: fail, sources: async () => [], check: async () => ({ ok: true, reason: null }) };
  };
  return { built, adapters: { claude: make('claude'), codex: make('codex') } };
};

test('meetings run on the job provider: the profile\'s worker, else T3\'s default, with the worker model only when the profile names it', () => {
  const { built, adapters } = fakeAdapters();
  assert.equal(meetingRuntime({ path: '', worker: { provider: 'codex', model: 'gpt-x' }, t3: settings(), adapters }).runtime?.provider.id, 'codex');
  assert.equal(meetingRuntime({ path: '', worker: {}, t3: settings({ defaultInstance: 'claudeAgent' }), adapters }).runtime?.provider.chosenBy, 't3-default');
  assert.deepEqual(built, ['codex:codex:gpt-x', 'claude:claudeAgent:']);
});

test('an unsupported or unknown job provider is refused plainly, and no other provider is ever built', () => {
  const { built, adapters } = fakeAdapters();
  for (const [worker, t3, pattern] of [
    [{ provider: 'cursor' }, settings(), /Meetings can't run on Cursor yet, the provider your jobs use\. .*Serra won't use another provider instead\./],
    [{}, settings({ defaultInstance: 'antigravity' }), /Meetings can't run on Antigravity yet/],
    [{ provider: 'claude' }, settings(), /can't tell which provider "claude" is/],
    [{}, settings(), /neither your profile nor T3's settings name one/],
    [{ provider: 'claude-elsewhere' }, settings({ instances: [{ id: 'claude-elsewhere', driver: 'claudeAgent', otherConfig: ['homePath'] }] }), /can't follow this instance's T3 settings \(homePath\)/],
  ] as const) {
    const choice = meetingRuntime({ path: '', worker, t3, adapters });
    assert.equal(choice.runtime, null);
    assert.match(choice.unsupported ?? '', pattern);
  }
  assert.deepEqual(built, [], 'never falls back to Claude or Codex');
});

// --- Codex: strictest mode, verified ---------------------------------------------------------------------------------

/** A fake `codex`: answers `--version`, `mcp list` and `exec` from `answer`, recording argv, stdin and folder. */
const fakeCodex = (answer: (args: readonly string[], stdin: string, cwd: string) => string[], version = 'codex-cli 0.171.0') => {
  const calls: { args: readonly string[]; stdin: string; cwd: string }[] = [];
  const spawn: SpawnClaude = (_command, args, { cwd }) => {
    const child = new EventEmitter() as ChildProcess;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr: new PassThrough(), kill: () => { if (!stdout.writableEnded) stdout.end(); return true; } });
    let input = '';
    stdin.on('data', (chunk: Buffer) => { input += chunk.toString(); });
    stdin.on('finish', () => {
      calls.push({ args, stdin: input, cwd });
      const lines = args[0] === '--version' ? [version] : answer(args, input, cwd);
      for (const line of lines) if (!stdout.writableEnded) stdout.write(`${line}\n`);
      if (!stdout.writableEnded) stdout.end();
    });
    stdout.on('end', () => setImmediate(() => child.emit('close', 0)));
    return child;
  };
  return { spawn, calls };
};

const bin = (t: TestContext): string => {
  const dir = mkdtempSync(join(tmpdir(), 'serra-codex-bin-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'codex'), '#!/bin/sh\n');
  chmodSync(join(dir, 'codex'), 0o755);
  return dir;
};

const ev = (value: Record<string, unknown>): string => JSON.stringify(value);
const HOST_OFF = ev({ type: 'item.completed', item: { id: 'item_0', type: 'error', message: 'Code Mode is unavailable because code-mode host is disabled.' } });
const answer = (text: string) => [ev({ type: 'thread.started' }), HOST_OFF, ev({ type: 'turn.started' }), ev({ type: 'item.completed', item: { type: 'agent_message', text } }), ev({ type: 'turn.completed' })];
const DIGEST = '<meeting-digest>{"items":[]}</meeting-digest>';

test('Codex extraction: strictest flags, prompt on stdin from an empty folder, after the probe sees its tools are off', async (t) => {
  const path = bin(t);
  const fake = fakeCodex(() => answer(DIGEST));
  const text = await createCodexAdapter({ path, spawn: fake.spawn, managedFiles: [] }).extract('TRANSCRIPT-BYTES');
  assert.equal(text, DIGEST);
  const launch = fake.calls.at(-1)!;
  assert.match(launch.stdin, /TRANSCRIPT-BYTES/);
  assert.ok(!launch.args.some((arg) => arg.includes('TRANSCRIPT-BYTES')), 'never in argv');
  for (const flag of CODEX_EXTRACT_FLAGS) assert.ok(launch.args.includes(flag), flag);
  for (const feature of ['shell_tool', 'apps', 'plugins', 'hooks', 'code_mode_host', 'computer_use', 'browser_use']) {
    assert.ok(launch.args.some((arg, at) => arg === feature && launch.args[at - 1] === '--disable'), `${feature} is off`);
  }
  assert.ok(launch.args.includes('--ignore-user-config') && launch.args.includes('read-only') && launch.args.includes('--ephemeral'));
  assert.equal(existsSync(launch.cwd), false, 'the run folder is removed');
  // The probe ran before any transcript byte.
  assert.ok(fake.calls.slice(0, -1).every((call) => !call.stdin.includes('TRANSCRIPT-BYTES')));
});

test('Codex extraction refuses before any transcript byte: untested build, managed settings, tools not confirmed off', async (t) => {
  const path = bin(t);
  const managed = join(path, 'requirements.toml');
  writeFileSync(managed, 'x = 1\n');
  const cases: [ReturnType<typeof fakeCodex>, string[], RegExp][] = [
    [fakeCodex(() => answer(DIGEST), 'codex-cli 9.9.9'), [], /tested with Codex 0\.171\.0/],
    [fakeCodex(() => answer(DIGEST)), [managed], /managed settings/],
    [fakeCodex(() => [ev({ type: 'turn.started' }), ev({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })]), [], /didn't confirm its tools are off/],
  ];
  for (const [fake, managedFiles, reason] of cases) {
    await assert.rejects(createCodexAdapter({ path, spawn: fake.spawn, managedFiles }).extract('TRANSCRIPT-BYTES'), reason);
    assert.ok(fake.calls.every((call) => !call.stdin.includes('TRANSCRIPT-BYTES')));
  }
});

test('Codex: any tool item throws the answer away, and a self-test that leaks the canary fails', async (t) => {
  const path = bin(t);
  const tool = fakeCodex(() => [HOST_OFF, ev({ type: 'turn.started' }), ev({ type: 'item.completed', item: { type: 'command_execution', command: 'cat canary.txt' } }), ...answer(DIGEST).slice(3)]);
  await assert.rejects(createCodexAdapter({ path, spawn: tool.spawn, managedFiles: [] }).extract('x'), /used a tool/);
  const leak = fakeCodex((_args, stdin, cwd) => (stdin.includes('canary.txt') ? answer(readFileSync(join(cwd, 'canary.txt'), 'utf8')) : answer(DIGEST)));
  await assert.rejects(createCodexAdapter({ path, spawn: leak.spawn, managedFiles: [] }).extract('x'), /read a file it must not be able to read/);
});

test('Codex fetch: the owner\'s own Granola server, one allowlisted tool with Serra\'s arguments, every other server off', async (t) => {
  const path = bin(t);
  const servers = JSON.stringify([{ name: 'granola', enabled: true, auth_status: 'o_auth' }, { name: 'github', enabled: true }, { name: 'old', enabled: false }]);
  const call = (args: Record<string, unknown>, result: Record<string, unknown>) => [
    ev({ type: 'turn.started' }),
    ev({ type: 'item.started', item: { type: 'mcp_tool_call', server: 'granola', tool: 'get_meeting_transcript', arguments: args, status: 'in_progress' } }),
    ev({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'granola', tool: 'get_meeting_transcript', arguments: args, ...result } }),
    ev({ type: 'item.completed', item: { type: 'agent_message', text: 'SHOULD NOT BE USED' } }),
  ];
  const ok = fakeCodex((args) => (args[0] === 'mcp' ? [servers] : call({ meeting_id: 'abc' }, { result: { content: [{ type: 'text', text: 'Ana: three attempts.' }] } })));
  const reader = createCodexAdapter({ path, spawn: ok.spawn, managedFiles: [] });
  assert.equal((await reader.fetchTranscript({ provider: 'granola', id: 'abc', url: 'x' })).text, 'Ana: three attempts.');
  const run = ok.calls.at(-1)!;
  const configs = run.args.flatMap((arg, at) => (run.args[at - 1] === '-c' ? [arg] : []));
  assert.ok(configs.includes('mcp_servers.github.enabled=false'), 'every other server is off');
  assert.ok(configs.includes('mcp_servers.granola.enabled_tools=["get_meeting_transcript"]'));
  assert.ok(!run.args.includes('--ignore-user-config'), 'the owner\'s own servers and sign-ins');
  assert.ok(run.args.some((arg, at) => arg === 'shell_tool' && run.args[at - 1] === '--disable'));
  assert.doesNotMatch(run.stdin, /three attempts/);

  const other = fakeCodex((args) => (args[0] === 'mcp' ? [servers] : call({ meeting_id: 'other' }, { result: { content: [] } })));
  await assert.rejects(createCodexAdapter({ path, spawn: other.spawn, managedFiles: [] }).fetchTranscript({ provider: 'granola', id: 'abc', url: 'x' }), /one call Serra asked for/);
  const failed = fakeCodex((args) => (args[0] === 'mcp' ? [servers] : call({ meeting_id: 'abc' }, { error: { message: 'SECRET-TRANSCRIPT permission denied' } })));
  await assert.rejects(createCodexAdapter({ path, spawn: failed.spawn, managedFiles: [] }).fetchTranscript({ provider: 'granola', id: 'abc', url: 'x' }),
    (error: Error) => !error.message.includes('SECRET-TRANSCRIPT') && /couldn't give Serra that meeting/.test(error.message));
});

test('Codex sources say what the owner must do, and Drive through Codex\'s built-in apps is never used', async (t) => {
  const path = bin(t);
  const fake = fakeCodex(() => [JSON.stringify([{ name: 'granola', enabled: true, auth_status: 'not_logged_in' }])]);
  const status = await createCodexAdapter({ path, spawn: fake.spawn, managedFiles: [] }).status();
  assert.equal(status.find((entry) => entry.provider === 'granola')!.state, 'needs-sign-in');
  assert.match(status.find((entry) => entry.provider === 'granola')!.detail, /codex mcp login granola/);
  const meet = status.find((entry) => entry.provider === 'google-meet')!;
  assert.equal(meet.state, 'missing');
  assert.match(meet.detail, /built-in apps can't be limited to one read tool/);
});

// --- Tools: every T3 provider shows up ---------------------------------------------------------------------------

test('Tools lists every T3 provider: readable ones as groups with the job provider first, the rest as not supported yet', () => {
  const providers = providerEntries(settings({ defaultInstance: 'codex' }), undefined);
  const overview: McpOverview = { worker: { provider: null, drivers: ['codex', 'claude'], note: null }, providers, servers: [], warnings: [], files: [], listing: [] };
  assert.deepEqual(driverGroups(overview).map((group) => [group.title, group.jobs]), [['Codex', true], ['Claude', false]]);
  assert.equal(providerLine(overview), "Jobs run on Codex, T3's default");
  const others = unsupportedProviders(overview);
  assert.deepEqual(others.slice(0, 3).map((entry) => [entry.label, entry.icon]), [['Cursor', 'cursor'], ['Antigravity', 'bot'], ['OpenCode', 'opencode']]);
  assert.ok(others.every((entry) => /yet/.test(entry.unsupported ?? '')));
  const cursorJobs = providerEntries(settings(), 'cursor');
  assert.equal(providerLine({ providers: cursorJobs }), 'Jobs run on Cursor');
  assert.equal(unsupportedProviders({ providers: cursorJobs })[0]!.jobs, true, 'the job provider leads even when unsupported');
});

test('a missing T3 settings file is reported, not filled in', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'serra-t3-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.t3', 'userdata'), { recursive: true });
  writeFileSync(join(home, '.t3', 'userdata', 'settings.json'), '{ not json');
  const read = readT3Providers({ home, env: {} });
  assert.deepEqual([read.state, read.instances, read.defaultInstance], ['unreadable', [], null]);
  assert.equal(providerEntries(read, undefined).some((entry) => entry.jobs), false, 'no job provider is made up');
  assert.equal(readT3Providers({ home: join(home, 'nobody'), env: {} }).state, 'missing');
});
