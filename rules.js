// Rozhodovací logika průvodce „Mám EET?“.
// Čisté funkce bez vazby na DOM: vstupem jsou odpovědi a obsah rules.json,
// výstupem prostá data. Žádné částky, limity ani termíny tu nejsou natvrdo,
// vše se čte z rules.json.

/** Nahradí {klíč} v šabloně hodnotou z vars. */
export function fill(template, vars = {}) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m));
}

/** 16800 → „16 800 Kč“ (měna z rules.json). */
export function formatCzk(amount, rules) {
  const n = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 }).format(amount);
  return `${n} ${rules.meta.currency}`;
}

/** „2027-01-11“ → „11. 1. 2027“. */
export function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d}. ${m}. ${y}`;
}

function src(item, urlKey = 'source', titleKey = 'sourceTitle') {
  return { url: item[urlKey], title: item[titleKey] ?? item[urlKey], verified: item.verified };
}

function byId(list, id) {
  return list.find((x) => x.id === id);
}

function recordedMethods(payments, rules) {
  return (payments ?? []).map((id) => byId(rules.paymentMethods, id)).filter((m) => m?.recorded);
}

/** Roční přirážka EET OFF = měsíční přirážka × počet měsíců. */
export function eetOffAnnualSurcharge(rules) {
  return rules.eetOff.surchargeMonthly * rules.eetOff.monthsPerYear;
}

/** Proměnné pro šablony textů v rules.json. */
function templateVars(rules, extra = {}) {
  const o = rules.eetOff;
  return {
    launch: formatDate(rules.launch.date),
    year: o.incomeYear,
    limit: formatCzk(o.incomeLimit, rules),
    surchargeMonthly: formatCzk(o.surchargeMonthly, rules),
    surchargeAnnual: formatCzk(eetOffAnnualSurcharge(rules), rules),
    withOff: formatCzk(o.taxComponentWithOffMonthly, rules),
    base: formatCzk(o.taxComponentBaseMonthly, rules),
    deadline: formatDate(o.registrationDeadline),
    maxUnits: rules.mojeEet.maxUnits,
    from: formatDate(rules.mojeEet.availableFrom),
    amount: formatCzk(rules.taxCredit.maxAmount, rules),
    ...extra,
  };
}

/**
 * Pořadí otázek, které se mají pro dané odpovědi zobrazit.
 * Seznam končí u první nezodpovězené otázky, protože další větvení na ní závisí.
 */
export function visibleQuestions(answers, rules) {
  const ids = ['form'];
  const form = byId(rules.forms, answers.form);
  if (!form || !form.business) return ids;

  ids.push('payments');
  if (!answers.payments?.length) return ids;
  if (recordedMethods(answers.payments, rules).length === 0) return ids;

  ids.push('sector');
  if (answers.sector === undefined) return ids;
  if (byId(rules.sectors, answers.sector)?.exempt) return ids;

  if (form.naturalPerson) {
    ids.push('flatTax');
    if (answers.flatTax === undefined) return ids;
    if (answers.flatTax === rules.eetOff.eligibleBandId) {
      ids.push('income');
      if (answers.income === undefined) return ids;
    }
    ids.push('blind');
    if (answers.blind === undefined) return ids;
    if (answers.blind) {
      ids.push('alone');
      if (answers.alone === undefined) return ids;
      if (answers.alone) return ids;
    }
  }

  ids.push('units');
  return ids;
}

/** Ponechá jen odpovědi na otázky, které jsou pro tuto cestu dotazníkem relevantní. */
export function pruneAnswers(answers, rules) {
  const visible = new Set(visibleQuestions(answers, rules));
  return Object.fromEntries(Object.entries(answers).filter(([k]) => visible.has(k)));
}

/** Posouzení režimu EET OFF. */
export function assessEetOff(answers, rules) {
  const o = rules.eetOff;
  const income = answers.income;
  const vars = templateVars(rules, {
    income: Number.isFinite(income) ? formatCzk(income, rules) : '',
  });
  const base = {
    surchargeMonthly: o.surchargeMonthly,
    surchargeAnnual: eetOffAnnualSurcharge(rules),
    registrationDeadline: o.registrationDeadline,
    fixedForYear: fill(o.texts.fixedForYear, vars),
    deadlineText: fill(o.texts.deadline, vars),
    source: src(o),
    amountsSource: src(o, 'amountsSource', 'amountsSourceTitle'),
    deadlineSource: src(o, 'deadlineSource', 'deadlineSourceTitle'),
  };

  let code;
  if (answers.form !== o.eligibleFormId) code = 'notPerson';
  else if (!answers.flatTax || byId(rules.flatTaxBands, answers.flatTax)?.id === 'none') code = 'notFlatTax';
  else if (answers.flatTax !== o.eligibleBandId) code = 'wrongBand';
  else if (!Number.isFinite(income)) code = 'missingIncome';
  else if (income > o.incomeLimit) code = 'overLimit';
  else code = 'eligible';

  return { ...base, eligible: code === 'eligible', code, text: fill(o.texts[code], vars) };
}

/** Je pro daný počet evidenčních jednotek vhodná aplikace MOJE eet? */
export function assessMojeEet(units, rules) {
  const m = rules.mojeEet;
  const vars = templateVars(rules);
  if (!Number.isFinite(units)) return { suitable: null, text: null, source: src(m) };
  const suitable = units <= m.maxUnits;
  return {
    suitable,
    text: fill(suitable ? m.texts.suitable : m.texts.unsuitable, vars),
    source: src(m),
    certificateSource: src(m, 'certificateSource', 'certificateSourceTitle'),
  };
}

/**
 * Hlavní rozhodnutí.
 * @returns {{verdict: 'must'|'not'|'off', headline: string, sub: string,
 *   reasons: {text: string, source: {url: string, title: string}}[], notes: string[],
 *   eetOff: object|null, mojeEet: object|null, taxCredit: object|null}}
 */
export function evaluate(rawAnswers, rules) {
  const answers = pruneAnswers(rawAnswers, rules);
  const vars = templateVars(rules);
  const form = byId(rules.forms, answers.form);
  if (!form) throw new Error(`Neznámá forma podnikání: ${answers.form}`);

  const done = (verdict, reasons, extra = {}) => ({
    verdict,
    headline: fill(rules.results[verdict].headline, vars),
    sub: fill(rules.results[verdict].sub, vars),
    reasons,
    notes: [],
    eetOff: null,
    mojeEet: null,
    taxCredit: null,
    ...extra,
  });

  // 1. Nepodnikám.
  if (!form.business) return done('not', [{ text: form.reason, source: src(form) }]);

  // 2. Žádná evidovaná platba.
  const methods = (answers.payments ?? []).map((id) => byId(rules.paymentMethods, id)).filter(Boolean);
  if (methods.length === 0) throw new Error('Chybí způsob přijímání plateb.');
  const recorded = methods.filter((m) => m.recorded);
  if (recorded.length === 0) {
    return done(
      'not',
      methods.map((m) => ({ text: m.reason, source: src(m) })),
      { intro: rules.results.notRecordedIntro },
    );
  }

  // 3. Obor vyjmutý ze zákona.
  const sector = byId(rules.sectors, answers.sector);
  if (sector?.exempt) {
    return done('not', [{ text: sector.reason, source: src(sector) }], {
      notes: [rules.sectorOtherActivitiesNote],
    });
  }

  const reasons = recorded.map((m) => ({ text: m.reason, source: src(m) }));

  // 4. Výjimka pro nevidomé podnikatele (§ 11 odst. 4).
  if (form.naturalPerson && answers.blind === true) {
    const b = rules.blindExemption;
    if (answers.alone === true) return done('not', [{ text: b.reasonMet, source: src(b) }]);
    reasons.push({ text: b.reasonNotMet, source: src(b) });
  }

  // 5. EET OFF, 6. jinak povinnost evidovat.
  const eetOff = assessEetOff(answers, rules);
  const verdict = eetOff.eligible ? 'off' : 'must';
  if (eetOff.eligible) reasons.push({ text: eetOff.text, source: eetOff.source });
  else {
    const r = rules.results;
    reasons.push({ text: r.mustReason, source: src(r, 'mustReasonSource', 'mustReasonSourceTitle') });
  }

  const tc = rules.taxCredit;
  return done(verdict, reasons, {
    intro: rules.results.recordedIntro,
    eetOff,
    mojeEet: assessMojeEet(answers.units, rules),
    taxCredit: form.naturalPerson ? { text: fill(tc.text, vars), source: src(tc) } : null,
  });
}

/** Porovnání přirážky EET OFF s ročními náklady na evidenci. */
export function compareCosts({ useMojeEet, ownCostAnnual }, rules) {
  const surcharge = eetOffAnnualSurcharge(rules);
  const own = Number.isFinite(ownCostAnnual) && ownCostAnnual > 0 ? ownCostAnnual : 0;
  const evidenceCost = useMojeEet ? rules.mojeEet.priceAnnual : own;
  const diff = Math.abs(surcharge - evidenceCost);
  let cheaper = 'equal';
  if (evidenceCost < surcharge) cheaper = 'evidence';
  else if (evidenceCost > surcharge) cheaper = 'off';
  const key = { evidence: 'evidenceCheaper', off: 'offCheaper', equal: 'equal' }[cheaper];
  const sentence = fill(rules.calculator.sentences[key], {
    surcharge: formatCzk(surcharge, rules),
    evidenceCost: formatCzk(evidenceCost, rules),
    diff: formatCzk(diff, rules),
  });
  return { surcharge, evidenceCost, diff, cheaper, sentence };
}

/** Kontrolní seznam s termíny podle výsledku. */
export function buildChecklist(result, rules) {
  const c = rules.checklist;
  const vars = templateVars(rules);
  const suitable = result.mojeEet?.suitable;
  const toItem = (i) => ({
    id: i.id,
    title: fill(i.title, vars),
    text: fill(i.id === 'cert' && suitable !== false ? `${i.text} ${i.textMojeEet}` : i.text, vars),
    deadline: i.deadline ?? null,
    deadlineKind: i.deadlineKind ?? null,
    availableFrom: i.availableFrom ?? null,
    source: src(i),
  });

  if (result.verdict === 'not') return [{ id: 'not', title: null, items: c.notItems.map(toItem) }];

  const groups = [];
  if (result.verdict === 'off') groups.push({ id: 'off', title: c.offGroupTitle, items: c.offItems.map(toItem) });
  const evidence = c.evidenceItems.filter((i) => {
    if (i.requires === 'mojeEetSuitable') return suitable !== false;
    if (i.requires === 'mojeEetUnsuitable') return suitable === false;
    return true;
  });
  groups.push({
    id: 'evidence',
    title: result.verdict === 'off' ? c.evidenceGroupTitleIfOff : c.evidenceGroupTitle,
    items: evidence.map(toItem),
  });
  return groups;
}

/** Proměnné pro texty v UI (jen přeposílá výpočet z rules.json). */
export function uiVars(rules, extra = {}) {
  return templateVars(rules, extra);
}
