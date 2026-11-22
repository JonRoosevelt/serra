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
import { createCodexAdapter } from '../src/meeting-codex.ts';
import type { SpawnClaude } from '../src/meeting-extractor.ts';
import { meetingRuntime, type MeetingRuntime } from '../src/meeting-runtime.ts';
import type { T3ProviderSettings } from '../src/providers.ts';
import { driverGroups, providerLine, unsupportedProviders } from '../app/renderer/screens/tools.logic.ts';
import { providerLine as meetingProviderLine } from '../app/renderer/screens/settings/meetings.logic.ts';
import type { McpOverview } from '../src/mcp.ts';
import { providerEntries, readProjectDefault, readT3Providers } from '../src/providers.ts';
import { DatabaseSync } from 'node:sqlite';

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
  assert.equal(meetingRuntime({ path: '', worker: {}, t3: settings({ defaultInstance: 'claudeAgent', projectDefault: { state: 'none' } }), adapters }).runtime?.provider.chosenBy, 't3-default');
  assert.deepEqual(built, ['codex:codex:gpt-x', 'claude:claudeAgent:']);
});

test('the job provider is resolved as `t3 thread start` does: profile, then the project default, then the global one', () => {
  const job = (worker: string | undefined, over: Partial<T3ProviderSettings>) => providerEntries(settings({ defaultInstance: 'codex', ...over }), worker).find((entry) => entry.jobs);
  assert.deepEqual([job('claudeAgent', { projectDefault: { state: 'set', instance: 'codex' } })?.id, job('claudeAgent', {})?.chosenBy], ['claudeAgent', 'profile']);
  assert.deepEqual([job(undefined, { projectDefault: { state: 'set', instance: 'claudeAgent' } })?.id, job(undefined, { projectDefault: { state: 'set', instance: 'claudeAgent' } })?.chosenBy], ['claudeAgent', 't3-project']);
  assert.equal(job(undefined, { projectDefault: { state: 'none' } })?.chosenBy, 't3-default');
  // The project's default couldn't be read: Serra can't tell, and never takes the global default in its place.
  assert.equal(job(undefined, { projectDefault: { state: 'unknown' } }), undefined);
  assert.equal(job(undefined, {}), undefined);
});

test('the project default is read from T3\'s state database, read-only; anything unexpected is unknown', (t) => {
  const home = mkdtempSync(join(tmpdir(), 'serra-t3-db-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, '.t3', 'userdata'), { recursive: true });
  const file = join(home, '.t3', 'userdata', 'statev2.sqlite');
  assert.deepEqual(readProjectDefault('/Users/you/project', { home, env: {} }), { state: 'unknown' }, 'no database');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE projection_projects (workspace_root TEXT, deleted_at TEXT, default_model_selection_json TEXT)');
  db.prepare('INSERT INTO projection_projects VALUES (?, ?, ?)').run('/Users/you/project', null, JSON.stringify({ instanceId: 'claudeAgent', model: 'x' }));
  db.prepare('INSERT INTO projection_projects VALUES (?, ?, ?)').run('/Users/you/plain', null, null);
  db.prepare('INSERT INTO projection_projects VALUES (?, ?, ?)').run('/Users/you/gone', '2026-01-01', null);
  db.close();
  const read = (path: string) => readProjectDefault(path, { home, env: {} });
  assert.deepEqual(read('/Users/you/project'), { state: 'set', instance: 'claudeAgent' });
  assert.deepEqual(read('/Users/you/plain'), { state: 'none' });
  assert.deepEqual(read('/Users/you/gone'), { state: 'unknown' }, 'a deleted project is not one T3 runs jobs in');
  assert.deepEqual(read('/Users/you/elsewhere'), { state: 'unknown' });
});

test('an unsupported or unknown job provider is refused plainly, and no other provider is ever built', () => {
  const { built, adapters } = fakeAdapters();
  for (const [worker, t3, pattern] of [
    [{ provider: 'cursor' }, settings(), /Meetings can't run on Cursor yet, the provider your jobs use\. .*Serra won't use another provider instead\./],
    [{}, settings({ defaultInstance: 'antigravity', projectDefault: { state: 'none' } }), /Meetings can't run on Antigravity yet/],
    [{ provider: 'claude' }, settings(), /can't tell which provider "claude" is/],
    [{}, settings(), /T3 picks the project's default, which Serra couldn't read/],
    [{ provider: 'claude-elsewhere' }, settings({ instances: [{ id: 'claude-elsewhere', driver: 'claudeAgent', otherConfig: ['homePath'] }] }), /can't follow this instance's T3 settings \(homePath\)/],
  ] as const) {
    const choice = meetingRuntime({ path: '', worker, t3, adapters });
    assert.equal(choice.runtime, null);
    assert.match(choice.unsupported ?? '', pattern);
  }
  assert.deepEqual(built, [], 'never falls back to Claude or Codex');
});

// --- Codex: strictest mode, verified against recorded Codex 0.171.0 streams ------------------------------------------

const FIXTURES = new URL('./fixtures/codex-0.171/', import.meta.url).pathname;
const recorded = (name: string): { stdout: string[]; stderr: string } => ({
  stdout: readFileSync(join(FIXTURES, `${name}.stdout.jsonl`), 'utf8').split('\n').filter(Boolean),
  stderr: existsSync(join(FIXTURES, `${name}.stderr.txt`)) ? readFileSync(join(FIXTURES, `${name}.stderr.txt`), 'utf8') : '',
});

/** A fake `codex`: `--version`, `features list`, `mcp list` and `exec` answered by `answer`; records argv, stdin and folder. */
const fakeCodex = (answer: (args: readonly string[], stdin: string, cwd: string) => { stdout: string[]; stderr?: string }, version = 'codex-cli 0.171.0') => {
  const calls: { args: readonly string[]; stdin: string; cwd: string }[] = [];
  const spawn: SpawnClaude = (_command, args, { cwd }) => {
    const child = new EventEmitter() as ChildProcess;
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    Object.assign(child, { stdin, stdout, stderr, exitCode: null, kill: () => { if (!stdout.writableEnded) stdout.end(); return true; } });
    let input = '';
    stdin.on('data', (chunk: Buffer) => { input += chunk.toString(); });
    stdin.on('finish', () => {
      calls.push({ args, stdin: input, cwd });
      const out = args[0] === '--version' ? { stdout: [version] }
        : args[0] === 'features' ? { stdout: ['shell_tool    stable    true', 'goals    stable    true', 'fast_mode    stable    true', 'js_repl    removed    false'] }
          : answer(args, input, cwd);
      if (out.stderr) stderr.write(out.stderr);
      stderr.end();
      for (const line of out.stdout) if (!stdout.writableEnded) stdout.write(`${line}\n`);
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
const answer = (text: string) => ({ stdout: [...recorded('extract').stdout.slice(0, 3), ev({ type: 'item.completed', item: { type: 'agent_message', text } }), ev({ type: 'turn.completed' })] });
const DIGEST = '<meeting-digest>{"items":[]}</meeting-digest>';
const adapter = (path: string, spawn: SpawnClaude, managedFiles: string[] = []) => createCodexAdapter({ path, spawn, managedFiles });

test('Codex extraction, on a recorded 0.171.0 stream: strictest flags, every enabled feature off, prompt on stdin, probe first', async (t) => {
  const path = bin(t);
  const fake = fakeCodex(() => recorded('extract'));
  const pre = await adapter(path, fake.spawn).preflight();
  assert.ok(pre.flags.includes('--ignore-user-config') && pre.flags.includes('read-only') && pre.flags.includes('--ephemeral'));
  for (const feature of ['shell_tool', 'multi_agent', 'goals', 'view_image', 'code_mode_host', 'hooks', 'apps', 'plugins', 'fast_mode']) {
    assert.ok(pre.flags.some((arg, at) => arg === feature && pre.flags[at - 1] === '--disable'), `${feature} is off`);
  }
  assert.ok(pre.flags.includes('notify=[]'), "the owner's notify program never runs");
  assert.ok(!pre.flags.includes('js_repl'), 'only features that are on are named');
  // The probe stopped at Codex's own notice, before the model's turn.
  assert.equal(fake.calls.at(-1)!.stdin, 'Reply with the word ok.');
});

test('Codex fails the same no-tools self-test: asked to use tools, the recorded run routes calls, so meetings refuse it', async (t) => {
  const path = bin(t);
  const fake = fakeCodex((_args, stdin) => (stdin.includes('call every tool') ? recorded('tool-probe') : answer(DIGEST)));
  const codex = adapter(path, fake.spawn);
  const result = await codex.check();
  assert.equal(result.ok, false);
  assert.match(result.reason ?? '', /Codex failed Serra's no-tools self-test: Codex called a tool.*meetings can't run on Codex yet/);
  await assert.rejects(codex.extract('TRANSCRIPT-BYTES'), /no-tools self-test/);
  assert.ok(fake.calls.every((call) => !call.stdin.includes('TRANSCRIPT-BYTES')), 'the transcript is never sent');
});

test('Codex refuses before any transcript byte: untested build, managed settings, tools not confirmed off, a custom model provider', async (t) => {
  const path = bin(t);
  const managed = join(path, 'requirements.toml');
  writeFileSync(managed, 'x = 1\n');
  const cases: [ReturnType<typeof fakeCodex>, string[], RegExp][] = [
    [fakeCodex(() => answer(DIGEST), 'codex-cli 9.9.9'), [], /tested with Codex 0\.171\.0/],
    [fakeCodex(() => answer(DIGEST)), [managed], /managed settings/],
    [fakeCodex(() => ({ stdout: [ev({ type: 'turn.started' }), ev({ type: 'item.completed', item: { type: 'agent_message', text: 'ok' } })] })), [], /didn't confirm its tools are off/],
  ];
  for (const [fake, managedFiles, reason] of cases) {
    await assert.rejects(adapter(path, fake.spawn, managedFiles).extract('TRANSCRIPT-BYTES'), reason);
    assert.ok(fake.calls.every((call) => !call.stdin.includes('TRANSCRIPT-BYTES')));
  }
  const home = join(path, 'codex-home');
  mkdirSync(home);
  writeFileSync(join(home, 'config.toml'), 'model_provider = "azure"\n\n[model_providers.azure]\nname = "Azure"\n');
  const saved = process.env.CODEX_HOME;
  process.env.CODEX_HOME = home;
  t.after(() => { if (saved === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = saved; });
  const routed = fakeCodex(() => answer(DIGEST));
  await assert.rejects(adapter(path, routed.spawn).extract('TRANSCRIPT-BYTES'), /sends requests through `model_provider`.*won't run on Codex rather than go elsewhere/);
});

test('Codex: a tool item, or a call only Codex\'s log shows, throws the answer away; a leaked canary fails the self-test', async (t) => {
  const path = bin(t);
  const item = fakeCodex(() => ({ stdout: [...recorded('extract').stdout.slice(0, 3), ev({ type: 'item.completed', item: { type: 'command_execution', command: 'ls' } })] }));
  const pre = await adapter(path, item.spawn).preflight();
  await assert.rejects(adapter(path, item.spawn).selfTest(pre), /called a tool/);
  const logged = fakeCodex(() => ({ ...answer(DIGEST), stderr: recorded('tool-probe').stderr }));
  await assert.rejects(adapter(path, logged.spawn).extract('x'), /called a tool/);
  const leak = fakeCodex((_args, stdin, cwd) => (stdin.includes('canary.txt') ? answer(readFileSync(join(cwd, 'canary.txt'), 'utf8')) : answer(DIGEST)));
  await assert.rejects(adapter(path, leak.spawn).extract('x'), /read a file it must not be able to read/);
});

test('Codex fetch, on a recorded mcp_tool_call: the owner\'s own Granola server, one allowlisted tool, every other server off', async (t) => {
  const path = bin(t);
  const servers = { stdout: [JSON.stringify([{ name: 'granola', enabled: true, auth_status: 'o_auth' }, { name: 'github', enabled: true }, { name: 'old', enabled: false }])] };
  const ok = fakeCodex((args) => (args[0] === 'mcp' ? servers : recorded('fetch')));
  const fetched = await adapter(path, ok.spawn).fetchTranscript({ provider: 'granola', id: 'abc', url: 'x' });
  assert.match(fetched.text, /^Ana: three attempts\./);
  const run = ok.calls.at(-1)!;
  const configs = run.args.flatMap((arg, at) => (run.args[at - 1] === '-c' ? [arg] : []));
  assert.ok(configs.includes('mcp_servers.github.enabled=false'), 'every other server is off');
  assert.ok(configs.includes('mcp_servers.granola.enabled_tools=["get_meeting_transcript"]'));
  assert.ok(configs.includes('notify=[]'));
  assert.ok(run.args.some((arg, at) => arg === 'shell_tool' && run.args[at - 1] === '--disable'));
  assert.ok(!run.args.includes('--ignore-user-config'), "the owner's own servers and sign-ins");
  assert.equal(ok.calls.filter((call) => call.args[0] === 'mcp').length, 1, 'one server listing per fetch');

  const other = fakeCodex((args) => (args[0] === 'mcp' ? servers : { stdout: recorded('fetch').stdout.map((line) => line.replace('"meeting_id":"abc"', '"meeting_id":"other"')) }));
  await assert.rejects(adapter(path, other.spawn).fetchTranscript({ provider: 'granola', id: 'abc', url: 'x' }), /one call Serra asked for/);
  const failed = fakeCodex((args) => (args[0] === 'mcp' ? servers : { stdout: [ev({ type: 'item.completed', item: { type: 'mcp_tool_call', server: 'granola', tool: 'get_meeting_transcript', arguments: { meeting_id: 'abc' }, result: null, error: { message: 'SECRET-TRANSCRIPT permission denied' } } })] }));
  await assert.rejects(adapter(path, failed.spawn).fetchTranscript({ provider: 'granola', id: 'abc', url: 'x' }),
    (error: Error) => !error.message.includes('SECRET-TRANSCRIPT') && /couldn't give Serra that meeting/.test(error.message));
});

test('a runtime never fetches through a provider whose extractor fails the self-test', async () => {
  const fetched: string[] = [];
  const failing = (provider: MeetingRuntime['provider']): MeetingRuntime => ({
    provider, extract: async () => '', sources: async () => [],
    fetchTranscript: async (link) => { fetched.push(link.id); return { text: '', title: null }; },
    check: async () => ({ ok: false, reason: "Codex failed Serra's no-tools self-test." }),
  });
  const choice = meetingRuntime({ path: '', worker: { provider: 'codex' }, t3: settings(), adapters: { codex: failing } });
  await assert.rejects(choice.runtime!.fetchTranscript({ provider: 'granola', id: 'abc', url: 'x' }), /no-tools self-test/);
  assert.deepEqual(fetched, []);
});

test('Codex sources say what the owner must do, and Drive through Codex is not supported yet', async (t) => {
  const path = bin(t);
  const fake = fakeCodex(() => ({ stdout: [JSON.stringify([{ name: 'granola', enabled: true, auth_status: 'not_logged_in' }, { name: 'gdrive', enabled: true }])] }));
  const status = await adapter(path, fake.spawn).status();
  assert.equal(status.find((entry) => entry.provider === 'granola')!.state, 'needs-sign-in');
  assert.match(status.find((entry) => entry.provider === 'granola')!.detail, /codex mcp login granola/);
  const meet = status.find((entry) => entry.provider === 'google-meet')!;
  assert.equal(meet.state, 'missing', 'a server named like Drive is not taken on trust');
  assert.match(meet.detail, /Not supported yet through Codex/);
});

// --- Tools: every T3 provider shows up ---------------------------------------------------------------------------

test('Tools lists every T3 provider: readable ones as groups with the job provider first, the rest as not supported yet', () => {
  const providers = providerEntries(settings({ defaultInstance: 'codex', projectDefault: { state: 'none' } }), undefined);
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

test('Settings › Meetings says plainly where meetings run, and shows sources only for a provider that passed its checks', () => {
  const claude = providerEntries(settings({ defaultInstance: 'claudeAgent', projectDefault: { state: 'none' } }), undefined).find((entry) => entry.jobs)!;
  const codex = providerEntries(settings(), 'codex').find((entry) => entry.jobs)!;
  const cursor = providerEntries(settings(), 'cursor').find((entry) => entry.jobs)!;
  const ready = meetingProviderLine({ provider: claude, unsupported: null, extraction: { ok: true, reason: null }, sources: [] });
  assert.deepEqual([ready.title, ready.badge.label, ready.showSources], ['Runs on Claude', 'Ready', true]);
  assert.match(ready.detail, /T3's default provider\. It passed Serra's no-tools self-test\./);
  const failing = meetingProviderLine({ provider: codex, unsupported: null, extraction: { ok: false, reason: "Codex failed Serra's no-tools self-test." }, sources: [] });
  assert.deepEqual([failing.badge.label, failing.detail, failing.showSources], ['Not ready', "Codex failed Serra's no-tools self-test.", false]);
  const unsupported = meetingProviderLine({ provider: cursor, unsupported: "Meetings can't run on Cursor yet. Serra won't use another provider instead.", extraction: null, sources: [] });
  assert.deepEqual([unsupported.title, unsupported.badge.label, unsupported.showSources], ['Runs on Cursor', 'Not supported yet', false]);
});
