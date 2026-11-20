import { launch, shot, text, header, go, fakeDaemon } from './lib.mjs';
const P = '/tmp/serra-qa/profile';
const { app, page, logs } = await launch({ profile: P, userData: '/tmp/serra-qa/ud' });
await page.waitForTimeout(1000);
await go(page, '/jobs/needs-you');
const t0 = Date.now();
for (let i = 0; i < 40; i++) { if (!(await text(page)).includes('Loading jobs')) break; await page.waitForTimeout(500); }
console.log('loaded after', Date.now() - t0, 'ms');
console.log(await text(page));
const t1 = Date.now(); const r = await page.evaluate(async () => JSON.stringify(await window.serra.jobs.list()).slice(0, 3000)); console.log('list took', Date.now() - t1, r);
await shot(page, 'C1-jobs-needs-you');
await app.close();
