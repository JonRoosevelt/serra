import { chromium } from '/tmp/serra-qa/pw/node_modules/playwright-core/index.mjs';
const [,, src, out, w] = process.argv;
const b = await chromium.launch({ executablePath: process.env.CHROME });
const p = await b.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await p.goto(new URL('./frame.html', import.meta.url).href);
await p.evaluate(([s, w]) => new Promise((r) => { const i = document.getElementById('i'); i.onload = r; i.style.width = w + 'px'; i.src = s; }), ['file://' + src, Number(w)]);
await (await p.$('body')).screenshot({ path: out, omitBackground: true });
await b.close();
