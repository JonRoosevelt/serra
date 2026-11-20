import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import type { HandlerContext } from '../app/main/ipc/context.ts';
import { toolsHandlers } from '../app/main/ipc/tools.ts';
import { memoryPrefs } from '../app/main/prefs.ts';
import { stoppedStatusSource } from '../app/main/status.ts';
import { driverGroups, providerLine, transportLabel } from '../app/renderer/screens/tools.logic.ts';
import { writeProfileFile, type Profile } from '../src/config.ts';
import { runCli } from '../src/manage.ts';
import type { McpOverview, McpServer } from '../src/mcp.ts';

const TOKEN = 'sntrys_fixture-secret-value';

const setup = (t: TestContext) => {
  const root = mkdtempSync(join(tmpdir(), 'serra-app-tools-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const project = join(root, 'project');
  const profileDir = join(root, 'profile');
  for (const dir of [home, project, profileDir]) mkdirSync(dir, { recursive: true });
  const profile: Profile = {
    version: 1, bot: { id: 'friday', name: 'Friday' }, owner: { name: 'Alex', slackUserId: 'U0123456789', githubLogin: 'alex' },
    project: { path: project, remote: 'origin', baseRef: 'origin/main', githubRepo: 'acme/project' }, allowedUsers: [],
    worker: { provider: 'claude', model: 'opus' },
    messageTriggers: [{ channel: 'C0123456789', botId: 'B0123456789', instructions: 'Investigate this Sentry alert.' }],
  };
  writeProfileFile(profileDir, profile);
  const context: HandlerContext = {
    profileDir: () => profileDir, profileDirOrNull: () => profileDir, prefs: memoryPrefs(), status: stoppedStatusSource(),
    runtime: { version: '0.0.0', electron: '45.4.1', node: '24.0.0', platform: 'darwin' },
    openExternal: async () => {}, openPath: async () => {},
  };
  return { home, project, profileDir, context };
};

test('tools.overview returns the servers and the missing-server warning, structured-clone safe and without secrets', async (t) => {
  const f = setup(t);
  writeFileSync(join(f.home, '.claude.json'), JSON.stringify({
    mcpServers: { github: { type: 'http', url: 'https://api.github.example/mcp', headers: { Authorization: `Bearer ${TOKEN}` } } },
  }));
  const overview = structuredClone(await toolsHandlers(f.context, { home: f.home, env: {} }).overview());
  assert.deepEqual(overview.servers.map((server) => server.name), ['github']);
  assert.deepEqual(overview.warnings.map((warning) => [warning.tool, warning.driver, warning.channels]), [['Sentry', 'claude', ['C0123456789']]]);
  assert.ok(!JSON.stringify(overview).includes(TOKEN));
});

test('tools.overview without a selected profile throws the context message', (t) => {
  const f = setup(t);
  const handlers = toolsHandlers({ ...f.context, profileDir: () => { throw new Error('No bot profile selected.'); } });
  assert.throws(() => handlers.overview(), /No bot profile selected/);
});

test('pnpm bot tools prints the overview and the warning', async (t) => {
  const f = setup(t);
  const out: string[] = [];
  const previous = { HOME: process.env.HOME, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, CODEX_HOME: process.env.CODEX_HOME };
  process.env.HOME = f.home;
  process.env.CLAUDE_CONFIG_DIR = f.home;
  process.env.CODEX_HOME = join(f.home, '.codex');
  t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const code = await runCli(['tools', '--profile', f.profileDir], { log: (text) => out.push(text), error: (text) => out.push(text) });
  assert.equal(code, 0, out.join('\n'));
  assert.match(out.join('\n'), /Worker provider: claude/);
  assert.match(out.join('\n'), /! The alert trigger for channel C0123456789 mentions Sentry, but Claude has no Sentry MCP server/);
});

const server = (overrides: Partial<McpServer>): McpServer => ({
  name: 'x', driver: 'claude', scope: 'user', source: '~/.claude.json', transport: 'stdio', host: null, load: 'loads', note: null, ...overrides,
});

test('driverGroups puts loading servers first and summarizes each provider', () => {
  const overview: McpOverview = {
    worker: { provider: null, drivers: ['claude', 'codex'], note: 'both' },
    servers: [
      server({ name: 'zeta', scope: 'project', load: 'unsure' }),
      server({ name: 'beta', load: 'disabled' }),
      server({ name: 'alpha' }),
      server({ name: 'gamma', scope: 'project' }),
    ],
    warnings: [],
    files: [{ driver: 'codex', scope: 'user', path: '~/.codex/config.toml', state: 'unreadable' }],
  };
  const [claude, codex] = driverGroups(overview);
  assert.deepEqual(claude!.servers.map((entry) => entry.name), ['alpha', 'gamma', 'zeta', 'beta']);
  assert.equal(claude!.summary, '2 load, 1 may not load, 1 off');
  assert.equal(codex!.summary, 'No MCP servers');
  assert.deepEqual(codex!.unreadable, ['~/.codex/config.toml']);
  assert.equal(driverGroups({ ...overview, servers: [server({})] })[0]!.summary, '1 loads');
});

test('transport and provider labels', () => {
  assert.equal(transportLabel({ transport: 'stdio', host: null }), 'Local command');
  assert.equal(transportLabel({ transport: 'http', host: 'mcp.example.com' }), 'HTTP · mcp.example.com');
  assert.equal(transportLabel({ transport: 'sse', host: null }), 'SSE');
  assert.equal(transportLabel({ transport: null, host: null }), 'Unknown transport');
  assert.match(providerLine({ provider: 'claude', drivers: ['claude'], note: null }), /"claude" provider/);
  assert.match(providerLine({ provider: null, drivers: ['claude', 'codex'], note: null }), /project's default/);
});
