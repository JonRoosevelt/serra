import { launch, text, go, shot } from './lib.mjs';
const { app, page } = await launch({ profile: '/tmp/serra-qa/profile', userData: '/tmp/serra-qa/ud' });
await page.waitForTimeout(1000); await go(page, '/settings/updates'); await page.waitForTimeout(1200);
await page.getByRole('button', { name: 'Prepare' }).click(); await page.waitForTimeout(500);
if (await page.locator('dialog[open]').count()) await page.locator('dialog[open]').getByRole('button', { name: /Prepare/ }).click();
for (let i = 0; i < 90; i++) { await page.waitForTimeout(1000); if (/Prepared \/|failed|ENOENT/.test(await text(page))) break; }
console.log((await text(page)).match(/[^\n]*(Installing|pnpm|ENOENT|Prepared \/)[^\n]*/g));
await shot(page, 'J5-prepare-via-corepack');
await app.close();
