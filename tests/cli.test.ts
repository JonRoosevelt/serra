import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { codeRoot } from '../src/config.ts';

test('documented setup, resume, knowledge and interview commands work with explicit profile arguments', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bots-cli-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'my bot'); const config = join(root, 'input.json');
  writeFileSync(config, JSON.stringify({ version: 1, bot: { id: 'atlas', name: 'Atlas' }, owner: { name: 'Alex', slackUserId: 'U12345', githubLogin: 'alex' }, project: { path: root, remote: 'origin', baseRef: 'origin/main', githubRepo: 'acme/project' }, allowedUsers: [] }));
  const invoke = (file: string, args: string[]) => execFileSync(process.execPath, [join(codeRoot, 'src', file), ...args], { encoding: 'utf8', env: { ...process.env, BOT_PROFILE: '' } });
  assert.match(invoke('setup.ts', ['--config', config, '--profile', directory]), /Profile created/);
  assert.equal(JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')).display_information.name, 'Atlas');
  writeFileSync(join(directory, '.env'), 'do-not-overwrite');
  assert.match(invoke('setup.ts', ['--profile', directory]), /Existing profile preserved/);
  assert.equal(readFileSync(join(directory, '.env'), 'utf8'), 'do-not-overwrite');
  assert.match(invoke('check-knowledge.ts', ['--profile', directory]), /0 pages, 0 verified/);
  assert.match(invoke('onboard.ts', ['--profile', directory]), /one question at a time/);
});
