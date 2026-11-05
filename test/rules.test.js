import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluate,
  visibleQuestions,
  eetOffAnnualSurcharge,
  compareCosts,
  buildChecklist,
} from '../rules.js';

const rules = JSON.parse(readFileSync(new URL('../rules.json', import.meta.url), 'utf8'));

// Hodnoty pro asserty bereme z rules.json, aby test hlídal logiku, ne opsané částky.
const off = rules.eetOff;
const OFFICIAL_HOSTS = [
  'eet.gov.cz', 'mf.gov.cz', 'financnisprava.gov.cz', 'adisspr.mfcr.cz',
  'e-sbirka.gov.cz', 'cssz.gov.cz', 'vzp.cz', 'mpsv.gov.cz',
];

function isOfficial(url) {
  return OFFICIAL_HOSTS.includes(new URL(url).hostname);
}

function assertHasOfficialSource(result) {
  assert.ok(result.reasons.length > 0, 'výsledek musí mít aspoň jeden důvod');
  for (const r of result.reasons) {
    assert.ok(r.text, 'důvod musí mít text');
    assert.ok(r.source && isOfficial(r.source.url), `důvod "${r.text}" musí mít oficiální zdroj`);
  }
}

describe('povinné scénáře ze zadání', () => {
  test('OSVČ, hotovost na provozovně, bez paušální daně → musí evidovat', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'none', blind: false, units: 1 },
      rules,
    );
    assert.equal(r.verdict, 'must');
    assert.equal(r.eetOff.eligible, false);
    assertHasOfficialSource(r);
  });

  test('jen faktury placené převodem → nemusí evidovat', () => {
    const r = evaluate({ form: 'osvc', payments: ['invoiceTransfer'] }, rules);
    assert.equal(r.verdict, 'not');
    assertHasOfficialSource(r);
  });

  test('e-shop, jen online platby přes platební bránu → nemusí evidovat', () => {
    const r = evaluate({ form: 'po', payments: ['online'] }, rules);
    assert.equal(r.verdict, 'not');
    assertHasOfficialSource(r);
  });

  test('kavárna, jen QR platby u pultu → musí evidovat', () => {
    const r = evaluate({ form: 'po', payments: ['qrOnSite'], sector: 'none', units: 1 }, rules);
    assert.equal(r.verdict, 'must');
    assertHasOfficialSource(r);
  });

  test('paušální daň 1. pásmo, příjmy 800 000 Kč → může zvolit EET OFF, přirážka 16 800 Kč/rok', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band1', income: 800000, blind: false, units: 1 },
      rules,
    );
    assert.equal(r.verdict, 'off');
    assert.equal(r.eetOff.eligible, true);
    assert.equal(r.eetOff.surchargeAnnual, 16800);
    assert.equal(eetOffAnnualSurcharge(rules), 16800);
    assertHasOfficialSource(r);
  });

  test('paušální daň 2. pásmo → EET OFF nelze', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band2', blind: false, units: 1 },
      rules,
    );
    assert.equal(r.verdict, 'must');
    assert.equal(r.eetOff.eligible, false);
    assert.equal(r.eetOff.code, 'wrongBand');
    assertHasOfficialSource(r);
  });

  test('paušální daň 1. pásmo, příjmy 1 200 000 Kč → EET OFF nelze', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band1', income: 1200000, blind: false, units: 1 },
      rules,
    );
    assert.equal(r.verdict, 'must');
    assert.equal(r.eetOff.eligible, false);
    assert.equal(r.eetOff.code, 'overLimit');
    assertHasOfficialSource(r);
  });
});

describe('další pravidla z oficiálních zdrojů', () => {
  test('nepodnikám → nemusí evidovat', () => {
    const r = evaluate({ form: 'none' }, rules);
    assert.equal(r.verdict, 'not');
    assertHasOfficialSource(r);
  });

  test('převod u pultu (osobní kontakt) se eviduje', () => {
    const r = evaluate({ form: 'osvc', payments: ['qrOnSite'], sector: 'none', flatTax: 'none', blind: false }, rules);
    assert.equal(r.verdict, 'must');
  });

  test('dobírka přes poštu + online platby → nemusí evidovat', () => {
    const r = evaluate({ form: 'po', payments: ['cod', 'online'] }, rules);
    assert.equal(r.verdict, 'not');
    assert.equal(r.reasons.length, 2);
  });

  test('kombinace faktury a hotovosti → musí evidovat (hotovost rozhoduje)', () => {
    const r = evaluate({ form: 'po', payments: ['invoiceTransfer', 'cash'], sector: 'none' }, rules);
    assert.equal(r.verdict, 'must');
    assert.ok(r.reasons.some((x) => x.text.includes('Hotovost')));
  });

  test('stravenky, krypto a šeky se evidují', () => {
    for (const p of ['vouchers', 'virtual', 'cheque', 'card']) {
      const r = evaluate({ form: 'po', payments: [p], sector: 'none' }, rules);
      assert.equal(r.verdict, 'must', p);
    }
  });

  test('každý vyjmutý obor → nemusí evidovat, s upozorněním na jiné činnosti', () => {
    for (const s of rules.sectors.filter((x) => x.exempt)) {
      const r = evaluate({ form: 'po', payments: ['cash'], sector: s.id }, rules);
      assert.equal(r.verdict, 'not', s.id);
      assert.ok(r.notes.includes(rules.sectorOtherActivitiesNote), s.id);
      assertHasOfficialSource(r);
    }
  });

  test('nevidomý podnikatel bez zaměstnanců → nemusí evidovat', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'none', blind: true, alone: true },
      rules,
    );
    assert.equal(r.verdict, 'not');
    assertHasOfficialSource(r);
  });

  test('nevidomý podnikatel se zaměstnanci → musí evidovat', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'none', blind: true, alone: false },
      rules,
    );
    assert.equal(r.verdict, 'must');
    assert.ok(r.reasons.some((x) => x.text === rules.blindExemption.reasonNotMet));
  });

  test('příjmy přesně na limitu → EET OFF lze (zákon: „nepřesáhly“)', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band1', income: off.incomeLimit, blind: false },
      rules,
    );
    assert.equal(r.verdict, 'off');
  });

  test('příjmy o 1 Kč nad limitem → EET OFF nelze', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band1', income: off.incomeLimit + 1, blind: false },
      rules,
    );
    assert.equal(r.verdict, 'must');
  });

  test('právnická osoba → EET OFF nelze', () => {
    const r = evaluate({ form: 'po', payments: ['cash'], sector: 'none' }, rules);
    assert.equal(r.eetOff.eligible, false);
    assert.equal(r.eetOff.code, 'notPerson');
  });

  test('1. pásmo bez zadaných příjmů → EET OFF neposoudíme', () => {
    const r = evaluate({ form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band1', blind: false }, rules);
    assert.equal(r.verdict, 'must');
    assert.equal(r.eetOff.code, 'missingIncome');
  });
});

describe('MOJE eet', () => {
  test('do max. počtu evidenčních jednotek je MOJE eet vhodná', () => {
    const r = evaluate({ form: 'po', payments: ['cash'], sector: 'none', units: rules.mojeEet.maxUnits }, rules);
    assert.equal(r.mojeEet.suitable, true);
  });

  test('nad max. počtem evidenčních jednotek MOJE eet nedoporučíme', () => {
    const r = evaluate({ form: 'po', payments: ['cash'], sector: 'none', units: rules.mojeEet.maxUnits + 1 }, rules);
    assert.equal(r.mojeEet.suitable, false);
  });
});

describe('kalkulačka EET OFF', () => {
  test('MOJE eet zdarma → evidence vychází levněji', () => {
    const c = compareCosts({ useMojeEet: true }, rules);
    assert.equal(c.surcharge, 16800);
    assert.equal(c.evidenceCost, 0);
    assert.equal(c.cheaper, 'evidence');
    assert.equal(c.diff, 16800);
    assert.match(c.sentence, /^Evidence vychází levněji/);
  });

  test('vlastní pokladna 20 000 Kč → EET OFF vychází levněji', () => {
    const c = compareCosts({ useMojeEet: false, ownCostAnnual: 20000 }, rules);
    assert.equal(c.cheaper, 'off');
    assert.equal(c.diff, 3200);
    assert.match(c.sentence, /^EET OFF vychází levněji/);
  });

  test('stejná cena → obě vycházejí stejně', () => {
    const c = compareCosts({ useMojeEet: false, ownCostAnnual: eetOffAnnualSurcharge(rules) }, rules);
    assert.equal(c.cheaper, 'equal');
  });

  test('neplatná cena pokladny se bere jako 0', () => {
    const c = compareCosts({ useMojeEet: false, ownCostAnnual: Number.NaN }, rules);
    assert.equal(c.evidenceCost, 0);
  });
});

describe('dotazník', () => {
  test('nepodnikám → jen jedna otázka', () => {
    assert.deepEqual(visibleQuestions({ form: 'none' }, rules), ['form']);
  });

  test('jen online platby → bez dalších otázek po platbách', () => {
    assert.deepEqual(visibleQuestions({ form: 'osvc', payments: ['online'] }, rules), ['form', 'payments']);
  });

  test('OSVČ v 1. pásmu, nevidomý → všech 8 otázek, nikdy víc', () => {
    const q = visibleQuestions(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band1', income: 500000, blind: true, alone: false },
      rules,
    );
    assert.deepEqual(q, ['form', 'payments', 'sector', 'flatTax', 'income', 'blind', 'alone', 'units']);
    assert.ok(q.length <= 8);
  });

  test('právnická osoba → bez otázek na paušál a průkaz', () => {
    const q = visibleQuestions({ form: 'po', payments: ['card'], sector: 'none' }, rules);
    assert.deepEqual(q, ['form', 'payments', 'sector', 'units']);
  });

  test('vyjmutý obor → otázka na jednotky se nezobrazí', () => {
    const q = visibleQuestions({ form: 'po', payments: ['cash'], sector: 'gambling' }, rules);
    assert.deepEqual(q, ['form', 'payments', 'sector']);
  });
});

describe('kontrolní seznam', () => {
  test('musí evidovat → kroky evidence s termíny, bez EET OFF', () => {
    const r = evaluate({ form: 'po', payments: ['cash'], sector: 'none', units: 1 }, rules);
    const groups = buildChecklist(r, rules);
    assert.deepEqual(groups.map((g) => g.id), ['evidence']);
    const ids = groups[0].items.map((i) => i.id);
    assert.deepEqual(ids, ['dis', 'units', 'cert', 'appMojeEet', 'test', 'start']);
  });

  test('EET OFF → nejdřív oznámení s termínem, pak alternativa evidence', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band1', income: 800000, blind: false, units: 5 },
      rules,
    );
    const groups = buildChecklist(r, rules);
    assert.deepEqual(groups.map((g) => g.id), ['off', 'evidence']);
    assert.equal(groups[0].items[0].deadline, off.registrationDeadline);
    assert.ok(groups[1].items.some((i) => i.id === 'appPos'));
    assert.ok(!groups[1].items.some((i) => i.id === 'appMojeEet'));
  });

  test('nemusí evidovat → jen připomínka', () => {
    const groups = buildChecklist(evaluate({ form: 'none' }, rules), rules);
    assert.deepEqual(groups.map((g) => g.id), ['not']);
  });

  test('každá položka seznamu má oficiální zdroj', () => {
    const r = evaluate(
      { form: 'osvc', payments: ['cash'], sector: 'none', flatTax: 'band1', income: 1, blind: false, units: 1 },
      rules,
    );
    for (const g of buildChecklist(r, rules)) {
      for (const i of g.items) assert.ok(isOfficial(i.source.url), i.id);
    }
  });
});

describe('integrita rules.json a kódu', () => {
  test('každá položka se zdrojem má oficiální URL a datum ověření', () => {
    let count = 0;
    (function walk(node, path) {
      if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
      if (node && typeof node === 'object') {
        for (const key of Object.keys(node)) {
          if (/[sS]ource$/.test(key) && typeof node[key] === 'string') {
            count++;
            assert.ok(isOfficial(node[key]), `${path}.${key}: ${node[key]}`);
            assert.match(node.verified ?? '', /^\d{4}-\d{2}-\d{2}$/, `${path}: chybí verified`);
          }
        }
        for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
      }
    })(rules, 'rules');
    assert.ok(count > 30);
  });

  test('neobsahuje nepotvrzenou výjimku pro hotovost do 300 000 Kč', () => {
    const raw = readFileSync(new URL('../rules.json', import.meta.url), 'utf8');
    assert.doesNotMatch(raw, /300\s?000/);
  });

  for (const file of ['rules.js', 'app.js', 'osvc.js', 'osvc-app.js', 'dom.js']) {
    test(`${file} nemá natvrdo zapsané částky, limity ani data`, () => {
      const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      assert.doesNotMatch(src, /(?<![\w.$])\d{2,}(?![\w])/, 'číslo se dvěma a více číslicemi');
      assert.doesNotMatch(src, /Kč/, 'měna patří do rules.json');
    });
  }
});
