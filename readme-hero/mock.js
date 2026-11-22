// Demo bridge for screenshots. Placeholder data only.
(() => {
  const now = Date.now(), iso = (m) => new Date(now - m * 60e3).toISOString();
  const listeners = { event: [], status: [], jobs: [] };
  const base = (o) => ({ requester: 'U01', channel: 'C01', createdAt: iso(30), lastActivityAt: iso(1), links: {}, ...o });
  const jobs = [
    base({ key: 'a', group: 'running', requesterName: 'Maya', channelName: '#payments', title: 'Stop retrying gone webhooks', createdAt: iso(4), lastActivityAt: iso(0.2),
      links: { slack: 'https://example.com', t3: 'https://example.com' } }),
    base({ key: 'e', group: 'running', requesterName: 'Leo', channelName: '#api', title: 'Why do exports time out for big accounts?', createdAt: iso(9), lastActivityAt: iso(2),
      links: { slack: 'https://example.com', t3: 'https://example.com' } }),
    base({ key: 'c', group: 'done', requesterName: 'Priya', channelName: '#web', title: 'Add an empty state to the invoices table', lastActivityAt: iso(35),
      links: { slack: 'https://example.com', t3: 'https://example.com', pr: 'https://example.com' } }),
    base({ key: 'd', group: 'done', requesterName: 'Sam', channelName: 'DM', title: 'What does the billing cron do on month end?', lastActivityAt: iso(95),
      links: { slack: 'https://example.com', t3: 'https://example.com' } }),
  ];
  window.__finish = () => { const j = jobs[0]; j.group = 'done'; j.links = { ...j.links, pr: 'https://example.com' }; status.counts.running = 1; window.__demo.emit('status', { ...status }); window.__demo.emit('event', { at: iso(0), event: 'reply', key: 'a', kind: 'reply' }); };
  window.__demo = { jobs, emit(name, p) { for (const l of listeners[name] || []) l(p); }, iso };
  const status = { state: 'up', pid: 4242, startedAt: iso(300), slackConnected: true, counts: { needsYou: 0, running: 2 } };
  const prefs = { theme: window.__theme || 'light', lastScreen: '/jobs/running', profile: null, prerelease: null,
    window: { width: 1100, height: 720, maximized: false },
    starPrompt: { since: null, finished: 0, asks: 9, shownIn: null, snoozedUntil: null, done: true } };
  const special = {
    app: { info: async () => ({ version: '0.1.0-alpha.3', electron: '45', node: '24', chrome: '140' }), getPrefs: async () => prefs, setPrefs: async (p) => Object.assign(prefs, p) },
    setup: { progress: async () => ({ next: null, done: true }) },
    bot: { status: async () => status },
    jobs: { list: async () => jobs.map((j) => ({ ...j })) },
    proposals: { list: async () => [] }, pages: { untagged: async () => [], drift: async () => [] },
  };
  const on = new Proxy({}, { get: (_, k) => (l) => { (listeners[k] ||= []).push(l); return () => {}; } });
  window.serra = new Proxy({}, { get: (_, ns) => ns === 'on' ? on : new Proxy({}, { get: (_, m) => special[ns]?.[m] ?? (async () => []) }) });
  window.__setStatus = (s) => { Object.assign(status, s); window.__demo.emit('status', { ...status }); };
})();
