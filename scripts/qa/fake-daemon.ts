// Fake daemon for QA: serves the real status socket (src/status-socket.ts) for a profile. Commands on stdin, one
// JSON per line: {"status": {...UpStatus fields}} or {"event": ["needs_owner", {"key": "C1:1"}]} or {"quit": true}.
import { createInterface } from 'node:readline';
import { startStatusServer } from '../../src/status-socket.ts';

const profileDir = process.argv[2]!;
let status = { state: 'up' as const, pid: process.pid, startedAt: new Date().toISOString(), slackConnected: true, counts: { needsYou: 0, running: 0 } };
const server = await startStatusServer({ profileDir, status: () => status });
console.log('READY ' + server.path);
for await (const line of createInterface({ input: process.stdin })) {
  if (!line.trim()) continue;
  const cmd = JSON.parse(line);
  if (cmd.status) { status = { ...status, ...cmd.status }; server.refresh(); }
  if (cmd.event) server.publish(cmd.event[0], cmd.event[1]);
  if (cmd.quit) { await server.close(); process.exit(0); }
  console.log('OK');
}
