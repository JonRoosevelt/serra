import { chromium } from '/tmp/serra-qa/pw/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
const out = process.argv[2];
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1080, height: 586 }, deviceScaleFactor: 2, colorScheme: 'dark',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36' });
await p.addInitScript(`window.__theme='dark';` + readFileSync(new URL('./mock.js', import.meta.url), 'utf8'));
await p.goto(new URL('./stage.html', import.meta.url).href); await p.waitForTimeout(2500);
await p.evaluate(() => document.body.classList.add('still'));
const app = p.frames().find((f) => f.url().includes('5173'));
await app.evaluate(() => { window.__finish(); location.hash = '/jobs/done'; }); await p.waitForTimeout(800);
await p.evaluate(() => window.setStep({ sent: true, reply: true, cap: ['', ''] }));

await p.evaluate(() => window.setStep({ app: true, cap: ['', ''] })); await p.waitForTimeout(300);
await p.screenshot({ path: `${out}/jobs.png` });
await p.goto(new URL('./stage2.html', import.meta.url).href); await p.waitForTimeout(1500);
await p.evaluate(() => { document.body.classList.add('still'); });
await p.screenshot({ path: `${out}/slack-thread.png` });
await b.close();
