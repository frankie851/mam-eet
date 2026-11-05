// Volitelný průchod záložkou „Paušál, nebo přiznání?“ v prohlížeči (Playwright).
// Použití: BASE_URL=http://127.0.0.1:8000/ node tools/e2e-osvc.mjs <adresář pro screenshoty>
import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8000/';
const OUT = process.argv[2] ?? '.';
const nbsp = (s) => s.replace(/[  ]/g, ' ');

const browser = await chromium.launch();
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

// Klik na záložku dřív, než se načte rules.json (pomalá síť), se nesmí ztratit.
{
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 } });
  await ctx.route('**/rules.json', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  const before = await page.locator('#osvc-income').count();
  await page.getByRole('tab', { name: 'Paušál, nebo přiznání?' }).click();
  await page.locator('#panel-osvc:not([hidden]) #osvc-income').waitFor({ timeout: 10000 });
  check(before === 0, 'pomalá síť: klik proběhl ještě před inicializací');
  check(page.url().endsWith('#osvc'), 'pomalá síť: klik před načtením nastaví #osvc a otevře záložku');
  await ctx.close();
}

for (const scheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, colorScheme: scheme });
  const external = [];
  ctx.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) external.push(r.url()); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const noHScroll = async (tag) => {
    const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    check(sw <= cw, `${scheme} ${tag}: bez vodorovného posuvníku (${sw} <= ${cw})`);
  };

  await page.goto(BASE);
  await page.getByRole('tab', { name: 'Paušál, nebo přiznání?' }).click();
  check(page.url().endsWith('#osvc'), `${scheme}: záložka nastaví #osvc`);
  await page.locator('#panel-osvc:not([hidden])').waitFor();
  await noHScroll('prázdný formulář');

  // Případ 1: 800 000 Kč, 60 %, kontaktní platby → nejlevnější paušál, EET OFF 132 744.
  await page.locator('#osvc-income').fill('800000');
  await page.getByRole('button', { name: 'Spočítat' }).click();
  await page.locator('.variants').waitFor();
  let txt = nbsp(await page.locator('.variants').innerText());
  check(txt.includes('115 944') && txt.includes('132 744'), `${scheme}: tabulka 115 944 / 132 744`);
  check(nbsp(await page.locator('tr.cheapest').innerText()).includes('Paušální daň'), `${scheme}: nejlevnější je paušál`);
  check(await page.locator('svg.chart path.line').count() === 3, `${scheme}: graf má 3 čáry`);
  check(nbsp(await page.locator('.breakeven').innerText()).includes('Od příjmů'), `${scheme}: bod zlomu`);
  await page.locator('svg.chart').scrollIntoViewIfNeeded();
  const box = await page.locator('svg.chart .overlay').boundingBox();
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height / 2);
  check(await page.locator('.chart-tooltip:not([hidden])').count() === 1, `${scheme}: tooltip při najetí`);
  await noHScroll('výsledek 800 000');
  await page.screenshot({ path: `${OUT}/osvc-${scheme}-360.png`, fullPage: true });

  // Případ 2: plátce DPH → paušál i EET OFF nedostupné.
  await page.locator('label.option', { hasText: 'Ano' }).first().click();
  txt = nbsp(await page.locator('.variants').innerText());
  check(txt.includes('Plátce DPH nemůže mít paušální daň'), `${scheme}: plátce DPH → důvod`);
  await page.locator('label.option', { hasText: 'Ne' }).first().click();

  // Případ 3: 1 200 000 Kč, 40 % → 2. pásmo, EET OFF nedostupný.
  await page.locator('#osvc-income').fill('1200000');
  await page.locator('label.option', { hasText: '40 %' }).click();
  txt = nbsp(await page.locator('.variants').innerText());
  check(txt.includes('2. pásmo') && txt.includes('EET OFF je jen pro 1. pásmo'), `${scheme}: 1,2 mil. a 40 % → 2. pásmo, bez EET OFF`);

  // Případ 4: skutečné výdaje 300 000 z 500 000, 2 děti → přiznání 67 687.
  await page.locator('#osvc-income').fill('500000');
  await page.locator('label.option', { hasText: 'Skutečnými výdaji' }).click();
  await page.locator('#osvc-actual').fill('300000');
  await page.locator('#osvc-children').fill('2');
  txt = nbsp(await page.locator('.variants').innerText());
  check(txt.includes('67 687'), `${scheme}: zisk 200 000 a 2 děti → 67 687`);
  await noHScroll('výsledek s dětmi');

  // Záložka zpět na EET funguje.
  await page.getByRole('tab', { name: 'Mám EET?' }).click();
  const back = await page.locator('#panel-eet:not([hidden]) #intro:not([hidden])').waitFor({ timeout: 5000 }).then(() => true, () => false);
  check(back, `${scheme}: návrat na Mám EET?`);

  check(external.length === 0, `${scheme}: žádné externí požadavky ${external.join(', ')}`);
  check(errors.length === 0, `${scheme}: žádné JS chyby ${errors.join(' | ')}`);
  await ctx.close();
}
await browser.close();
if (failed) { console.log(`${failed} kontrol selhalo`); process.exit(1); }
