import { createRequire } from 'node:module'; const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8000/';
const OUT = process.argv[2] ?? '.';
const scenarios = [
  { name: '1-osvc-hotovost', steps: ['OSVČ', ['Hotovost'], 'Nic z toho', 'Ne, paušální daň', 'Ne', 1], expect: 'Ano, musíš evidovat' },
  { name: '2-faktury', steps: ['OSVČ', ['Faktura']], expect: 'Ne, evidovat tržby' },
  { name: '3-eshop', steps: ['Právnická osoba', ['Online platba']], expect: 'Ne, evidovat tržby' },
  { name: '4-kavarna-qr', steps: ['Právnická osoba', ['QR kód nebo bankovní převod']], expect: 'Ano, musíš evidovat', extra: ['Nic z toho', 1] },
  { name: '5-pausal1-800k', steps: ['OSVČ', ['Hotovost'], 'Nic z toho', '1. pásmo', 800000, 'Ne', 1], expect: 'Můžeš zvolit EET OFF', calc: '16 800' },
  { name: '6-pausal2', steps: ['OSVČ', ['Hotovost'], 'Nic z toho', '2. pásmo', 'Ne', 1], expect: 'Ano, musíš evidovat', off: 'Ve 2. ani 3. pásmu' },
  { name: '7-pausal1-1200k', steps: ['OSVČ', ['Hotovost'], 'Nic z toho', '1. pásmo', 1200000, 'Ne', 1], expect: 'Ano, musíš evidovat', off: '1 200 000' },
];
scenarios[3].steps.push(...scenarios[3].extra);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 1 });
const external = [];
ctx.on('request', (r) => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) external.push(r.url()); });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function noHScroll(tag) {
  const w = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  if (w[0] > w[1]) throw new Error(`${tag}: horizontal scroll ${w[0]} > ${w[1]}`);
}

let failed = 0;
for (const s of scenarios) {
  try {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Začít' }).click();
    let qn = 0;
    for (const st of s.steps) {
      qn++;
      await noHScroll(`${s.name} q${qn}`);
      if (Array.isArray(st)) {
        for (const t of st) await page.locator('label.option', { hasText: t }).first().click();
      } else if (typeof st === 'number') {
        await page.locator('#quiz input[type=text]').fill(String(st));
      } else {
        await page.locator('label.option', { hasText: st }).first().click();
      }
      await page.getByRole('button', { name: 'Další' }).click();
    }
    await page.locator('#result:not([hidden])').waitFor();
    const headline = await page.locator('.verdict h1').innerText();
    if (!headline.includes(s.expect)) throw new Error(`headline "${headline}" != ${s.expect}`);
    const links = await page.locator('#result a.source').evaluateAll((as) => as.map((a) => a.href));
    if (!links.some((u) => /^https:\/\/(eet|mf)\.gov\.cz\//.test(u))) throw new Error('no official link');
    let extra = '';
    if (s.calc) {
      const out = await page.locator('.calc-output').innerText();
      if (!out.replace(/ /g, ' ').includes(s.calc)) throw new Error(`calc "${out}"`);
      extra += ` | kalkulačka: ${out}`;
      await page.locator('label.option', { hasText: 'vlastní pokladně' }).click();
      await page.locator('#own-cost').fill('20000');
      extra += ` | s pokladnou 20 000: ${await page.locator('.calc-output').innerText()}`;
    }
    if (s.off) {
      const offText = (await page.locator('.card').first().innerText()).replace(/ /g, ' ');
      if (!offText.includes(s.off)) throw new Error(`EET OFF text: ${offText}`);
      extra += ` | EET OFF: ${offText.split('\n').filter(Boolean)[1]}`;
    }
    await noHScroll(`${s.name} result`);
    const items = await page.locator('.todo li').count();
    if (items === 0) throw new Error('prázdný kontrolní seznam');
    const body = await page.locator('main').innerText();
    if (/\[object|\bnull\b|undefined|\{\w+\}/.test(body)) throw new Error('nevyplněný text v UI');
    await page.screenshot({ path: `${OUT}/${s.name}.png`, fullPage: true });
    console.log(`OK   ${s.name}: "${headline}" | ${links.length} odkazů na zdroj | ${items} úkolů${extra}`.replace(/ /g, ' '));
  } catch (e) {
    failed++;
    console.log(`FAIL ${s.name}: ${e.message}`);
    await page.screenshot({ path: `${OUT}/${s.name}-FAIL.png`, fullPage: true });
  }
}

// Tlačítko Zpět: v dotazníku se vrátí a zachová odpověď
await page.goto(BASE);
await page.getByRole('button', { name: 'Začít' }).click();
await page.locator('label.option', { hasText: 'OSVČ' }).click();
await page.getByRole('button', { name: 'Další' }).click();
await page.getByRole('button', { name: 'Zpět' }).click();
const kept = await page.locator('label.option', { hasText: 'OSVČ' }).locator('input').isChecked();
console.log(kept ? 'OK   tlačítko Zpět zachová odpověď' : 'FAIL tlačítko Zpět');
if (!kept) failed++;

// Tisk
await page.goto(BASE);
await page.getByRole('button', { name: 'Začít' }).click();
for (const st of scenarios[4].steps) {
  if (Array.isArray(st)) await page.locator('label.option', { hasText: st[0] }).click();
  else if (typeof st === 'number') await page.locator('#quiz input[type=text]').fill(String(st));
  else await page.locator('label.option', { hasText: st }).first().click();
  await page.getByRole('button', { name: 'Další' }).click();
}
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: `${OUT}/tisk-eet-off.pdf`, format: 'A4' });
const printVisible = await page.evaluate(() => ({
  calc: getComputedStyle(document.getElementById('calc')).display,
  checklist: getComputedStyle(document.getElementById('checklist')).display,
}));
console.log(`OK   tisk: kalkulačka display=${printVisible.calc}, seznam display=${printVisible.checklist}`);

console.log(`Externí požadavky: ${external.length ? external.join(', ') : 'žádné'}`);
console.log(`JS chyby: ${errors.length ? errors.join(' | ') : 'žádné'}`);
await browser.close();
process.exit(failed ? 1 : 0);
