import { launch, shot, text } from './lib.mjs';
import { execSync } from 'node:child_process';
const BOT = 'xoxb-qa-canary-7f3e91', APPT = 'xapp-qa-canary-2b8d44';
const { app, page, logs } = await launch({ userData: '/tmp/serra-qa/ud-wizard' });
await page.waitForTimeout(1200);
await page.evaluate(() => { location.hash = '/welcome'; }); await page.waitForTimeout(800);
await page.locator('[data-setup-step="tokens"]').click(); await page.waitForTimeout(500);
for (const [name, value] of [['SLACK_BOT_TOKEN', BOT], ['SLACK_APP_TOKEN', APPT]]) {
  await page.locator(`#${name}-source`).selectOption('keychain'); await page.waitForTimeout(300);
  const card = page.locator(`#${name}-source`).locator('xpath=ancestor::*[.//input[@type="password"]][1]');
  await card.locator('input[type=password]').fill(value);
  await card.getByRole('button', { name: 'Save' }).click();
  await page.waitForTimeout(2500);
}
await shot(page, 'A7-wizard-tokens-saved');
console.log('AFTER SAVE:', (await text(page)).split('Slack bot token')[1]?.slice(0, 600));
const checks = page.getByRole('button', { name: 'Check' });
for (let i = 0; i < await checks.count(); i++) { await checks.nth(i).click(); await page.waitForTimeout(4000); }
await shot(page, 'A8-wizard-tokens-checked');
console.log('AFTER CHECK:', (await text(page)).split('Slack bot token')[1]?.slice(0, 800));
// Everything the bridge returns for secrets and setup, plus the whole DOM and storage
const dump = await page.evaluate(async () => JSON.stringify({
  list: await window.serra.secrets.list(), progress: await window.serra.setup.progress(), diag: await window.serra.diagnostics.run().catch((e) => e.message),
  dom: document.documentElement.outerHTML, ls: { ...localStorage },
}));
const files = execSync('cat /tmp/serra-qa/profile/secrets.json; ls /tmp/serra-qa/profile; cat /tmp/serra-qa/ud-wizard/prefs.json').toString();
console.log('SECRETS.JSON etc:', files);
for (const v of [BOT, APPT, 'canary']) console.log('LEAK', v, dump.includes(v), logs.join('').includes(v), files.includes(v));
console.log('DIAG', JSON.parse(dump).diag);
await app.close();
