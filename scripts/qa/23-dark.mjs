import { launch, shot, go } from './lib.mjs';
const { app, page } = await launch({ profile: '/tmp/serra-qa/profile', userData: '/tmp/serra-qa/ud' });
await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(800);
console.log('theme attr:', await page.evaluate(() => [document.documentElement.dataset.theme, document.documentElement.className, getComputedStyle(document.body).backgroundColor]));
for (const r of ['/jobs/needs-you', '/knowledge/proposals', '/settings/secrets']) { await go(page, r); await page.waitForTimeout(1200); await shot(page, 'L-dark' + r.replaceAll('/', '_')); }

await app.close();
