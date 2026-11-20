import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { createQuestionTransport, type T3Question } from '../src/t3-questions.ts';

const TOKEN = 'private-test-credential';
const OWNER_TOKEN = `${TOKEN}-owner`;
const QUESTION: T3Question = {
  id: 'scope', header: 'Scope', question: 'Which scope should I use?',
  options: [{ label: 'Minimal', description: 'Only the requested change', value: 'minimal' }, { label: 'Full', description: 'Include related cleanup' }],
  allowCustomAnswer: true, multiSelect: false,
};
type Call = { method: string; params: Record<string, unknown>; id?: number };
const fixture = ({ tool = (args: Record<string, unknown>): unknown => args.action === 'list' ? { requestIds: ['request-1'] } : { requestId: 'request-1', questions: [QUESTION] },
  response, origin = 'http://127.0.0.1:3773', execute, ticketResponse, socketResponse,
}: { tool?: (args: Record<string, unknown>) => unknown; response?: (call: Call) => Response; origin?: string; execute?: (args: string[]) => string | Promise<string>;
  ticketResponse?: () => Response; socketResponse?: (request: Record<string, unknown>) => unknown } = {}) => {
  const commands: string[][] = [];
  const requests: { method: string; url: string; headers: Headers; body: Call | null; redirect?: RequestInit['redirect']; signal?: AbortSignal | null }[] = [];
  const sockets: { url: URL; sent: Record<string, unknown>[]; closed: boolean }[] = [];
  const deps = {
    origin: async () => origin,
    execute: async (_bin: string, args: string[]): Promise<string> => {
      commands.push(args);
      return execute ? execute(args) : args[2] === 'issue' ? JSON.stringify(args.includes('mcp-client') ? { sessionId: 'auth-session', token: TOKEN } : { sessionId: 'owner-session', token: OWNER_TOKEN }) : '';
    },
    fetch: (async (url: string | URL | Request, options?: RequestInit): Promise<Response> => {
      const body = typeof options?.body === 'string' ? JSON.parse(options.body) as Call : null;
      requests.push({ method: options?.method ?? 'GET', url: String(url), headers: new Headers(options?.headers), body, redirect: options?.redirect, signal: options?.signal });
      if (String(url).endsWith('/api/auth/websocket-ticket/rpc')) return ticketResponse?.() ?? Response.json({ ticket: 'one-use-ticket' });
      if (options?.method === 'DELETE') return new Response(null, { status: 204 });
      if (body?.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }, { headers: { 'mcp-session-id': 'mcp-session' } });
      if (body?.method === 'notifications/initialized') return new Response(null, { status: 202 });
      assert.ok(body);
      if (response) return response(body);
      assert.equal(body.method, 'tools/call');
      assert.equal(body.params.name, 't3_pending_request');
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { structuredContent: tool(body.params.arguments as Record<string, unknown>) } });
    }) as typeof fetch,
    connect: (url: string): WebSocket => {
      const state = { url: new URL(url), sent: [] as Record<string, unknown>[], closed: false };
      sockets.push(state);
      const socket = new class extends EventTarget {
        send(text: string): void {
          const request = JSON.parse(text) as Record<string, unknown>;
          state.sent.push(request);
          const reply = socketResponse ? socketResponse(request) : { _tag: 'Exit', requestId: '1', exit: { _tag: 'Success', value: { sequence: 42 } } };
          queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(reply) })));
        }
        close(): void { state.closed = true; }
      }();
      queueMicrotask(() => socket.dispatchEvent(new Event('open')));
      return socket as unknown as WebSocket;
    },
  };
  return { transport: createQuestionTransport(deps), commands, requests, sockets, deps };
};

test('pending questions use a read-only, short-lived authenticated MCP session and revoke it', async () => {
  const f = fixture();
  assert.deepEqual(await f.transport.listQuestions('thread-1', '/t3'), [{ requestId: 'request-1', questions: [QUESTION] }]);
  assert.deepEqual(f.commands, [
    ['auth', 'session', 'issue', '--subject', 'mcp-client', '--scope', 'orchestration:read', '--ttl', '1m', '--label', 'Slack question bridge', '--json'],
    ['auth', 'session', 'revoke', 'auth-session'],
  ]);
  assert.deepEqual(f.requests.filter((r) => r.body?.method === 'tools/call').map((r) => r.body!.params.arguments), [
    { action: 'list', threadId: 'thread-1' }, { action: 'read', threadId: 'thread-1', requestId: 'request-1' },
  ]);
  assert.equal(f.requests[1]!.body!.method, 'notifications/initialized');
  assert.equal(f.requests.at(-1)!.method, 'DELETE');
  for (const request of f.requests) {
    assert.equal(request.headers.get('authorization'), `Bearer ${TOKEN}`);
    assert.equal(request.redirect, 'error');
    assert.ok(request.signal);
    assert.equal(request.url, 'http://127.0.0.1:3773/mcp');
  }
  for (const request of f.requests.slice(1)) assert.equal(request.headers.get('mcp-session-id'), 'mcp-session');
});

test('answering first verifies the native question, then uses owner RPC without changing worker modes', async () => {
  const questions = [QUESTION, { ...QUESTION, id: 'targets', multiSelect: true }, { ...QUESTION, id: 'custom' }];
  const f = fixture({ tool: (args) => args.action === 'list' ? { requestIds: ['request-1'] } : { requestId: 'request-1', questions } });
  const answers = { scope: 'minimal', targets: ['frontend', 'backend'], custom: { answers: ['A typed response'] } };
  await f.transport.answerQuestion('thread-1', 'request-1', answers, '/t3');
  assert.ok(!f.commands[0]!.includes('orchestration:operate'), 'native MCP credentials are read-only');
  assert.deepEqual(f.requests.filter((r) => r.body?.method === 'tools/call').map((r) => r.body!.params.arguments), [
    { action: 'list', threadId: 'thread-1' }, { action: 'read', threadId: 'thread-1', requestId: 'request-1' },
  ]);
  assert.deepEqual(f.commands[1], ['auth', 'session', 'issue', '--scope', 'orchestration:read', '--scope', 'orchestration:operate', '--ttl', '1m', '--label', 'Slack question answer', '--json']);
  const ticket = f.requests.find((r) => r.url.endsWith('/api/auth/websocket-ticket/rpc'))!;
  assert.equal(ticket.headers.get('authorization'), `Bearer ${OWNER_TOKEN}`);
  assert.equal(ticket.redirect, 'error');
  const socket = f.sockets[0]!;
  assert.equal(socket.url.origin, 'ws://127.0.0.1:3773');
  assert.equal(socket.url.pathname, '/ws');
  assert.equal(socket.url.searchParams.get('wsTicket'), 'one-use-ticket');
  assert.equal(socket.url.searchParams.get('orchestrationProtocol'), '2');
  assert.ok(!socket.url.href.includes(TOKEN), 'bearer credentials never enter the WebSocket URL');
  assert.equal(socket.closed, true);
  assert.equal(socket.sent.length, 1);
  const request = socket.sent[0]!;
  assert.deepEqual({ ...request, payload: undefined }, { _tag: 'Request', id: '1', tag: 'orchestration.dispatchCommand', headers: [], payload: undefined });
  const payload = request.payload as Record<string, unknown>;
  assert.match(String(payload.commandId), /^slack-question:/);
  assert.deepEqual({ ...payload, commandId: undefined }, { type: 'runtime-request.respond', threadId: 'thread-1', requestId: 'request-1', answers, commandId: undefined });
  assert.deepEqual(f.commands[2], ['auth', 'session', 'revoke', 'owner-session']);
  assert.deepEqual(f.commands.at(-1), ['auth', 'session', 'revoke', 'auth-session']);
});

test('SSE responses ignore notifications, handle split frames, and cancel after the matching result', async () => {
  let cancelled = false;
  const f = fixture({ response: (call) => {
    const data = JSON.stringify({ jsonrpc: '2.0', id: call.id, result: { structuredContent: { requestIds: [] } } });
    const bytes = new TextEncoder().encode(`: keepalive\r\n\r\ndata: {"jsonrpc":"2.0","method":"notifications/message"}\r\n\r\nevent: message\r\ndata: ${data}\r\n\r\n`);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 7)); controller.enqueue(bytes.slice(7, 61)); controller.enqueue(bytes.slice(61)); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  } });
  assert.deepEqual(await f.transport.listQuestions('thread-1'), []);
  assert.equal(cancelled, true, 'a persistent event stream must not hold up the bot');
});

test('external, credential-bearing, and non-root origins fail before credentials are minted', async () => {
  for (const origin of ['https://attacker.test', 'http://127.0.0.1.attacker.test', 'file:///tmp/test', 'http://user:pass@localhost', 'http://localhost/other', 'http://localhost?token=bad', 'http://localhost/#fragment']) {
    const f = fixture({ origin });
    await assert.rejects(f.transport.listQuestions('thread-1'), /local loopback server/);
    assert.equal(f.commands.length, 0);
    assert.equal(f.requests.length, 0);
  }
  for (const origin of ['http://localhost:3773', 'http://[::1]:3773', 'https://127.0.0.1:3773']) {
    const f = fixture({ origin, tool: () => ({ requestIds: [] }) });
    assert.deepEqual(await f.transport.listQuestions('thread-1'), []);
  }
});

test('HTTP failures, mismatched RPC responses, and tool errors revoke credentials without exposing response bodies', async () => {
  for (const response of [
    () => new Response(TOKEN, { status: 401 }),
    (call: Call) => Response.json({ jsonrpc: '2.0', id: call.id! + 1, result: { token: TOKEN } }),
    (call: Call) => Response.json({ jsonrpc: '2.0', id: call.id, error: { message: TOKEN } }),
    (call: Call) => Response.json({ jsonrpc: '2.0', id: call.id, result: { isError: true, content: [{ type: 'text', text: TOKEN }] } }),
    () => new Response(`not JSON: ${TOKEN}`),
  ]) {
    const f = fixture({ response });
    await assert.rejects(f.transport.listQuestions('thread-1'), (error: Error) => { assert.ok(!error.message.includes(TOKEN)); return true; });
    assert.deepEqual(f.commands.at(-1), ['auth', 'session', 'revoke', 'auth-session']);
    assert.equal(f.requests.at(-1)!.method, 'DELETE');
  }
});

test('malformed, duplicate, or explicitly secret question payloads fail closed', async () => {
  for (const questions of [[{ ...QUESTION, question: '' }], [{ ...QUESTION, options: [{ label: 'a' }] }], [QUESTION, QUESTION], [{ ...QUESTION, isSecret: true }], [{ ...QUESTION, required: 'yes' }], []]) {
    const f = fixture({ tool: (args) => args.action === 'list' ? { requestIds: ['request-1'] } : { requestId: 'request-1', questions } });
    await assert.rejects(f.transport.listQuestions('thread-1'), /invalid pending questions/);
    assert.deepEqual(f.commands.at(-1), ['auth', 'session', 'revoke', 'auth-session']);
  }
  const duplicateIds = fixture({ tool: (args) => args.action === 'list' ? { requestIds: ['request-1', 'request-1'] } : { requestId: 'request-1', questions: [QUESTION] } });
  assert.equal((await duplicateIds.transport.listQuestions('thread-1')).length, 1);
});

test('response byte limits and underlying stream errors never expose credentials', async () => {
  const huge = fixture({ response: () => new Response('a'.repeat(256 * 1024 + 1)) });
  await assert.rejects(huge.transport.listQuestions('thread-1'), /size limit/);
  const broken = fixture({ response: () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(`T3 returned ${TOKEN}`)); } })) });
  await assert.rejects(broken.transport.listQuestions('thread-1'), (error: Error) => { assert.equal(error.message, 'Could not read the T3 question response'); return true; });
  const authFailure = fixture({ execute: () => { throw new Error(TOKEN); } });
  await assert.rejects(authFailure.transport.listQuestions('thread-1'), /Could not authenticate/);
  const incompleteAuth = fixture({ execute: (args) => args[2] === 'issue' ? JSON.stringify({ sessionId: 'auth-session' }) : '' });
  await assert.rejects(incompleteAuth.transport.listQuestions('thread-1'), /invalid question credentials/);
  assert.deepEqual(incompleteAuth.commands.at(-1), ['auth', 'session', 'revoke', 'auth-session']);
  assert.equal(incompleteAuth.requests.length, 0);
});

test('invalid answer shapes and unsuccessful answer confirmation never count as submitted', async () => {
  const f = fixture();
  await assert.rejects(f.transport.answerQuestion('thread-1', 'request-1', { scope: 42 }), /text or text selections/);
  assert.equal(f.requests.filter((r) => r.body?.method === 'tools/call').length, 0);
  const noConfirmation = fixture({ socketResponse: () => ({ _tag: 'Exit', requestId: '1', exit: { _tag: 'Success', value: { ok: true } } }) });
  await assert.rejects(noConfirmation.transport.answerQuestion('thread-1', 'request-1', { scope: 'minimal' }), /did not confirm/);
});

test('approvals, secrets, stale requests and invalid answer values never reach owner RPC', async () => {
  const excluded = fixture({ tool: () => ({ requestIds: [] }) });
  await assert.rejects(excluded.transport.answerQuestion('thread-1', 'approval-or-secret', { scope: 'accept' }), /no longer pending/);
  assert.equal(excluded.commands.filter((args) => args[2] === 'issue').length, 1);
  assert.equal(excluded.sockets.length, 0);
  for (const answers of [{ unknown: 'minimal' }, {}, { scope: '' }, { scope: [] }, { scope: ['minimal', 'Full'] }, { scope: 'invalid' }]) {
    const f = fixture({ tool: (args) => args.action === 'list' ? { requestIds: ['request-1'] } : { requestId: 'request-1', questions: [{ ...QUESTION, allowCustomAnswer: false }] } });
    await assert.rejects(f.transport.answerQuestion('thread-1', 'request-1', answers));
    assert.equal(f.commands.filter((args) => args[2] === 'issue').length, 1);
    assert.equal(f.sockets.length, 0);
  }
  const secret = fixture({ tool: (args) => args.action === 'list' ? { requestIds: ['request-1'] } : { requestId: 'request-1', questions: [{ ...QUESTION, isSecret: true }] } });
  await assert.rejects(secret.transport.answerQuestion('thread-1', 'request-1', { scope: 'minimal' }), /invalid pending questions/);
  assert.equal(secret.sockets.length, 0);
});

test('ticket and RPC failures close sockets and revoke both sessions without exposing credentials or answers', async () => {
  for (const settings of [
    { ticketResponse: () => new Response(TOKEN, { status: 401 }) },
    { ticketResponse: () => Response.json({ secret: TOKEN }) },
    { socketResponse: () => ({ _tag: 'Exit', requestId: '2', exit: { _tag: 'Success', value: { sequence: 42 } } }) },
    { socketResponse: () => ({ _tag: 'Exit', requestId: '1', exit: { _tag: 'Failure', cause: { secret: TOKEN } } }) },
    { socketResponse: () => ({ _tag: 'Defect', defect: TOKEN }) },
  ]) {
    const f = fixture(settings);
    await assert.rejects(f.transport.answerQuestion('thread-1', 'request-1', { scope: 'minimal' }), (error: Error) => { assert.ok(!error.message.includes(TOKEN)); return true; });
    assert.deepEqual(f.commands.slice(-2), [['auth', 'session', 'revoke', 'owner-session'], ['auth', 'session', 'revoke', 'auth-session']]);
    for (const socket of f.sockets) assert.equal(socket.closed, true);
  }
});

test('real process transport captures issued credentials privately and revokes the CLI session', async (t: TestContext) => {
  const root = mkdtempSync(join(tmpdir(), 'bots-t3-question-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 't3');
  const capture = join(root, 'calls.jsonl');
  writeFileSync(bin, `#!${process.execPath}\nconst fs=require('fs'); const args=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify(args)+'\\n'); if(args[2]==='issue')console.log(JSON.stringify({sessionId:'auth-session',token:${JSON.stringify(TOKEN)}}));\n`, { mode: 0o700 });
  const f = fixture({ tool: () => ({ requestIds: [] }) });
  const { execute: _execute, ...deps } = f.deps;
  const transport = createQuestionTransport(deps);
  assert.deepEqual(await transport.listQuestions('thread-1', bin), []);
  const calls = readFileSync(capture, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], ['auth', 'session', 'revoke', 'auth-session']);
  assert.ok(!readFileSync(capture, 'utf8').includes(TOKEN));
});
