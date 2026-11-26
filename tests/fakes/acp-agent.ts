// A scriptable ACP agent on stdio, for the ACP backend's tests: the real protocol through the official SDK, with the
// test playing the model. Each prompt turn (numbered across processes) waits for the test to write `turn-<n>` in FAKE_ACP_DIR, then streams that
// file's text as the reply. A prompt with `ASK:<kind>` first asks permission for a tool of that kind, and writes the
// answer to `permission-<n>`. A prompt with `TOOL:<id>` records a tool call that read meeting <id>. A cancel ends the
// running turn with `cancelled`. `FAIL:<kind>` fails the turn with that error kind. Run: node tests/fakes/acp-agent.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import * as acp from '@agentclientprotocol/sdk';

const dir = process.env.FAKE_ACP_DIR ?? '';
/** Counted in the folder, so turns and sessions are numbered across every agent process a test starts. */
const next = (name: string): number => {
  const file = join(dir, `count-${name}`);
  const value = (existsSync(file) ? Number(readFileSync(file, 'utf8')) : 0) + 1;
  writeFileSync(file, String(value));
  return value;
};
const cancelled = new Set<string>();

const waitFor = async (file: string, sessionId: string): Promise<string | null> => {
  for (;;) {
    if (cancelled.has(sessionId)) return null;
    if (existsSync(file)) return readFileSync(file, 'utf8');
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
};

const app = acp.agent({ name: 'fake-acp' })
  .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION, agentCapabilities: {} }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    const session = next('session');
    writeFileSync(join(dir, `session-${session}`), params.cwd);
    // FAKE_ACP_MODES: the agent's modes as JSON, like Claude Code's (starting in `auto`); a default and a read-only mode otherwise.
    const modes = process.env.FAKE_ACP_MODES ? JSON.parse(process.env.FAKE_ACP_MODES) as acp.SessionModeState : { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'read-only', name: 'Read only' }] };
    return { sessionId: `session-${session}`, modes };
  })
  .onRequest(acp.methods.agent.session.setMode, ({ params }) => {
    writeFileSync(join(dir, `mode-${params.sessionId}`), params.modeId);
    return {};
  })
  .onNotification(acp.methods.agent.session.cancel, ({ params }) => { cancelled.add(params.sessionId); })
  .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
    const turn = next('turn');
    cancelled.delete(params.sessionId);
    const text = params.prompt.map((block) => (block.type === 'text' ? block.text : '')).join('');
    // FAIL:<kind> fails the turn the way Claude Code's adapter does, with its error kind and raw text that quotes the brief.
    const fail = /FAIL:(\w+)/.exec(text)?.[1];
    if (fail) throw acp.RequestError.internalError({ errorKind: fail }, `SECRET-TRANSCRIPT ${text.slice(0, 40)}`);
    const ask = /ASK:(\w+)/.exec(text)?.[1];
    if (ask) {
      const answer = await client.request(acp.methods.client.session.requestPermission, {
        sessionId: params.sessionId,
        toolCall: { toolCallId: `ask-${turn}`, title: `a ${ask} tool`, kind: ask as acp.ToolKind },
        options: [{ optionId: 'yes', name: 'Allow', kind: 'allow_once' }, { optionId: 'no', name: 'Reject', kind: 'reject_once' }],
      });
      writeFileSync(join(dir, `permission-${turn}`), answer.outcome.outcome === 'selected' ? answer.outcome.optionId : 'cancelled');
    }
    const tool = /TOOL:([\w-]+)/.exec(text)?.[1] ?? /meeting with ID "([\w-]+)"/.exec(text)?.[1];
    if (tool) {
      await client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: 'tool_call', toolCallId: `tool-${turn}`, title: 'get_meeting_transcript', kind: 'other', status: 'in_progress', rawInput: { meeting_id: tool } } });
      await client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: 'tool_call_update', toolCallId: `tool-${turn}`, status: 'completed', content: [{ type: 'content', content: { type: 'text', text: 'Ana: Hi\nBo: Hello' } }] } });
    }
    const reply = await waitFor(join(dir, `turn-${turn}`), params.sessionId);
    if (reply === null) return { stopReason: 'cancelled' as const };
    for (const part of [reply.slice(0, 2), reply.slice(2)]) {
      if (part) await client.notify(acp.methods.client.session.update, { sessionId: params.sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: part } } });
    }
    return { stopReason: 'end_turn' as const };
  });

app.connect(acp.ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>));
