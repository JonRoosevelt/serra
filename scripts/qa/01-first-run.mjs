import { launch, shot, text } from './lib.mjs';
const { app, page, logs } = await launch({ userData: '/tmp/serra-qa/ud-wizard' });
await page.waitForTimeout(1500);
console.log('URL', page.url().replace(/.*#/, '#'));
console.log((await text(page)).slice(0, 1500));
await shot(page, 'A1-first-run');
await app.close();
console.log(logs.join('').slice(-1500));
