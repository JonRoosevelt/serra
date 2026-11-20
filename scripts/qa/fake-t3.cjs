#!/usr/bin/env node
// Fake T3 CLI for QA: records calls, never starts real work.
const fs = require('fs');
const args = process.argv.slice(2);
let input = '';
const done = () => {
  fs.appendFileSync('/tmp/serra-qa/t3-calls.jsonl', JSON.stringify({ args, input: input.slice(0, 20000) }) + '\n');
  const [a, b] = args;
  if (args.includes('--help')) { console.log('usage: t3 thread start'); return; }
  if (a === 'thread' && b === 'list') { console.log('[]'); return; }
  if (a === 'thread' && b === 'start') {
    if (process.env.QA_T3_FAIL) { console.error('fake t3: no worktree'); process.exit(1); }
    const id = 'qa-thread-' + Date.now();
    console.log(JSON.stringify({ threadId: id })); return;
  }
  if (a === 'thread' && b === 'show') {
    const id = args.at(-1);
    console.log(JSON.stringify({ thread: { threadId: id, title: 'QA Bot: task', link: 'https://t3.test/' + id, status: 'running',
      latestRunId: 'run-1', activeRunId: id.includes('done') ? null : 'run-1', pendingRequestCount: 0,
      worktreePath: '/tmp/serra-qa/not-a-t3-worktree/' + id, branch: 'qa/' + id, updatedAt: new Date().toISOString() }, messages: [] }));
    return;
  }
  console.error('fake t3: unknown ' + args.join(' ')); process.exit(2);
};
const reads = args[0] === 'thread' && (args[1] === 'start' || args[1] === 'send') && !args.includes('--help');
if (!reads) done(); else { process.stdin.on('data', (c) => input += c); process.stdin.on('end', done); }
