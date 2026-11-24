import assert from 'node:assert/strict';
import test from 'node:test';
import { inlineSpans, pageBlocks } from '../app/renderer/screens/about.logic.ts';

// The About me screen shows a page's Markdown the way a worker's brief carries it, so the parser here is tested
// against the shapes the owner's pages actually use: headings, bullets, tables, bold, code and links.

test('spans: bold, code and links come out as their kinds, with the plain text around them', () => {
  assert.deepEqual(inlineSpans('**Individual contributor:** ships features'), [
    { kind: 'bold', text: 'Individual contributor:' },
    { kind: 'text', text: ' ships features' },
  ]);
  assert.deepEqual(inlineSpans('see `owner/team.md` for people'), [
    { kind: 'text', text: 'see ' },
    { kind: 'code', text: 'owner/team.md' },
    { kind: 'text', text: ' for people' },
  ]);
  assert.deepEqual(inlineSpans('follow [request routing](https://example.com/routing) first'), [
    { kind: 'text', text: 'follow ' },
    { kind: 'link', text: 'request routing', href: 'https://example.com/routing' },
    { kind: 'text', text: ' first' },
  ]);
  assert.deepEqual(inlineSpans('plain, no markup at all'), [{ kind: 'text', text: 'plain, no markup at all' }]);
  assert.deepEqual(inlineSpans(''), []);
});

test('spans: italics need room to breathe, so snake_case and a bare asterisk stay plain', () => {
  assert.deepEqual(inlineSpans('a *quiet* word'), [
    { kind: 'text', text: 'a ' },
    { kind: 'italic', text: 'quiet' },
    { kind: 'text', text: ' word' },
  ]);
  assert.deepEqual(inlineSpans('owner_team.md'), [{ kind: 'text', text: 'owner_team.md' }]);
  assert.deepEqual(inlineSpans('3 * 4 = 12'), [{ kind: 'text', text: '3 * 4 = 12' }]);
  assert.deepEqual(inlineSpans('__whole phrase__'), [{ kind: 'bold', text: 'whole phrase' }]);
});

test('spans: bold wins over italics when both open at the same asterisk', () => {
  assert.deepEqual(inlineSpans('**the one**'), [{ kind: 'bold', text: 'the one' }]);
});

test('blocks: headings keep their level', () => {
  assert.deepEqual(pageBlocks('# The role\n\n## Day to day'), [
    { kind: 'heading', level: 1, spans: [{ kind: 'text', text: 'The role' }] },
    { kind: 'heading', level: 2, spans: [{ kind: 'text', text: 'Day to day' }] },
  ]);
});

test('blocks: bullets nest by indent, ordered bullets keep their number', () => {
  assert.deepEqual(pageBlocks('- top\n  - inner\n1. first step'), [
    { kind: 'item', depth: 0, number: null, spans: [{ kind: 'text', text: 'top' }] },
    { kind: 'item', depth: 1, number: null, spans: [{ kind: 'text', text: 'inner' }] },
    { kind: 'item', depth: 0, number: 1, spans: [{ kind: 'text', text: 'first step' }] },
  ]);
});

test('blocks: a table takes its rule as the line between head and rows, and cells carry inline markup', () => {
  assert.deepEqual(pageBlocks('| Request kind | Treat as |\n| --- | --- |\n| Ship a ticket | `workflows/request-routing.md` |\n| Scope | ask first |'), [
    {
      kind: 'table',
      head: [[{ kind: 'text', text: 'Request kind' }], [{ kind: 'text', text: 'Treat as' }]],
      rows: [
        [[{ kind: 'text', text: 'Ship a ticket' }], [{ kind: 'code', text: 'workflows/request-routing.md' }]],
        [[{ kind: 'text', text: 'Scope' }], [{ kind: 'text', text: 'ask first' }]],
      ],
    },
  ]);
});

test('blocks: a table without a rule of dashes is all rows', () => {
  assert.deepEqual(pageBlocks('| a | b |\n| c | d |'), [
    { kind: 'table', head: [], rows: [[[{ kind: 'text', text: 'a' }], [{ kind: 'text', text: 'b' }]], [[{ kind: 'text', text: 'c' }], [{ kind: 'text', text: 'd' }]]] },
  ]);
});

test('blocks: a quoted rule keeps its own kind, and consecutive quote lines join', () => {
  assert.deepEqual(pageBlocks('> Never commit tokens.\n> Never push to main.'), [
    { kind: 'quote', spans: [{ kind: 'text', text: 'Never commit tokens. Never push to main.' }] },
  ]);
});

test('blocks: consecutive plain lines join into one paragraph, blank lines split them', () => {
  assert.deepEqual(pageBlocks('Senior developer in B2C,\nsquad Engagement.\n\nDay to day:'), [
    { kind: 'text', spans: [{ kind: 'text', text: 'Senior developer in B2C, squad Engagement.' }] },
    { kind: 'text', spans: [{ kind: 'text', text: 'Day to day:' }] },
  ]);
});

test('blocks: a rule of dashes is quiet, and blank input gives no blocks', () => {
  assert.deepEqual(pageBlocks('before\n---\nafter'), [
    { kind: 'text', spans: [{ kind: 'text', text: 'before' }] },
    { kind: 'text', spans: [{ kind: 'text', text: 'after' }] },
  ]);
  assert.deepEqual(pageBlocks(''), []);
  assert.deepEqual(pageBlocks('\n\n'), []);
});

test('blocks: a page as a worker gets it parses whole, headings to tables', () => {
  const body = [
    '# The role (Engagement)',
    '',
    'Senior developer in B2C, squad Engagement. See `owner/team.md` for people and channels.',
    '',
    '## Day to day',
    '',
    '- **Individual contributor:** ships squad features, reviews PRs, and investigates bugs.',
    '- **Technical reference (with Riley):** other engineers come to either of you to get unblocked.',
    '- **Upstream with product and design:** pairs with the PM on important topics *before* user stories are ready.',
    '',
    '## For the bot',
    '',
    '| Request kind | Treat as |',
    '| --- | --- |',
    '| Ship a ticket, fix a bug, open a PR, review | Follow `workflows/request-routing.md` |',
    '| Unblock an engineer | In scope. Answer from the repo when the answer is factual. |',
  ].join('\n');
  assert.deepEqual(pageBlocks(body), [
    { kind: 'heading', level: 1, spans: [{ kind: 'text', text: 'The role (Engagement)' }] },
    { kind: 'text', spans: [
      { kind: 'text', text: 'Senior developer in B2C, squad Engagement. See ' },
      { kind: 'code', text: 'owner/team.md' },
      { kind: 'text', text: ' for people and channels.' },
    ] },
    { kind: 'heading', level: 2, spans: [{ kind: 'text', text: 'Day to day' }] },
    { kind: 'item', depth: 0, number: null, spans: [
      { kind: 'bold', text: 'Individual contributor:' },
      { kind: 'text', text: ' ships squad features, reviews PRs, and investigates bugs.' },
    ] },
    { kind: 'item', depth: 0, number: null, spans: [
      { kind: 'bold', text: 'Technical reference (with Riley):' },
      { kind: 'text', text: ' other engineers come to either of you to get unblocked.' },
    ] },
    { kind: 'item', depth: 0, number: null, spans: [
      { kind: 'bold', text: 'Upstream with product and design:' },
      { kind: 'text', text: ' pairs with the PM on important topics ' },
      { kind: 'italic', text: 'before' },
      { kind: 'text', text: ' user stories are ready.' },
    ] },
    { kind: 'heading', level: 2, spans: [{ kind: 'text', text: 'For the bot' }] },
    {
      kind: 'table',
      head: [[{ kind: 'text', text: 'Request kind' }], [{ kind: 'text', text: 'Treat as' }]],
      rows: [
        [[{ kind: 'text', text: 'Ship a ticket, fix a bug, open a PR, review' }], [{ kind: 'text', text: 'Follow ' }, { kind: 'code', text: 'workflows/request-routing.md' }]],
        [[{ kind: 'text', text: 'Unblock an engineer' }], [{ kind: 'text', text: 'In scope. Answer from the repo when the answer is factual.' }]],
      ],
    },
  ]);
});
