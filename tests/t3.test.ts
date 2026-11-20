import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { run, sendToThread, showThread, startThread } from '../src/t3.ts';

test('CLI contract preserves custom branches, stdin briefs, follow-ups and run IDs', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'bots-t3-')); t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 't3'); const capture = join(root, 'capture.json');
  writeFileSync(bin, `#!${process.execPath}\nconst fs=require('fs'); const args=process.argv.slice(2); let input=''; process.stdin.on('data',x=>input+=x); process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify({args,input})); console.log(JSON.stringify(args[1]==='start'?{threadId:'new-thread'}:args[1]==='show'?{thread:{threadId:'new-thread',link:'t3://thread',status:'idle',latestRunId:'run-2',activeRunId:null},messages:[{role:'assistant',runId:'run-2',text:'done'}]}:{}));});`, { mode: 0o700 });
  assert.equal(await startThread({ project: '/repo with spaces', baseRef: 'origin/develop', branch: 'friday/task-1', title: 'Friday: task', brief: 'quoted {{REQUEST}}\nsecond line' }, bin), 'new-thread');
  const started = JSON.parse(readFileSync(capture, 'utf8'));
  assert.deepEqual(started.args, ['thread', 'start', '--worktree', 'origin/develop', '--branch', 'friday/task-1', '--title', 'Friday: task', '--json', '/repo with spaces', '-']);
  assert.equal(started.input, 'quoted {{REQUEST}}\nsecond line');
  await startThread({ project: '/repo', baseRef: 'origin/main', branch: 'friday/task-2', title: 'Friday: task', brief: 'brief', provider: 'claude', model: 'opus' }, bin);
  assert.deepEqual(JSON.parse(readFileSync(capture, 'utf8')).args.slice(8, 12), ['--provider', 'claude', '--model', 'opus']);
  await sendToThread('new-thread', 'Alex replied', bin);
  assert.equal(JSON.parse(readFileSync(capture, 'utf8')).input, 'Alex replied');
  assert.equal((await showThread('new-thread', bin)).thread.latestRunId, 'run-2');
});

test('a hung CLI command fails within its timeout', async () => {
  await assert.rejects(run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 30 }), /timed out/);
});
