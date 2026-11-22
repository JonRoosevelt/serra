import { chromium } from '/tmp/serra-qa/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync, rmSync } from 'node:fs';
const dir = process.argv[2]; rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1080, height: 638 }, deviceScaleFactor: 2, colorScheme: 'dark',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36' });
await p.addInitScript(`window.__theme='dark';` + readFileSync(new URL('./mock.js', import.meta.url), 'utf8'));
await p.goto(new URL('./stage.html', import.meta.url).href); await p.waitForTimeout(2500);
const app = p.frames().find((f) => f.url().includes('5173'));
const N = await p.evaluate(() => window.TEXTLEN);
const C1 = ['1', 'Ask your bot in Slack'], C2 = ['2', 'It runs in T3, in its own worktree'], C3 = ['3', 'A draft PR comes back to the thread'];
const FPS = 10; let f = 0, finished = false;
const step = (t) => {
  if (t < 0.3) return { cap: C1 };
  if (t < 1.9) return { typed: Math.ceil(N * (t - 0.3) / 1.6), cap: C1 };
  if (t < 2.2) return { sent: true, cap: C1 };
  if (t < 3.0) return { sent: true, eyes: true, cap: C1 };
  if (t < 5.6) return { app: true, cap: C2 };
  return { sent: true, reply: true, cap: C3 };
};
for (let t = 0; t < 12; t = ++f / FPS) {
  await p.evaluate((s) => window.setStep(s), step(t));
  await p.screenshot({ path: `${dir}/f${String(f).padStart(4, '0')}.png` });
}
await b.close();
