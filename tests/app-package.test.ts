import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import test from 'node:test';
import { missingRuntimeFiles, runtimeFiles } from '../app/main/runtime-files.ts';
import { toolPath } from '../app/main/tool-path.ts';
import { codeRoot } from '../src/config.ts';
import { PACKAGED_SOURCE, releaseSourceRoot, stageReleaseSource } from '../src/deploy.ts';

const config = readFileSync(join(codeRoot, 'electron-builder.yml'), 'utf8');

/** The `files:` list of electron-builder.yml: include patterns and `!` exclude patterns. */
const filePatterns = (): { include: string[]; exclude: string[] } => {
  const lines = config.split('\n');
  const start = lines.indexOf('files:');
  assert.notEqual(start, -1, 'electron-builder.yml has a files list');
  const entries: string[] = [];
  for (const line of lines.slice(start + 1)) {
    const match = /^\s+-\s+"?([^"]+?)"?\s*$/.exec(line);
    if (!match) break;
    entries.push(match[1] ?? '');
  }
  return { include: entries.filter((e) => !e.startsWith('!')), exclude: entries.filter((e) => e.startsWith('!')).map((e) => e.slice(1)) };
};

const glob = (pattern: string): RegExp => new RegExp(`^${pattern
  .replace(/[.+^${}()|[\]\\]/g, '\\$&')
  .replace(/\*\*\//g, '\u0001').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*')
  .replace(/\u0001/g, '(?:.*/)?').replace(/\u0000/g, '.*')}$`);

const packaged = (path: string): boolean => {
  const { include, exclude } = filePatterns();
  // A folder (no extension, like templates/knowledge) is packaged when its contents are.
  const candidates = extname(path) ? [path] : [path, `${path}/page.md`];
  return candidates.some((candidate) => include.some((p) => glob(p).test(candidate)) && !exclude.some((p) => glob(p).test(candidate)));
};

test('the packaged app carries every file the code reads at run time, at the same relative path', () => {
  const missing = runtimeFiles.filter((path) => !packaged(path));
  assert.deepEqual(missing, [], 'electron-builder.yml files must cover these');
});

test('templates, examples and the menubar icons exist in the checkout', () => {
  // app/out/ only exists after `pnpm app:build`, so the checkout test leaves the build output to `--smoke`.
  assert.deepEqual(missingRuntimeFiles(codeRoot).filter((path) => !path.startsWith('app/out/')), []);
});

test('the build has no Developer ID signature and its output folder is git-ignored', () => {
  assert.match(config, /^\s+identity: "-"$/m, 'ad-hoc signature only, no Developer ID');
  assert.match(config, /^\s+output: release$/m);
  const ignored = readFileSync(join(codeRoot, '.gitignore'), 'utf8').split('\n');
  for (const folder of ['release/', 'out/']) assert.ok(ignored.includes(folder), `${folder} is git-ignored`);
  assert.ok(!packaged('app/out/main/index.mjs.map'), 'source maps stay out of the package');
  assert.ok(!packaged('src/config.ts'), 'the bundle replaces src/');
});

test('the packaged app adds Homebrew and ~/.local/bin to launchd\'s short PATH, after what is there', () => {
  assert.equal(toolPath('/usr/bin:/bin:/usr/sbin:/sbin', '/Users/me'), '/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin');
  assert.equal(toolPath('/opt/homebrew/bin:/usr/bin', '/Users/me'), '/opt/homebrew/bin:/usr/bin:/usr/local/bin:/Users/me/.local/bin', 'no duplicates');
  assert.equal(toolPath(undefined, '/Users/me'), '/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin');
});

test('the package ships a pristine copy of the daemon code for Updates › Prepare, beside the app folder', (t) => {
  // electron-builder.yml's extraResources entry: `to` is relative to Contents/Resources, where the app folder is.
  const block = config.slice(config.indexOf('extraResources:'));
  assert.match(block, /^\s+- from: app\/out\/release-source$/m);
  assert.match(block, new RegExp(`^\\s+to: ${PACKAGED_SOURCE}$`, 'm'), 'the folder prepare looks in (src/deploy.ts)');
  assert.ok(!packaged('app/out/release-source/src/index.ts'), 'not a second time inside the app folder');

  const resources = mkdtempSync(join(tmpdir(), 'serra-resources-')); t.after(() => rmSync(resources, { recursive: true, force: true }));
  const staged = join(resources, PACKAGED_SOURCE);
  stageReleaseSource(codeRoot, staged);
  for (const name of ['src/index.ts', 'templates/brief.md', 'examples/profile.json', 'pnpm-lock.yaml', 'tsconfig.json', 'docs/configuration.md']) {
    assert.ok(existsSync(join(staged, name)), `release-source has ${name}`);
  }
  assert.equal(readFileSync(join(staged, 'package.json'), 'utf8'), readFileSync(join(codeRoot, 'package.json'), 'utf8'), 'the package.json the lockfile matches');
  assert.ok(!existsSync(join(staged, 'docs/app')), 'the screenshots in docs/app stay out');
  assert.equal(releaseSourceRoot(join(resources, 'app')), staged, 'prepare in the app folder finds it');
});
