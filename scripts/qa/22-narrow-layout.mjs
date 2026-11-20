import { launch, go, shot } from './lib.mjs';
const { app, page } = await launch({ profile: '/tmp/serra-qa/profile', userData: '/tmp/serra-qa/ud' });
await page.waitForTimeout(800);
for (const r of ['/jobs/needs-you', '/knowledge/proposals', '/knowledge/pages']) { await go(page, r); await page.waitForTimeout(1500); await shot(page, 'M-fixed' + r.replaceAll('/', '_')); }
await app.close();
