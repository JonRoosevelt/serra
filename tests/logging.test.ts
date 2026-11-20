import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LogLevel } from '@slack/bolt';
import { eventLog, tailLog, timestampedLogger } from '../src/logging.ts';
import { branchName } from '../src/branch.ts';

const at = () => new Date('2026-11-18T10:00:00.000Z');

test('log lines carry a timestamp, a level and the logger name, and respect the level', () => {
  const lines: string[] = [];
  const logger = timestampedLogger(LogLevel.INFO, at, (line) => lines.push(line));
  logger.setName('socket-mode:SlackWebSocket:3');
  logger.debug('hidden');
  logger.warn('A pong wasn\'t received', { ms: 5000 });
  assert.deepEqual(lines, ['2026-11-18T10:00:00.000Z [WARN] socket-mode:SlackWebSocket:3 A pong wasn\'t received {"ms":5000}']);
  const circular: Record<string, unknown> = {}; circular.self = circular;
  logger.error(new Error('listener failed'), circular);
  assert.match(lines[1]!, /\[ERROR\] .*Error: listener failed\n\s+at /);
  assert.match(lines[1]!, /\[object Object\]$/);
  lines.splice(1);
  logger.setLevel(LogLevel.DEBUG);
  logger.debug('shown');
  assert.equal(lines.length, 2);
});

test('events are one JSON line each, and a failed write breaks nothing', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'bots-events-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'events.jsonl');
  const events = eventLog(file, at);
  events('reply', { key: 'C1:1', kind: 'quiet' });
  events('job_started', { key: 'C1:2' });
  assert.deepEqual(readFileSync(file, 'utf8').trim().split('\n').map((line) => JSON.parse(line)), [
    { at: '2026-11-18T10:00:00.000Z', event: 'reply', key: 'C1:1', kind: 'quiet' },
    { at: '2026-11-18T10:00:00.000Z', event: 'job_started', key: 'C1:2' },
  ]);
  assert.doesNotThrow(() => eventLog(join(dir, 'missing/dir/events.jsonl'))('x', {}));
});

test('branch names fill the date placeholders from the given day', () => {
  const now = new Date(2026, 0, 5, 9);
  assert.match(branchName('TEAM-{DDMM}/{slug}-{stamp}', { id: 'serra', request: 'Fix: the BANNER!!', now }), /^TEAM-0501\/fix-the-banner-[a-z0-9]+$/);
  assert.match(branchName('{id}/{MMDD}-{slug}-{stamp}', { id: 'serra', request: '!!!', now }), /^serra\/0105-task-[a-z0-9]+$/);
});

const logDir = (t: import('node:test').TestContext): string => {
  const dir = mkdtempSync(join(tmpdir(), 'serra-tail-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const numbered = (from: number, to: number): string => Array.from({ length: to - from + 1 }, (_, i) => `line ${from + i}\n`).join('');

test('tailLog returns the last N lines, oldest first, reading backwards in small chunks', (t) => {
  const file = join(logDir(t), 'bot.log');
  writeFileSync(file, numbered(1, 500));
  assert.deepEqual(tailLog(file, 3), ['line 498', 'line 499', 'line 500']);
  assert.deepEqual(tailLog(file, 3, { chunkSize: 7 }), ['line 498', 'line 499', 'line 500']);
  assert.equal(tailLog(file, 1000).length, 500);
  assert.deepEqual(tailLog(file, 0), []);
});

test('tailLog keeps a last line without a newline, CRLF endings and characters split across chunks', (t) => {
  const file = join(logDir(t), 'bot.log');
  writeFileSync(file, 'första\r\nandra ✓\r\nlast');
  assert.deepEqual(tailLog(file, 2, { chunkSize: 3 }), ['andra ✓', 'last']);
});

test('tailLog of a missing or empty log is empty', (t) => {
  const dir = logDir(t);
  assert.deepEqual(tailLog(join(dir, 'missing.log'), 10), []);
  writeFileSync(join(dir, 'empty.log'), '');
  assert.deepEqual(tailLog(join(dir, 'empty.log'), 10), []);
});

test('after a rotation, tailLog fills the tail from the newest rotated copies and skips compressed ones', (t) => {
  const dir = logDir(t);
  const file = join(dir, 'bot.log');
  writeFileSync(file, numbered(9, 10));
  writeFileSync(`${file}.0`, numbered(5, 8));
  writeFileSync(`${file}.1`, numbered(1, 4));
  writeFileSync(`${file}.2.gz`, 'not text');
  writeFileSync(join(dir, 'bot.log.old'), 'unrelated\n');
  assert.deepEqual(tailLog(file, 3), ['line 8', 'line 9', 'line 10']);
  assert.deepEqual(tailLog(file, 7), ['line 4', 'line 5', 'line 6', 'line 7', 'line 8', 'line 9', 'line 10']);
  assert.equal(tailLog(file, 100).length, 10);
  // Rotated and not written to yet: the whole tail comes from the copy.
  writeFileSync(file, '');
  assert.deepEqual(tailLog(file, 2), ['line 7', 'line 8']);
});
