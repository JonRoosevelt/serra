import { launch, shot, text, header, go, fakeDaemon, hookMain, mainQa } from './lib.mjs';
const P = '/tmp/serra-qa/profile';
const daemon = await fakeDaemon(P);
daemon.send({ status: { counts: { needsYou: 2, running: 1 } } });
const { app, page, logs } = await launch({ profile: P, userData: '/tmp/serra-qa/ud' });
await page.waitForTimeout(2000);
console.log('HEADER', await header(page));
const routes = ['/jobs/needs-you', '/jobs/running', '/jobs/done', '/jobs/new', '/knowledge/proposals', '/knowledge/pages', '/brief', '/settings/bot', '/settings/people', '/settings/repositories', '/settings/alerts', '/settings/worker', '/settings/secrets', '/settings/tools', '/settings/updates', '/settings/diagnostics'];
for (const r of routes) {
  await go(page, r); await page.waitForTimeout(r.includes('diagnostics') ? 6000 : 1200);
  const t = await text(page);
  console.log(`\n===== ${r}\n${t.slice(0, 1400)}`);
  await shot(page, 'B-' + r.replaceAll('/', '_').slice(1));
}
console.log('\nSIDEBAR', await page.evaluate(() => document.querySelector('[data-serra-sidebar]')?.innerText));
console.log('\nLOGS', logs.filter((l) => /error|warn|pageerror/i.test(l)).join('\n').slice(0, 3000));
await app.close(); await daemon.quit();
