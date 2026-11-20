import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { cleanupWorktrees, formatCleanup, type Runner } from '../src/cleanup.ts';

const NOW = new Date('2026-11-18T12:00:00Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

interface FakeThread {
  worktreePath?: string | null;
  branch?: string | null;
  activeRunId?: string | null;
  openPullRequestCount?: number;
  updatedAt?: string;
}

/**
 * A profile state.json, a fake worktrees folder, and a runner that answers t3, git and gh from tables.
 * Every call is recorded, and nothing real is run.
 */
const fixture = (t: TestContext) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'bots-cleanup-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const worktreesRoot = join(dir, 'worktrees');
  mkdirSync(worktreesRoot);
  const statePath = join(dir, 'state.json');
  const jobs: Record<string, unknown> = {};
  const threads = new Map<string, FakeThread | Error>();
  const status = new Map<string, string>();
  const unpushed = new Map<string, string>();
  /** Unpushed commits on the worktree's HEAD, and the branch it has checked out, by path. */
  const unpushedHead = new Map<string, string>();
  const checkedOut = new Map<string, string>();
  const prs = new Map<string, string | Error>();
  const calls: { cmd: string; args: string[]; cwd?: string }[] = [];

  const worktree = (name: string): string => {
    const path = join(worktreesRoot, 'project', name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const job = (id: string, lastActivityAt: string | undefined, thread: FakeThread | Error, createdAt = daysAgo(30)): void => {
    jobs[`C1:${id}`] = { t3ThreadId: id, channel: 'C1', threadTs: id, createdAt, ...(lastActivityAt ? { lastActivityAt } : {}) };
    threads.set(id, thread);
    writeFileSync(statePath, JSON.stringify(jobs));
  };

  const run: Runner = async (cmd, args, { cwd } = {}) => {
    calls.push({ cmd, args, cwd });
    if (cmd === 't3') {
      const thread = threads.get(args.at(-1)!);
      if (!thread || thread instanceof Error) throw thread ?? new Error('no such thread');
      return JSON.stringify({ thread: { activeRunId: null, openPullRequestCount: 0, settled: true, updatedAt: daysAgo(30), ...thread }, messages: [] });
    }
    if (cmd === 'git') {
      const path = args[1]!;
      if (args[2] === 'status') return status.get(path) ?? '';
      if (args[2] === 'log') return (args[4] === 'HEAD' ? unpushedHead : unpushed).get(path) ?? '';
      if (args[2] === 'symbolic-ref') {
        // Unset or empty: a detached HEAD, so only T3's branch is checked.
        const head = checkedOut.get(path);
        if (!head) throw new Error('not a symbolic ref');
        return `${head}\n`;
      }
      if (args[2] === 'worktree') return '';
    }
    if (cmd === 'gh') {
      const answer = prs.get(`${cwd}#${args[3]}`) ?? prs.get(cwd!) ?? '[]';
      if (answer instanceof Error) throw answer;
      return answer;
    }
    throw new Error(`unexpected command ${cmd} ${args.join(' ')}`);
  };
  const clean = (options: { apply?: boolean; days?: number } = {}) =>
    cleanupWorktrees({ statePath, t3Bin: 't3', now: NOW, worktreesRoot, run, ...options });
  return { dir, statePath, worktree, job, status, unpushed, unpushedHead, checkedOut, prs, calls, clean };
};

test('a quiet, clean, pushed worktree without PRs would be removed, and a dry run removes nothing', async (t) => {
  const f = fixture(t);
  const path = f.worktree('old');
  f.job('T1', daysAgo(5), { worktreePath: path, branch: 'serra/old' });
  const before = readFileSync(f.statePath, 'utf8');

  const [verdict] = await f.clean();
  assert.equal(verdict?.removable, true);
  assert.equal(verdict?.path, path);
  assert.match(verdict?.reason ?? '', /quiet 5 days/);
  assert.ok(!f.calls.some((call) => call.args.includes('remove')));
  assert.deepEqual(f.calls.find((call) => call.cmd === 'gh'), {
    cmd: 'gh', args: ['pr', 'list', '--head', 'serra/old', '--state', 'open', '--json', 'number'], cwd: path,
  });
  assert.deepEqual(f.calls.find((call) => call.args[2] === 'log')?.args, ['-C', path, 'log', '--oneline', 'refs/heads/serra/old', '--not', '--remotes']);
  assert.equal(readFileSync(f.statePath, 'utf8'), before, 'state.json is never written');
  assert.match(formatCleanup([verdict!], false), /^remove {2}.*old: quiet 5 days[\s\S]*1 worktree\(s\) would be removed, 0 job\(s\) kept/);
});

test('--apply removes with git worktree remove and never forces', async (t) => {
  const f = fixture(t);
  const path = f.worktree('old');
  f.job('T1', daysAgo(5), { worktreePath: path, branch: 'serra/old' });
  const verdicts = await f.clean({ apply: true });
  assert.equal(verdicts[0]?.removed, true);
  const removals = f.calls.filter((call) => call.args.includes('remove'));
  assert.deepEqual(removals.map((call) => call.args), [['-C', path, 'worktree', 'remove', path]]);
  assert.ok(!f.calls.some((call) => call.args.includes('--force')));
  assert.match(formatCleanup(verdicts, true), /removed .*old[\s\S]*1 of 1 removable worktree\(s\) removed/);
});

test('keeps every worktree that fails one of the checks, with the reason', async (t) => {
  const f = fixture(t);
  const make = (name: string, thread: FakeThread = {}, activity = daysAgo(10)): string => {
    const path = f.worktree(name);
    f.job(name, activity, { worktreePath: path, branch: `serra/${name}`, ...thread });
    return path;
  };
  make('recent', {}, daysAgo(1));
  make('running', { activeRunId: 'run:1' });
  make('t3-pr', { openPullRequestCount: 1 });
  f.status.set(make('dirty'), ' M file.ts\n');
  f.unpushed.set(make('unpushed'), 'abc123 wip\ndef456 more\n');
  f.prs.set(make('gh-pr'), '[{"number":12}]');
  f.prs.set(make('gh-fails'), new Error('gh auth required'));
  f.job('no-path', daysAgo(10), { worktreePath: null, branch: 'serra/x' });
  f.job('gone', daysAgo(10), { worktreePath: join(f.dir, 'worktrees/project/gone'), branch: 'serra/gone' });
  const outside = join(f.dir, 'elsewhere');
  mkdirSync(outside);
  f.job('outside', daysAgo(10), { worktreePath: outside, branch: 'serra/outside' });
  f.job('t3-fails', daysAgo(10), new Error('t3 not running'));
  f.job('no-date', 'not a date', { worktreePath: f.worktree('no-date'), branch: 'b' });

  const reasons = Object.fromEntries((await f.clean({ apply: true })).map((v) => {
    assert.equal(v.removable, false, v.threadId);
    return [v.threadId, v.reason];
  }));
  assert.match(reasons.recent!, /active 1\.0 days ago, under 3/);
  assert.match(reasons.running!, /run is in progress/);
  assert.match(reasons['t3-pr']!, /1 open PR\(s\) in T3/);
  assert.match(reasons.dirty!, /uncommitted changes/);
  assert.match(reasons.unpushed!, /2 unpushed commit\(s\) on serra\/unpushed/);
  assert.match(reasons['gh-pr']!, /1 open PR\(s\) on GitHub/);
  assert.match(reasons['gh-fails']!, /couldn't check GitHub PRs: gh auth required/);
  assert.match(reasons['no-path']!, /no worktree/);
  assert.match(reasons.gone!, /already gone/);
  assert.match(reasons.outside!, /not inside the T3 worktrees folder/);
  assert.match(reasons['t3-fails']!, /couldn't read the T3 thread/);
  assert.match(reasons['no-date']!, /no readable activity date/);
  assert.ok(!f.calls.some((call) => call.args.includes('remove')), 'nothing removed');
  // A recent job never costs git or gh calls.
  assert.ok(!f.calls.some((call) => call.cmd !== 't3' && call.args.some((arg) => arg.includes('recent'))));
});

test('--days changes the quiet period, and createdAt stands in for a missing lastActivityAt', async (t) => {
  const f = fixture(t);
  f.job('T1', undefined, { worktreePath: f.worktree('a'), branch: 'serra/a' }, daysAgo(2));
  assert.equal((await f.clean())[0]?.removable, false);
  assert.equal((await f.clean({ days: 1 }))[0]?.removable, true);
});

test('a worktree shared with a job that is kept stays, and a shared removable one is removed once', async (t) => {
  const f = fixture(t);
  const shared = f.worktree('shared');
  f.job('old', daysAgo(10), { worktreePath: shared, branch: 'serra/shared' });
  f.job('new', daysAgo(0), { worktreePath: shared, branch: 'serra/shared' });
  const both = f.worktree('both');
  f.job('old1', daysAgo(10), { worktreePath: both, branch: 'serra/both' });
  f.job('old2', daysAgo(10), { worktreePath: both, branch: 'serra/both' });
  f.job('busy', daysAgo(10), { worktreePath: both, branch: 'serra/both', activeRunId: 'run:2' });
  const verdicts = await f.clean({ apply: true });
  const byId = Object.fromEntries(verdicts.map((v) => [v.threadId, v]));
  assert.equal(byId.old?.removable, false);
  assert.match(byId.old?.reason ?? '', /another job still uses/);
  assert.equal(byId.old1?.removable, false);
  assert.match(byId.old1?.reason ?? '', /another job still uses/);
  assert.equal(byId.busy?.removable, false);
  assert.ok(!f.calls.some((call) => call.args.includes('remove')));
});

test('two removable jobs on one worktree remove it once', async (t) => {
  const f = fixture(t);
  const path = f.worktree('twice');
  f.job('a', daysAgo(10), { worktreePath: path, branch: 'serra/twice' });
  f.job('b', daysAgo(10), { worktreePath: path, branch: 'serra/twice' });
  const verdicts = await f.clean({ apply: true });
  assert.deepEqual(verdicts.map((v) => v.removable), [true, false]);
  assert.match(verdicts[1]?.reason ?? '', /listed above/);
  assert.equal(f.calls.filter((call) => call.args.includes('remove')).length, 1);
});

test('keeps a worktree whose HEAD has unpushed work, whose current branch has an open PR, or that changed in T3 recently', async (t) => {
  const f = fixture(t);
  const detached = f.worktree('detached');
  f.job('T1', daysAgo(5), { worktreePath: detached, branch: 'serra/a' });
  f.checkedOut.set(detached, '');
  f.unpushedHead.set(detached, 'abc123 wip on a detached HEAD');

  const renamed = f.worktree('renamed');
  f.job('T2', daysAgo(5), { worktreePath: renamed, branch: 'serra/b' });
  f.checkedOut.set(renamed, 'TEAM-1811/b');
  f.prs.set(`${renamed}#TEAM-1811/b`, '[{"number":7}]');

  const continuedInT3 = f.worktree('t3');
  f.job('T3', daysAgo(5), { worktreePath: continuedInT3, branch: 'serra/c', updatedAt: daysAgo(0.5) });

  const verdicts = await f.clean();
  assert.deepEqual(verdicts.map((v) => v.removable), [false, false, false]);
  assert.match(verdicts[0]!.reason, /unpushed commit\(s\) on the worktree's HEAD/);
  assert.match(verdicts[1]!.reason, /open PR\(s\) on GitHub for TEAM-1811\/b/);
  assert.match(verdicts[2]!.reason, /changed in T3 0\.5 days ago/);
});

test('a clock slightly ahead never reads as "-0.0 days ago"', async (t) => {
  // QA: a job written a moment ago, or a T3 clock a little ahead, showed "changed in T3 -0.0 days ago".
  const f = fixture(t);
  f.job('ahead', daysAgo(-0.001), { worktreePath: f.worktree('ahead'), branch: 'serra/ahead' });
  f.job('t3-ahead', daysAgo(10), { worktreePath: f.worktree('t3-ahead'), branch: 'serra/t3-ahead', updatedAt: daysAgo(-0.001) });
  const reasons = Object.fromEntries((await f.clean()).map((v) => [v.threadId, v.reason]));
  assert.equal(reasons.ahead, 'active 0.0 days ago, under 3');
  assert.equal(reasons['t3-ahead'], 'changed in T3 0.0 days ago, under 3');
});
