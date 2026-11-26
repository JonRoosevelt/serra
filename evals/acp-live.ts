// Live check that meeting runs work without T3 (Phase 3 of the agent-backends work): one meeting-run-style ask, the
// read-only kind the weekly knowledge review makes, through a real ACP agent and then through T3, with each reply and
// how long it took. Uses the owner's own logins; spends a little of their plan. Not part of `pnpm test`.
//
//   node evals/acp-live.ts                       Claude Code over ACP (Zed's adapter, fetched by npx), then T3
//   node evals/acp-live.ts --acp codex --skip-t3  another agent from src/agent/acp-agents.ts, on PATH
//   node evals/acp-live.ts --command "npx -y @agentclientprotocol/claude-agent-acp@0.102.0"
//
// Every agent process it starts is stopped when its run ends; the script checks none is left.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createAcpBackend, type AcpAgent } from '../src/agent/acp.ts';
import { KNOWN_ACP_AGENTS } from '../src/agent/acp-agents.ts';
import type { AgentBackend } from '../src/agent/backend.ts';
import { createMeetingRuns } from '../src/meeting-runs.ts';

const { values: args } = parseArgs({
  options: {
    acp: { type: 'string', default: 'claude' },
    command: { type: 'string' },
    'skip-t3': { type: 'boolean', default: false },
  },
});

/** Zed's Claude Code adapter, pinned, run through npx: nothing is installed globally. */
const CLAUDE_VIA_NPX = 'npx -y @agentclientprotocol/claude-agent-acp@0.102.0';

const known = KNOWN_ACP_AGENTS.find((agent) => agent.id === args.acp);
if (!known) throw new Error(`No ACP agent "${args.acp}".`);
const commandLine = args.command ?? (args.acp === 'claude' ? CLAUDE_VIA_NPX : [known.command, ...known.args].join(' '));
const [command, ...rest] = commandLine.split(' ');
const agent: AcpAgent = { ...known, command: command!, args: rest };

const PROMPT = [
  'Three notes from a team knowledge base:',
  '1. deploy.md: "Production deploys happen on Tuesdays and Thursdays only."',
  '2. release.md: "We deploy to production every weekday after 2 pm."',
  '3. oncall.md: "The on-call engineer approves every production deploy."',
  '',
  'Which two notes contradict each other? Answer with exactly <pair>N,M</pair> and one short sentence why.',
].join('\n');

const ask = async (label: string, backend?: () => AgentBackend): Promise<void> => {
  const workspace = mkdtempSync(join(tmpdir(), 'serra-acp-live-'));
  const runs = createMeetingRuns({ t3Bin: process.env.T3_BIN ?? join(homedir(), '.t3/bin/t3'), pollMs: 500, ...(backend ? { backend, workspace } : {}), log: (line) => console.log(`  · ${line}`) });
  const started = Date.now();
  try {
    const answer = await runs.ask('Serra: ACP live check', PROMPT);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    const pair = /<pair>\s*(\d)\s*,\s*(\d)\s*<\/pair>/.exec(answer);
    const right = pair !== null && new Set([pair[1], pair[2]]).size === 2 && [pair[1], pair[2]].every((n) => n === '1' || n === '2');
    console.log(`\n${label}: ${seconds} s, ${right ? 'right (1,2)' : 'WRONG'}\n  ${answer.trim().replace(/\n/g, '\n  ')}\n`);
  } catch (error) {
    console.log(`\n${label}: failed after ${((Date.now() - started) / 1000).toFixed(1)} s: ${error instanceof Error ? error.message : String(error)}\n`);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
};

await ask(`${agent.name} over ACP (${commandLine})`, () => createAcpBackend({
  agent,
  log: (line) => console.log(`  · ${line}`),
}));
if (!args['skip-t3']) await ask('T3 (its default provider and model)');

// Nothing the ACP run started may still be running.
let left = '';
try { left = execFileSync('pgrep', ['-fl', agent.command === 'npx' ? 'claude-agent-acp' : agent.command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* pgrep exits 1 when nothing matches */ }
console.log(left ? `Still running:\n${left}` : 'No ACP agent process left running.');
