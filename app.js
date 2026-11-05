// UI průvodce „Mám EET?“. Veškerá logika je v rules.js, texty a čísla v rules.json.
// Odpovědi drží jen proměnná `answers` v paměti stránky: nic se neukládá ani neodesílá.

import {
  evaluate,
  visibleQuestions,
  compareCosts,
  buildChecklist,
  fill,
  formatDate,
  uiVars,
} from './rules.js';
import { h, put, sourceLink } from './dom.js';

const $ = (id) => document.getElementById(id);

let rules;
let vars;
let answers = {};
let step = 0;

const sections = ['intro', 'quiz', 'result', 'calc', 'checklist', 'actions'];
function show(...ids) {
  for (const id of sections) $(id).hidden = !ids.includes(id);
}

function focusHeading(container) {
  const heading = container.querySelector('h1, h2, legend');
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0 });
}

/* ---------- Úvod ---------- */

function renderIntro() {
  const el = $('intro');
  put(el,
    h('h1', { text: rules.meta.subtitle }),
    h('p', { class: 'lead', text: fill(rules.ui.intro, vars) }),
    h('p', { class: 'privacy', text: rules.meta.privacyNote }),
    h('button', { class: 'btn primary', type: 'button', onclick: () => { step = 0; renderQuestion(); } },
      rules.ui.start),
  );
  show('intro');
}

/* ---------- Dotazník ---------- */

function optionsFor(q) {
  if (q.type === 'yesno') return [{ id: 'yes', label: rules.ui.yes }, { id: 'no', label: rules.ui.no }];
  return rules[q.optionsFrom];
}

function currentValue(q) {
  const v = answers[q.id];
  if (q.type === 'yesno') return v === undefined ? undefined : v ? 'yes' : 'no';
  return v;
}

function renderQuestion() {
  const ids = visibleQuestions(answers, rules);
  const q = rules.questions.find((x) => x.id === ids[step]);
  const el = $('quiz');
  const name = `q-${q.id}`;
  const error = h('p', { class: 'error', id: `${name}-error`, role: 'alert' });
  const value = currentValue(q);
  let control;

  if (q.type === 'number') {
    const input = h('input', {
      id: name, name, type: 'text', inputmode: 'numeric', autocomplete: 'off',
      'aria-describedby': `${name}-help ${name}-error`,
      value: value ?? '',
    });
    control = h('div', { class: 'number' },
      h('label', { class: 'visually-hidden', for: name, text: fill(q.title, vars) }),
      input, q.unit ? h('span', { class: 'unit', text: q.unit }) : null);
  } else {
    const type = q.type === 'multi' ? 'checkbox' : 'radio';
    control = h('div', { class: 'options' }, optionsFor(q).map((o) => {
      const checked = q.type === 'multi' ? (value ?? []).includes(o.id) : value === o.id;
      return h('label', { class: 'option' },
        h('input', { type, name, value: o.id, checked }),
        h('span', { text: o.label }));
    }));
  }

  const form = h('form', { novalidate: true, onsubmit: (e) => { e.preventDefault(); next(q, form, error); } },
    h('fieldset', {},
      h('legend', { text: fill(q.title, vars) }),
      h('p', { class: 'help', id: `${name}-help`, text: q.help }),
      control,
      error),
    h('div', { class: 'nav' },
      h('button', { class: 'btn', type: 'button', onclick: back }, rules.ui.back),
      h('button', { class: 'btn primary', type: 'submit' }, rules.ui.next)));

  put(el,
    h('p', { class: 'progress', text: fill(rules.ui.progress, { current: step + 1, total: ids.length }) }),
    form,
  );
  show('quiz');
  focusHeading(el);
}

function readAnswer(q, form) {
  const name = `q-${q.id}`;
  if (q.type === 'multi') {
    const vals = [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);
    return vals.length ? { ok: true, value: vals } : { ok: false, msg: rules.ui.validationMulti };
  }
  if (q.type === 'number') {
    const raw = form.querySelector(`#${name}`).value.replace(/\s/g, '');
    const n = Number(raw);
    if (raw === '' || !Number.isInteger(n) || n < q.min) {
      return { ok: false, msg: fill(rules.ui.validationNumber, { min: q.min }) };
    }
    return { ok: true, value: n };
  }
  const checked = form.querySelector(`input[name="${name}"]:checked`);
  if (!checked) return { ok: false, msg: rules.ui.validationMulti };
  return { ok: true, value: q.type === 'yesno' ? checked.value === 'yes' : checked.value };
}

function next(q, form, error) {
  const a = readAnswer(q, form);
  if (!a.ok) {
    error.textContent = a.msg;
    form.querySelector('input')?.focus();
    return;
  }
  answers[q.id] = a.value;
  const ids = visibleQuestions(answers, rules);
  if (step + 1 < ids.length) {
    step += 1;
    renderQuestion();
  } else {
    renderResult();
  }
}

function back() {
  if (step === 0) return renderIntro();
  step -= 1;
  renderQuestion();
}

/* ---------- Výsledek ---------- */

function renderResult() {
  const result = evaluate(answers, rules);
  const r = $('result');
  put(r,
    h('div', { class: `verdict verdict-${result.verdict}` },
      h('h1', { text: result.headline }),
      h('p', { text: result.sub })),
    h('h2', { text: rules.ui.whyTitle }),
    result.intro ? h('p', { text: result.intro }) : null,
    h('ul', { class: 'reasons' }, result.reasons.map((x) =>
      h('li', {}, h('p', { text: x.text }), sourceLink(x.source, rules.ui.sourceLabel)))),
    result.notes.map((n) => h('p', { class: 'note', text: n })),
    result.eetOff ? h('div', { class: 'card' },
      h('h2', { text: rules.ui.eetOffTitle }),
      h('p', { text: result.eetOff.eligible ? result.eetOff.deadlineText : result.eetOff.text }),
      result.eetOff.eligible ? h('p', { text: result.eetOff.fixedForYear }) : null,
      sourceLink(result.eetOff.source, rules.ui.sourceLabel),
      result.eetOff.eligible ? sourceLink(result.eetOff.deadlineSource, rules.ui.sourceLabel) : null,
      result.eetOff.eligible ? sourceLink(result.eetOff.amountsSource, rules.ui.sourceLabel) : null) : null,
    result.mojeEet?.text ? h('div', { class: 'card' },
      h('h2', { text: rules.mojeEet.name }),
      h('p', { text: result.mojeEet.text }),
      sourceLink(result.mojeEet.source, rules.ui.sourceLabel),
      result.mojeEet.suitable ? sourceLink(result.mojeEet.certificateSource, rules.ui.sourceLabel) : null) : null,
  );

  const visible = ['result', 'checklist', 'actions'];
  if (result.eetOff?.eligible) {
    renderCalc(result);
    visible.push('calc');
  }
  renderChecklist(result);
  renderActions();
  show(...visible);
  focusHeading(r);
}

/* ---------- Kalkulačka EET OFF ---------- */

function renderCalc(result) {
  const c = rules.calculator;
  const el = $('calc');
  const mojeAllowed = result.mojeEet?.suitable !== false;
  const output = h('p', { class: 'calc-output', 'aria-live': 'polite' });
  const costInput = h('input', { id: 'own-cost', type: 'text', inputmode: 'numeric', autocomplete: 'off', value: '' });
  const costRow = h('div', { class: 'number' },
    h('label', { for: 'own-cost', class: 'block', text: c.ownCostLabel }), costInput,
    h('span', { class: 'unit', text: rules.meta.currency }));

  const update = () => {
    const useMojeEet = mojeAllowed && el.querySelector('input[name="calc-mode"]:checked')?.value === 'moje';
    costRow.hidden = useMojeEet;
    const own = Number(costInput.value.replace(/\s/g, ''));
    output.textContent = compareCosts({ useMojeEet, ownCostAnnual: own }, rules).sentence;
  };

  const modes = mojeAllowed
    ? h('div', { class: 'options' },
      h('label', { class: 'option' }, h('input', { type: 'radio', name: 'calc-mode', value: 'moje', checked: true, onchange: update }),
        h('span', { text: c.optionMojeEet })),
      h('label', { class: 'option' }, h('input', { type: 'radio', name: 'calc-mode', value: 'own', onchange: update }),
        h('span', { text: c.optionOwn })))
    : null;
  costInput.addEventListener('input', update);

  put(el,
    h('h2', { text: rules.ui.calcTitle }),
    h('p', { text: c.intro }),
    modes,
    costRow,
    output,
    h('p', { class: 'help', text: c.timeNote }),
    result.taxCredit ? h('p', { class: 'help', text: result.taxCredit.text }) : null,
    sourceLink(result.eetOff.amountsSource, rules.ui.sourceLabel),
    result.taxCredit ? sourceLink(result.taxCredit.source, rules.ui.sourceLabel) : null,
  );
  update();
}

/* ---------- Kontrolní seznam ---------- */

function renderChecklist(result) {
  const c = rules.checklist;
  const el = $('checklist');
  const groups = buildChecklist(result, rules);
  put(el,
    h('h2', { text: c.title }),
    result.verdict === 'not' ? null : h('p', { class: 'help', text: fill(c.intro, vars) }),
    groups.map((g) => h('div', { class: 'group' },
      g.title ? h('h3', { text: g.title }) : null,
      h('ol', { class: 'todo' }, g.items.map((i) => h('li', {},
        h('label', { class: 'todo-title' }, h('input', { type: 'checkbox' }), h('span', { text: i.title })),
        i.deadline ? h('p', { class: `deadline ${i.deadlineKind}` },
          h('strong', { text: `${i.deadlineKind === 'hard' ? rules.ui.deadlineHard : rules.ui.deadlineRecommended}: ` }),
          formatDate(i.deadline)) : null,
        i.availableFrom ? h('p', { class: 'available', text: `${rules.ui.availableFrom}: ${formatDate(i.availableFrom)}` }) : null,
        h('p', { text: i.text }),
        sourceLink(i.source, rules.ui.sourceLabel)))))),
    h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, rules.ui.print),
  );
}

function renderActions() {
  put($('actions'),
    h('button', { class: 'btn', type: 'button', onclick: () => { step = visibleQuestions(answers, rules).length - 1; renderQuestion(); } },
      rules.ui.back),
    h('button', { class: 'btn primary', type: 'button', onclick: () => { answers = {}; step = 0; renderIntro(); } },
      rules.ui.restart),
  );
}

/* ---------- Patička ---------- */

function renderFooter() {
  const m = rules.meta;
  put($('footer'),
    h('p', { class: 'disclaimer', text: m.disclaimer }),
    h('p', {}, `${rules.ui.footerVerified}: `, h('strong', { text: formatDate(m.lastVerified) })),
    h('p', {},
      h('a', { href: m.officialSite.url, target: '_blank', rel: 'noopener noreferrer', text: m.officialSite.label }),
      ' · ', `${m.hotline.label}: `,
      h('a', { href: m.hotline.phoneHref, text: m.hotline.phone }),
      ` (${m.hotline.hours})`),
    h('p', { class: 'help', text: m.privacyNote }),
  );
}

/* ---------- Start ---------- */

async function init() {
  try {
    const res = await fetch('rules.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    rules = await res.json();
  } catch {
    put($('intro'), h('p', { class: 'notice', text: 'Nepodařilo se načíst pravidla (rules.json). Spusť web přes webový server, viz README.' }));
    show('intro');
    return;
  }
  vars = uiVars(rules);
  $('brand').textContent = rules.meta.title;
  $('tagline').textContent = rules.meta.subtitle;
  renderFooter();
  renderIntro();
}

init();
