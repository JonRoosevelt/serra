import { chromium } from '/tmp/serra-qa/pw/node_modules/playwright-core/index.mjs';
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1280, height: 640 } });
await p.goto(new URL('./social.html', import.meta.url).href); await p.waitForTimeout(500);
await p.screenshot({ path: process.argv[2] }); await b.close();
