// Seeds the QA profile with jobs, events, knowledge pages, proposals and a proposed brief. Placeholder IDs only.
import { mkdirSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const P = process.argv[2] ?? '/tmp/serra-qa/profile';
const K = join(P, 'knowledge');
const now = Date.now(), iso = (msAgo) => new Date(now - msAgo).toISOString();
const job = (o) => ({ t3ThreadId: 'qa-thread-x', channel: 'C0123456789', threadTs: '1700000000.000100', requester: 'U0123456780', pendingReactionTs: null,
  lastPostedRunId: null, watching: true, createdAt: iso(3600e3), lastActivityAt: iso(600e3), ...o });
const state = {
  'C0123456789:1700000000.000100': job({ t3ThreadId: 'qa-needs-1', ownerAskOpen: true, ownerFollows: true, threadTs: '1700000000.000100' }),
  'C0123456789:1700000000.000200': job({ t3ThreadId: 'qa-waiting-t3', waitingInT3: true, threadTs: '1700000000.000200', createdAt: iso(7200e3) }),
  'C0999999999:1700000000.000300': job({ t3ThreadId: 'qa-running-1', channel: 'C0999999999', loadingRequested: true, threadTs: '1700000000.000300', createdAt: iso(900e3), lastActivityAt: iso(60e3) }),
  'C0123456789:1700000000.000400': job({ t3ThreadId: 'qa-done-1', watching: false, threadTs: '1700000000.000400', createdAt: iso(5 * 3600e3), lastActivityAt: iso(1800e3), reviewRequestedPrs: ['https://github.com/acme/project/pull/42'] }),
  'C0123456789:1700000000.000500': job({ t3ThreadId: 'qa-done-old', watching: false, threadTs: '1700000000.000500', createdAt: iso(9 * 86400e3), lastActivityAt: iso(8 * 86400e3) }),
};
writeFileSync(join(P, 'state.json'), JSON.stringify(state, null, 2));
mkdirSync(join(P, 'logs'), { recursive: true });
writeFileSync(join(P, 'logs/events.jsonl'), [
  { at: iso(3500e3), event: 'job_started', key: 'C0123456789:1700000000.000100', t3ThreadId: 'qa-needs-1', requester: 'U0123456780' },
  { at: iso(700e3), event: 'needs_owner', key: 'C0123456789:1700000000.000100', question: 'Should the migration run before or after the deploy?' },
  { at: iso(1800e3), event: 'failure', key: 'C0123456789:1700000000.000400', error: 'fixture failure for QA' },
].map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n');
writeFileSync(join(P, 'logs/bot.log'), Array.from({ length: 30 }, (_, i) => `${iso((30 - i) * 1000)} line ${i + 1} token xoxb-should-be-hidden-${i}`).join('\n') + '\n');
const page = (f, text) => ['---', `type: ${f.type ?? 'preference'}`, `description: ${f.description}`, `written: ${f.written ?? '2026-11-10'}`, `verified: ${f.verified ?? 'no'}`,
  ...(f.target ? [`target: ${f.target}`] : []), 'sources:', '  - Owner interview, 2026-11-10', '---', '', text, ''].join('\n');
const w = (p, t) => { mkdirSync(dirname(join(K, p)), { recursive: true }); writeFileSync(join(K, p), t); };
w('owner/role.md', page({ description: "The owner's role", verified: '2026-11-15' }, 'Owns the API and the deploy pipeline.'));
w('ops/deploys.md', page({ description: 'How deploys work', verified: '2025-01-10', written: '2025-01-10' }, 'Deploys go out on Tuesdays.'));
w('ops/draft.md', page({ description: 'A draft page' }, 'Draft text.'));
const index = readFileSync(join(K, 'index.md'), 'utf8').replace(/\n*$/, '\n') +
  "| who owns what | `owner/role.md` | The owner's role |\n| deploys | `ops/deploys.md` | How deploys work |\n| drafts | `ops/draft.md` | A draft |\n";
writeFileSync(join(K, 'index.md'), index);
w('proposals/2026-11-18-reviews.md', page({ description: 'Review style', target: 'owner/role.md' }, 'Owns the API and the deploy pipeline.\nAlso reviews every PR within a day.'));
w('proposals/2026-11-19-oncall.md', page({ description: 'On-call rota' }, 'On-call rotates weekly on Mondays.'));
w('proposals/2026-11-19-discard-me.md', page({ description: 'Proposal to discard' }, 'Throwaway.'));
mkdirSync(join(P, 'proposed/qa-proposal'), { recursive: true });
writeFileSync(join(P, 'proposed/qa-proposal/policy.md'), '# Owner policy\n\nPrefer small PRs. (proposed in QA)\n');
console.log('seeded', P);
