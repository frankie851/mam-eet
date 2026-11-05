// Kalkulačka OSVČ 2027: paušální daň, přiznání, nebo EET OFF?
// Čisté funkce bez vazby na DOM. Všechny sazby, limity, částky a texty jsou
// v rules.json (sekce osvc2027, přirážka a limit EET OFF v sekci eetOff).

import { fill, formatCzk, formatDate } from './rules.js';

const EPS = 1e-6;

/** Zaokrouhlení nahoru na celé Kč (odolné vůči chybám plovoucí čárky, např. 100000 × 0,135). */
export function ceilKc(x) {
  return Math.ceil(x - EPS);
}

/** Zaokrouhlení dolů na celé násobky `step` (základ daně na stovky). */
function floorTo(x, step) {
  return Math.floor(x / step + EPS) * step;
}

function byId(list, id) {
  return list.find((x) => x.id === id);
}

function pct(rate) {
  return new Intl.NumberFormat('cs-CZ', { style: 'percent', maximumFractionDigits: 1 }).format(rate);
}

/**
 * Odvozené parametry roku: minimální vyměřovací základy, minimální zálohy,
 * maximální základ, rozhodná částka, hranice 23% sazby, podmínka bonusu.
 */
export function params(rules) {
  const o = rules.osvc2027;
  const avg = o.averageWage.monthly;
  const s = o.social;
  const z = o.health;
  const t = o.incomeTax;
  const minBaseMain = ceilKc(avg * s.minBaseShareMain);
  const minBaseSide = ceilKc(avg * s.minBaseShareSide);
  const healthMinBase = ceilKc(avg * z.minBaseShareMain);
  return {
    months: o.monthsPerYear,
    socialMinBaseMain: minBaseMain,
    socialMinBaseSide: minBaseSide,
    socialMinAdvanceMain: ceilKc(minBaseMain * s.rate),
    socialMinAdvanceSide: ceilKc(minBaseSide * s.rate),
    socialMaxBaseAnnual: avg * s.maxBaseAverageWageMultiple,
    sideThreshold: Math.floor(avg * s.sideThresholdAverageWageMultiple + EPS),
    healthMinBase,
    healthMinAdvance: ceilKc(healthMinBase * z.rate),
    highRateThreshold: avg * t.highRateAverageWageMultiple,
    bonusMinIncome: t.minimumWage * t.bonusMinIncomeMinimumWageMultiple,
  };
}

/** Výdaje: skutečné (pokud jsou zadané), jinak výdajový paušál se stropem. */
export function expenses({ income, flatRateId, actualExpenses }, rules) {
  if (Number.isFinite(actualExpenses)) return actualExpenses;
  const fr = byId(rules.osvc2027.expenseFlatRates, flatRateId);
  if (!fr) throw new Error(`Neznámý výdajový paušál: ${flatRateId}`);
  return Math.min(income * fr.rate, fr.cap);
}

/** Zisk = příjmy − výdaje (ztrátu nepočítáme, zisk je pak 0). */
export function profit(input, rules) {
  return Math.max(0, input.income - expenses(input, rules));
}

/** Součet daňového zvýhodnění na `children` dětí (3. a další dítě má stejnou částku). */
export function childCredit(children, rules) {
  const list = rules.osvc2027.incomeTax.childCredits;
  let sum = 0;
  for (let i = 0; i < children; i++) sum += list[Math.min(i, list.length - 1)];
  return sum;
}

/**
 * Daň z příjmů: 15 % (23 % nad 36násobkem průměrné mzdy) ze základu zaokrouhleného
 * na stovky dolů, minus sleva na poplatníka (nejvýš do nuly), minus zvýhodnění na děti
 * (zbytek je daňový bonus, pokud příjmy dosáhnou 6 × minimální mzdy).
 * Záporné `tax` znamená vyplacený daňový bonus.
 */
export function incomeTax({ profit: zisk, income, children = 0 }, rules) {
  const t = rules.osvc2027.incomeTax;
  const p = params(rules);
  const base = floorTo(zisk, t.baseRoundDownTo);
  const highPart = Math.max(0, base - p.highRateThreshold);
  const taxGross = ceilKc((base - highPart) * t.rate + highPart * t.highRate);
  const afterCredit = Math.max(0, taxGross - t.taxpayerCredit);
  const childTotal = childCredit(children, rules);
  let bonus = 0;
  let bonusBlocked = false;
  let tax;
  if (childTotal <= afterCredit) {
    tax = afterCredit - childTotal;
  } else {
    const rest = childTotal - afterCredit;
    if (income >= p.bonusMinIncome && rest >= t.bonusMinAnnual) bonus = rest;
    else bonusBlocked = income < p.bonusMinIncome;
    tax = -bonus;
  }
  return { base, highPart, taxGross, credit: t.taxpayerCredit, afterCredit, childTotal, bonus, bonusBlocked, tax };
}

/** Sociální pojištění za rok: max(55 % zisku, roční minimum), nejvýš maximální základ. */
export function socialIns(zisk, activityId, rules) {
  const o = rules.osvc2027;
  const a = byId(o.activities, activityId);
  if (!a) throw new Error(`Neznámý druh činnosti: ${activityId}`);
  const p = params(rules);
  if (a.socialSide && zisk <= p.sideThreshold) {
    return { none: true, threshold: p.sideThreshold, min: 0, base: 0, amount: 0 };
  }
  const min = (a.socialSide ? p.socialMinBaseSide : p.socialMinBaseMain) * p.months;
  const base = Math.min(Math.max(ceilKc(zisk * o.social.profitShare), min), p.socialMaxBaseAnnual);
  return { none: false, threshold: p.sideThreshold, min, base, amount: ceilKc(base * o.social.rate) };
}

/** Zdravotní pojištění za rok: max(50 % zisku, roční minimum). Minimum neplatí u vedlejší činnosti. */
export function healthIns(zisk, activityId, rules) {
  const o = rules.osvc2027;
  const a = byId(o.activities, activityId);
  if (!a) throw new Error(`Neznámý druh činnosti: ${activityId}`);
  const p = params(rules);
  const min = a.healthMinimum ? p.healthMinBase * p.months : 0;
  const base = Math.max(ceilKc(zisk * o.health.profitShare), min);
  return { min, base, amount: ceilKc(base * o.health.rate) };
}

/** Varianta 2: klasické přiznání. */
export function classic(input, rules) {
  const exp = expenses(input, rules);
  const zisk = Math.max(0, input.income - exp);
  const tax = incomeTax({ profit: zisk, income: input.income, children: input.children ?? 0 }, rules);
  const social = socialIns(zisk, input.activityId, rules);
  const health = healthIns(zisk, input.activityId, rules);
  const annual = tax.tax + social.amount + health.amount;
  return {
    id: 'classic',
    available: true,
    expenses: exp,
    profit: zisk,
    tax,
    social,
    health,
    annual,
    monthly: annual / rules.osvc2027.monthsPerYear,
  };
}

/** Na která pásma paušální daně má poplatník nárok a proč ne. */
export function flatTaxBands(input, rules) {
  const f = rules.osvc2027.flatTax;
  return f.bands.map((b) => {
    const limit = b.limits[input.flatRateId];
    return { band: b, limit, eligible: input.income <= limit };
  });
}

/** Důvod, proč paušální daň nejde vůbec (nebo null). */
function flatTaxBlocker(input, rules) {
  const o = rules.osvc2027;
  const tx = o.texts;
  const a = byId(o.activities, input.activityId);
  if (input.vatPayer) return { code: 'vat', text: tx.reasonVat };
  if (a && !a.flatTaxAllowed) return { code: 'employee', text: tx.reasonEmployee };
  if (input.income > o.flatTax.maxIncome) {
    return {
      code: 'overMax',
      text: fill(tx.reasonOverMax, { limit: formatCzk(o.flatTax.maxIncome, rules), income: formatCzk(input.income, rules) }),
    };
  }
  return null;
}

/** Varianta 1: paušální daň v nejnižším pásmu, na které má nárok. */
export function flatTax(input, rules) {
  const o = rules.osvc2027;
  const bands = flatTaxBands(input, rules);
  const blocker = flatTaxBlocker(input, rules);
  const chosen = blocker ? null : bands.find((x) => x.eligible);
  if (!chosen) {
    return { id: 'flat', available: false, code: blocker?.code ?? 'overMax', reason: blocker?.text ?? null, bands, band: null };
  }
  const annual = chosen.band.monthly * o.monthsPerYear;
  return { id: 'flat', available: true, bands, band: chosen.band, annual, monthly: chosen.band.monthly };
}

/** Varianta 3: EET OFF = paušál 1. pásma + přirážka. */
export function eetOffVariant(input, rules) {
  const o = rules.osvc2027;
  const tx = o.texts;
  const e = rules.eetOff;
  const flat = flatTax(input, rules);
  const band1 = byId(o.flatTax.bands, e.eligibleBandId);
  const fr = byId(o.expenseFlatRates, input.flatRateId);
  const base = { id: 'eetOff', band: band1, surchargeMonthly: e.surchargeMonthly };
  const no = (code, reason) => ({ ...base, available: false, code, reason });
  if (!flat.available) return no('noFlat', fill(tx.reasonEetNoFlat, { reason: flat.reason }));
  if (flat.band.id !== e.eligibleBandId) {
    return no('band', fill(tx.reasonEetBand, {
      flat: fr.label,
      limit: formatCzk(band1.limits[input.flatRateId], rules),
      income: formatCzk(input.income, rules),
      band: flat.band.label,
    }));
  }
  if (input.income > e.incomeLimit) {
    return no('limit', fill(tx.reasonEetLimit, { limit: formatCzk(e.incomeLimit, rules), income: formatCzk(input.income, rules) }));
  }
  if (!input.contactPayments) return no('noContact', tx.reasonEetNoContact);
  const monthly = band1.monthly + e.surchargeMonthly;
  return { ...base, available: true, monthly, annual: monthly * o.monthsPerYear };
}

/** Názvy variant pro tabulku. */
function variantName(v, input, rules) {
  const tx = rules.osvc2027.texts;
  if (v.id === 'flat') return v.band ? fill(tx.variantFlat, { band: v.band.label }) : tx.variantFlatNoBand;
  if (v.id === 'eetOff') return tx.variantEetOff;
  if (Number.isFinite(input.actualExpenses)) return tx.variantClassicActual;
  const fr = byId(rules.osvc2027.expenseFlatRates, input.flatRateId);
  return fill(tx.variantClassicFlat, { rate: pct(fr.rate) });
}

/** Rozpis výpočtu (řádky textu) pro dostupné varianty. */
function breakdown(c, flat, off, input, rules) {
  const tx = rules.osvc2027.texts;
  const p = params(rules);
  const k = (n) => formatCzk(n, rules);
  const lines = [];
  lines.push(fill(tx.lineProfit, { income: k(input.income), expenses: k(c.expenses), profit: k(c.profit) }));
  lines.push(fill(tx.lineTax, {
    taxGross: k(c.tax.taxGross),
    credit: k(c.tax.credit),
    high: c.tax.highPart > 0 ? fill(tx.lineHigh, { threshold: k(p.highRateThreshold) }) : '',
    taxAfterCredit: k(c.tax.afterCredit),
  }));
  if (c.tax.childTotal > 0) {
    lines.push(fill(tx.lineChildren, { children: k(c.tax.childTotal), tax: k(Math.max(0, c.tax.tax)) })
      + (c.tax.bonus > 0 ? fill(tx.lineBonus, { bonus: k(c.tax.bonus) }) : ''));
    if (c.tax.bonusBlocked) lines.push(fill(tx.lineNoBonus, { limit: k(p.bonusMinIncome) }));
  }
  lines.push(c.social.none
    ? fill(tx.lineSocialNone, { threshold: k(c.social.threshold) })
    : fill(tx.lineSocial, { min: k(c.social.min), base: k(c.social.base), amount: k(c.social.amount) }));
  lines.push(fill(tx.lineHealth, { min: k(c.health.min), base: k(c.health.base), amount: k(c.health.amount) }));
  if (flat.available) {
    const b = flat.band;
    lines.push(fill(tx.lineFlatParts, { band: b.label, monthly: k(b.monthly), tax: k(b.tax), social: k(b.social), health: k(b.health) }));
  }
  if (off.available) {
    lines.push(fill(tx.lineEetOff, { band1: k(off.band.monthly), surcharge: k(off.surchargeMonthly), monthly: k(off.monthly) }));
  }
  return lines;
}

/**
 * Porovnání tří variant: roční a měsíční odvody, nejlevnější varianta, rozdíly,
 * důvody nedostupnosti, poznámky a rozpis výpočtu.
 */
export function compare(input, rules) {
  const o = rules.osvc2027;
  const tx = o.texts;
  const k = (n) => formatCzk(n, rules);
  const flat = flatTax(input, rules);
  const c = classic(input, rules);
  const off = eetOffVariant(input, rules);
  const variants = [flat, c, off].map((v) => ({ ...v, name: variantName(v, input, rules) }));

  const avail = variants.filter((v) => v.available).sort((a, b) => a.annual - b.annual);
  const cheapest = avail[0];
  for (const v of variants) v.diff = v.available ? v.annual - cheapest.annual : null;
  const next = avail[1] ?? null;

  let summary;
  if (!next) summary = fill(tx.summaryOnly, { variant: cheapest.name, annual: k(cheapest.annual) });
  else if (next.annual === cheapest.annual) {
    summary = fill(tx.summaryEqual, { variant: cheapest.name, next: next.name, annual: k(cheapest.annual) });
  } else {
    summary = fill(tx.summaryCheapest, {
      variant: cheapest.name, annual: k(cheapest.annual), diff: k(next.annual - cheapest.annual), next: next.name,
    });
  }

  const notes = [];
  if (flat.available && c.tax.childTotal > 0) notes.push(fill(tx.noteChildrenFlat, { children: k(c.tax.childTotal) }));
  if (input.contactPayments) notes.push(fill(tx.noteEvidence, { launch: formatDate(rules.launch.date) }));
  notes.push(fill(tx.notePrevYear, { prevYear: rules.eetOff.incomeYear }));
  const band1 = byId(o.flatTax.bands, rules.eetOff.eligibleBandId);
  if (band1.status === 'derived' && (flat.band?.id === band1.id || off.available)) {
    notes.push(fill(tx.noteBand1Status, { year: o.year, verified: formatDate(band1.verified) }));
  }
  notes.push(tx.noteNotIncluded);

  return {
    variants,
    cheapestId: cheapest.id,
    summary,
    notes,
    breakdown: breakdown(c, flat, off, input, rules),
    bands: flat.bands,
  };
}

/** Příjmy, pro které se kreslí graf: pravidelná mřížka + přesné hranice pásem a EET OFF. */
export function chartIncomes(input, rules) {
  const ch = rules.osvc2027.chart;
  const set = new Set();
  for (let x = ch.min; x <= ch.max; x += ch.step) set.add(x);
  const limits = rules.osvc2027.flatTax.bands.map((b) => b.limits[input.flatRateId]);
  limits.push(rules.eetOff.incomeLimit);
  for (const l of limits) {
    if (l >= ch.min && l <= ch.max) set.add(l);
    if (l + 1 >= ch.min && l + 1 <= ch.max) set.add(l + 1);
  }
  return [...set].sort((a, b) => a - b);
}

/** Body grafu: roční odvody podle příjmů pro zvolený výdajový paušál. null = varianta nedostupná. */
export function series(input, rules, incomes = chartIncomes(input, rules)) {
  return incomes.map((income) => {
    const i = { ...input, income, actualExpenses: null };
    const f = flatTax(i, rules);
    const e = eetOffVariant(i, rules);
    return {
      income,
      flat: f.available ? f.annual : null,
      classic: classic(i, rules).annual,
      eetOff: e.available ? e.annual : null,
    };
  });
}

/**
 * Body zlomu mezi paušální daní a přiznáním (výdajový paušál): příjmy, od kterých
 * se mění levnější varianta. Hledá se s krokem chart.breakEvenStep.
 */
export function breakEven(input, rules) {
  const ch = rules.osvc2027.chart;
  const incomes = [];
  for (let x = ch.min; x <= ch.max; x += ch.breakEvenStep) incomes.push(x);
  const pts = series(input, rules, incomes);
  const out = [];
  let prev = null;
  for (const p of pts) {
    if (p.flat === null) { prev = null; continue; }
    const cheaper = p.flat < p.classic ? 'flat' : 'classic';
    if (prev && cheaper !== prev) out.push({ income: p.income, cheaper, flat: p.flat, classic: p.classic });
    prev = cheaper;
  }
  return out;
}

/** Proměnné pro texty UI. */
export function osvcVars(rules, extra = {}) {
  return {
    year: rules.osvc2027.year,
    launch: formatDate(rules.launch.date),
    ...extra,
  };
}

export { pct as formatPercent };
