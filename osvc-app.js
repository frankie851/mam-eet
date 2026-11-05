// UI záložky „Paušál, nebo přiznání?“ (OSVČ 2027) a přepínání záložek.
// Výpočty jsou v osvc.js, čísla a texty v rules.json. Zadané hodnoty drží jen
// proměnná `state` v paměti stránky: nic se neukládá ani neodesílá.

import { fill, formatCzk, formatDate } from './rules.js';
import { compare, series, chartIncomes, breakEven, osvcVars, formatPercent, params } from './osvc.js';
import { h, put, sourceLink } from './dom.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';

let rules;
let o;
let tx;
let vars;
const state = {
  income: null,
  flatRateId: null,
  expenseMode: 'flat',
  actualExpenses: null,
  vatPayer: false,
  children: 0,
  activityId: null,
  contactPayments: true,
};
let resizeObserver;

const k = (n) => formatCzk(Math.round(n), rules);
const byId = (list, id) => list.find((x) => x.id === id);

/* ---------- Záložky ---------- */

// Záložky jsou odkazy (#eet, #osvc): klik změní adresu i dřív, než se načte tento skript,
// a po načtení se otevře záložka podle adresy. Přepínání proto řídí jen událost hashchange.
const TABS = [
  { id: 'eet', tab: 'tab-eet', panel: 'panel-eet', hash: '#eet' },
  { id: 'osvc', tab: 'tab-osvc', panel: 'panel-osvc', hash: '#osvc' },
];

function activeTab() {
  return location.hash === '#osvc' ? 'osvc' : 'eet';
}

function selectTab(id, { focus = false } = {}) {
  for (const t of TABS) {
    const on = t.id === id;
    const tab = $(t.tab);
    tab.setAttribute('aria-selected', String(on));
    tab.tabIndex = on ? 0 : -1;
    $(t.panel).hidden = !on;
    if (on && focus) tab.focus();
  }
}

function setupTabs() {
  $('tab-eet').textContent = tx.tabEet;
  $('tab-osvc').textContent = tx.tabOsvc;
  $('tabs').addEventListener('keydown', (e) => {
    if (e.key === ' ') {
      e.preventDefault();
      e.target.closest('[role="tab"]')?.click();
      return;
    }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === activeTab());
    let j = i;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = TABS.length - 1;
    history.replaceState(null, '', TABS[j].hash);
    selectTab(TABS[j].id, { focus: true });
  });
  window.addEventListener('hashchange', () => selectTab(activeTab()));
  selectTab(activeTab());
}

/* ---------- Formulář ---------- */

function parseInt0(raw) {
  const s = String(raw ?? '').replace(/\s/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isInteger(n) ? n : NaN;
}

function radioGroup(name, legend, options, current, onChange, help) {
  const inline = options.length === 2;
  return h('fieldset', { class: 'field' },
    h('legend', { class: 'field-legend', text: legend }),
    help ? h('p', { class: 'help', text: help }) : null,
    h('div', { class: inline ? 'options inline' : 'options' }, options.map((opt) =>
      h('label', { class: 'option' },
        h('input', {
          type: 'radio', name, value: opt.id, checked: opt.id === current,
          onchange: () => onChange(opt.id),
        }),
        h('span', { text: opt.label })))));
}

function numberField(id, label, value, help, onInput, unit = rules.meta.currency) {
  const input = h('input', {
    id, type: 'text', inputmode: 'numeric', autocomplete: 'off',
    value: value ?? '', 'aria-describedby': help ? `${id}-help` : null,
  });
  input.addEventListener('input', () => onInput(input.value));
  return h('div', { class: 'field number' },
    h('label', { for: id, class: 'block field-legend', text: label }),
    help ? h('p', { class: 'help block', id: `${id}-help`, text: help }) : null,
    input,
    unit ? h('span', { class: 'unit', text: unit }) : null);
}

function renderPanel() {
  const panel = $('panel-osvc');
  const yesNo = [{ id: 'yes', label: tx.yes }, { id: 'no', label: tx.no }];
  const error = h('p', { class: 'error', id: 'osvc-error', role: 'alert' });
  const actualRow = numberField('osvc-actual', tx.fieldActual, state.actualExpenses, null, (v) => {
    state.actualExpenses = parseInt0(v);
    update();
  });
  actualRow.hidden = state.expenseMode !== 'actual';

  const form = h('form', {
    class: 'osvc-form', novalidate: true,
    onsubmit: (e) => { e.preventDefault(); update({ submitted: true }); },
  },
  numberField('osvc-income', fill(tx.fieldIncome, vars), state.income, tx.fieldIncomeHelp, (v) => {
    state.income = parseInt0(v);
    update();
  }),
  radioGroup('osvc-flat', tx.fieldFlatRate,
    o.expenseFlatRates.map((f) => ({ id: f.id, label: f.label })), state.flatRateId,
    (id) => { state.flatRateId = id; update(); }, tx.fieldFlatRateHelp),
  radioGroup('osvc-exp', tx.fieldExpenses,
    [{ id: 'flat', label: tx.optExpensesFlat }, { id: 'actual', label: tx.optExpensesActual }], state.expenseMode,
    (id) => { state.expenseMode = id; actualRow.hidden = id !== 'actual'; update(); }),
  actualRow,
  radioGroup('osvc-vat', tx.fieldVat, yesNo, state.vatPayer ? 'yes' : 'no',
    (id) => { state.vatPayer = id === 'yes'; update(); }),
  numberField('osvc-children', tx.fieldChildren, String(state.children), tx.fieldChildrenHelp, (v) => {
    const n = parseInt0(v);
    state.children = n === null ? 0 : n;
    update();
  }, null),
  radioGroup('osvc-activity', tx.fieldActivity,
    o.activities.map((a) => ({ id: a.id, label: a.label })), state.activityId,
    (id) => { state.activityId = id; update(); }),
  radioGroup('osvc-contact', tx.fieldContact, yesNo, state.contactPayments ? 'yes' : 'no',
    (id) => { state.contactPayments = id === 'yes'; update(); }, fill(tx.fieldContactHelp, vars)),
  error,
  h('div', { class: 'nav' }, h('button', { class: 'btn primary', type: 'submit' }, tx.calculate)));

  put(panel,
    h('h1', { text: tx.title }),
    h('p', { class: 'lead', text: fill(tx.intro, vars) }),
    h('p', { class: 'privacy', text: tx.panelPrivacy }),
    form,
    h('section', { id: 'osvc-result', 'aria-live': 'polite' }),
    h('section', { id: 'osvc-chart', class: 'card', hidden: true }),
    renderDeadlines(),
    renderPanelFooter(),
  );
}

/** Ověří vstup. Vrací { input } nebo { error, field }. */
function readInput() {
  const minIncome = o.chart.min > 0 ? 1 : 0;
  if (!Number.isInteger(state.income) || state.income < minIncome) {
    return { error: fill(tx.validationIncome, { min: minIncome }), field: 'osvc-income' };
  }
  if (state.expenseMode === 'actual' && (!Number.isInteger(state.actualExpenses) || state.actualExpenses < 0)) {
    return { error: tx.validationActual, field: 'osvc-actual' };
  }
  if (!Number.isInteger(state.children) || state.children < 0) {
    return { error: tx.validationChildren, field: 'osvc-children' };
  }
  return {
    input: {
      income: state.income,
      flatRateId: state.flatRateId,
      actualExpenses: state.expenseMode === 'actual' ? state.actualExpenses : null,
      vatPayer: state.vatPayer,
      children: state.children,
      activityId: state.activityId,
      contactPayments: state.contactPayments,
    },
  };
}

let lastResult = null;

function update({ submitted = false } = {}) {
  const error = $('osvc-error');
  const r = readInput();
  if (r.error) {
    if (submitted) {
      error.textContent = r.error;
      $(r.field)?.focus();
    }
    if (!lastResult) put($('osvc-result'), h('p', { class: 'help', text: tx.emptyResult }));
    return;
  }
  error.textContent = '';
  const result = compare(r.input, rules);
  lastResult = { input: r.input, result };
  renderResult(result, r.input);
  renderChart(r.input);
  renderFirstPayment(result);
  if (submitted) $('osvc-result').querySelector('h2')?.focus({ preventScroll: false });
}

/* ---------- Výsledek ---------- */

function renderResult(result, input) {
  const el = $('osvc-result');
  const fr = byId(o.expenseFlatRates, input.flatRateId);
  const rows = result.variants.map((v) => {
    const cheapest = v.id === result.cheapestId;
    const name = h('th', { scope: 'row' },
      h('span', { text: v.name }),
      cheapest ? h('span', { class: 'badge', text: tx.cheapestBadge }) : null);
    if (!v.available) {
      return h('tr', { class: 'unavailable' }, name,
        h('td', { colspan: '3', 'data-label': tx.unavailable },
          h('strong', { text: `${tx.unavailable}: ` }), v.reason ?? ''));
    }
    return h('tr', { class: cheapest ? 'cheapest' : null }, name,
      h('td', { 'data-label': tx.colAnnual, class: 'num' }, h('strong', { text: k(v.annual) })),
      h('td', { 'data-label': tx.colMonthly, class: 'num', text: k(v.monthly) }),
      h('td', { 'data-label': tx.colDiff, class: 'num', text: v.diff === 0 ? '—' : `+${k(v.diff)}` }));
  });

  put(el,
    h('h2', { text: tx.resultTitle, tabindex: '-1' }),
    h('p', { class: 'summary', text: result.summary }),
    h('table', { class: 'variants' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col', text: tx.colVariant }),
        h('th', { scope: 'col', class: 'num', text: tx.colAnnual }),
        h('th', { scope: 'col', class: 'num', text: tx.colMonthly }),
        h('th', { scope: 'col', class: 'num', text: tx.colDiff }))),
      h('tbody', {}, rows)),
    result.variants[0].available || result.variants[0].code === 'overMax'
      ? h('div', { class: 'bands' },
        h('h3', { text: tx.bandsTitle }),
        h('ul', {}, result.bands.map((b) => h('li', {
          text: b.eligible
            ? fill(tx.bandOk, { band: b.band.label, limit: k(b.limit), monthly: k(b.band.monthly) })
            : fill(tx.bandNo, { band: b.band.label, flat: fr.label, limit: k(b.limit) }),
        }))))
      : null,
    result.notes.map((n) => h('p', { class: 'note', text: n })),
    h('details', { class: 'breakdown' },
      h('summary', { text: tx.breakdownTitle }),
      h('ul', {}, result.breakdown.map((line) => h('li', { text: line }))),
      sourceLink({ url: o.incomeTax.source, title: o.incomeTax.sourceTitle }, rules.ui.sourceLabel),
      sourceLink({ url: o.social.source, title: o.social.sourceTitle }, rules.ui.sourceLabel),
      sourceLink({ url: o.health.source, title: o.health.sourceTitle }, rules.ui.sourceLabel),
      sourceLink({ url: o.flatTax.conditionsSource, title: o.flatTax.conditionsSourceTitle }, rules.ui.sourceLabel)),
  );
}

/* ---------- Graf ---------- */

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG, tag);
  for (const [key, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(key, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

const compact = new Intl.NumberFormat('cs-CZ', { notation: 'compact', maximumFractionDigits: 1 });

const SERIES = [
  { key: 'classic', cls: 'series-1', label: () => tx.chartLegendClassic },
  { key: 'flat', cls: 'series-2', label: () => tx.chartLegendFlat },
  { key: 'eetOff', cls: 'series-3', label: () => tx.chartLegendEetOff },
];

function niceStep(maxY) {
  const ch = o.chart;
  return ch.yTickSteps.find((st) => maxY / st <= ch.yTickTarget) ?? ch.yTickSteps.at(-1);
}

function linePath(pts, key, x, y) {
  let d = '';
  let pen = false;
  for (const p of pts) {
    if (p[key] === null) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(p.income).toFixed(1)},${y(p[key]).toFixed(1)}`;
    pen = true;
  }
  return d;
}

function renderChart(input) {
  const section = $('osvc-chart');
  section.hidden = false;
  const chartInput = { ...input, actualExpenses: null };
  const pts = series(chartInput, rules, chartIncomes(chartInput, rules));
  const be = breakEven(chartInput, rules);
  const fr = byId(o.expenseFlatRates, input.flatRateId);
  const activity = byId(o.activities, input.activityId);
  const rate = formatPercent(fr.rate);
  const present = SERIES.filter((sr) => pts.some((p) => p[sr.key] !== null));

  const plot = h('div', { class: 'chart-plot' });
  const tooltip = h('div', { class: 'chart-tooltip', hidden: true, role: 'status' });
  plot.append(tooltip);

  const beText = be.length
    ? be.map((b) => fill(tx.chartBreakEven, {
      income: k(b.income),
      cheaper: b.cheaper === 'flat' ? tx.cheaperFlat : tx.cheaperClassic,
    })).join(' ')
    : tx.chartBreakEvenNone;

  const step = o.chart.tableStep;
  const tableRows = pts.filter((p) => p.income % step === 0);

  put(section,
    h('h2', { id: 'osvc-chart-title', text: tx.chartTitle }),
    h('p', { class: 'help', id: 'osvc-chart-desc', text: fill(tx.chartDesc, { ...vars, rate, children: input.children, activity: activity.label.toLowerCase() }) }),
    h('ul', { class: 'legend' }, SERIES.map((sr) => h('li', {},
      h('span', { class: `swatch ${sr.cls}`, 'aria-hidden': 'true' }),
      present.includes(sr) ? sr.label() : `${sr.label()} (${tx.chartUnavailable})`))),
    plot,
    h('p', { class: 'breakeven', text: beText }),
    input.actualExpenses !== null ? h('p', { class: 'note', text: fill(tx.noteActualChart, { rate }) }) : null,
    h('p', { class: 'help', text: tx.chartHelp }),
    h('details', { class: 'chart-table' },
      h('summary', { text: tx.chartTableSummary }),
      h('div', { class: 'table-scroll' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {},
            h('th', { scope: 'col', text: tx.colIncome }),
            SERIES.map((sr) => h('th', { scope: 'col', class: 'num', text: sr.label() })))),
          h('tbody', {}, tableRows.map((p) => h('tr', {},
            h('th', { scope: 'row', class: 'num', text: k(p.income) }),
            SERIES.map((sr) => h('td', { class: 'num', text: p[sr.key] === null ? '—' : k(p[sr.key]) })))))))),
  );

  const draw = () => drawSvg(plot, tooltip, pts, be, input, present);
  draw();
  resizeObserver?.disconnect();
  let lastWidth = plot.clientWidth;
  resizeObserver = new ResizeObserver(() => {
    if (plot.clientWidth !== lastWidth) { lastWidth = plot.clientWidth; draw(); }
  });
  resizeObserver.observe(plot);
}

function drawSvg(plot, tooltip, pts, be, input, present) {
  const L = o.chart.layout;
  const ch = o.chart;
  plot.querySelector('svg')?.remove();
  const width = Math.max(plot.clientWidth, L.minWidth);
  const height = width < L.narrowWidth ? L.heightNarrow : L.height;
  const left = L.marginLeft;
  const narrow = width < L.narrowWidth;
  const right = width - (narrow ? L.marginRightNarrow : L.marginRight);
  const top = L.marginTop;
  const bottom = height - L.marginBottom;

  const maxVal = Math.max(...pts.flatMap((p) => present.map((sr) => p[sr.key] ?? 0)));
  const yStep = niceStep(maxVal);
  const yMax = Math.ceil(maxVal / yStep) * yStep;
  const x = (v) => left + ((v - ch.min) / (ch.max - ch.min)) * (right - left);
  const y = (v) => bottom - (v / yMax) * (bottom - top);

  const svg = s('svg', {
    width, height, viewBox: `0 0 ${width} ${height}`, role: 'img',
    'aria-labelledby': 'osvc-chart-title osvc-chart-desc', class: 'chart',
  });

  // Mřížka a osa Y
  for (let v = 0; v <= yMax; v += yStep) {
    svg.append(s('line', { x1: left, x2: right, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
    svg.append(s('text', { x: left - L.tickLength, y: y(v), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' },
      compact.format(v)));
  }
  // Osa X
  const xTicks = [ch.min];
  for (let v = ch.tickStep; v <= ch.max; v += ch.tickStep) xTicks.push(v);
  let lastLabelX = -Infinity;
  for (const v of [...xTicks].reverse()) {
    svg.append(s('line', { x1: x(v), x2: x(v), y1: bottom, y2: bottom + L.tickLength, class: 'axis' }));
    if (Math.abs(lastLabelX - x(v)) < L.minTickSpacing) continue;
    lastLabelX = x(v);
    const anchor = v === ch.max && narrow ? 'end' : 'middle';
    svg.append(s('text', { x: x(v), y: bottom + L.tickLength * 2, class: 'tick', 'text-anchor': anchor, 'dominant-baseline': 'hanging' },
      compact.format(v)));
  }

  // Ty (zadané příjmy)
  if (input.income >= ch.min && input.income <= ch.max) {
    svg.append(s('line', { x1: x(input.income), x2: x(input.income), y1: top, y2: bottom, class: 'you' }));
    svg.append(s('text', { x: x(input.income), y: top - L.tickLength, class: 'tick you-label', 'text-anchor': 'middle' }, tx.chartYou));
  }

  // Čáry
  for (const sr of present) {
    svg.append(s('path', { d: linePath(pts, sr.key, x, y), class: `line ${sr.cls}` }));
  }

  // Body zlomu
  for (const b of be) {
    svg.append(s('circle', { cx: x(b.income), cy: y(b.classic), r: L.markerRadius, class: 'breakeven-dot' }));
  }

  // Přímé popisky na konci čar (s posunem, aby se nepřekrývaly)
  // Na úzkém displeji jsou popisky nad koncem čáry (zarovnané doprava), jinak vpravo od ní.
  const labels = present.map((sr) => {
    const last = [...pts].reverse().find((p) => p[sr.key] !== null);
    return { sr, x: x(last.income), y: y(last[sr.key]) - (narrow ? L.labelLift : 0) };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) {
    if (labels[i].y - labels[i - 1].y < L.labelGap) labels[i].y = labels[i - 1].y + L.labelGap;
  }
  for (const lb of labels) {
    svg.append(s('text', {
      x: narrow ? lb.x : lb.x + L.tickLength, y: lb.y, class: 'direct-label',
      'text-anchor': narrow ? 'end' : 'start', 'dominant-baseline': narrow ? 'auto' : 'middle',
    }, lb.sr.label()));
  }

  // Hover / klávesnice: zaměřovač a tooltip
  const cross = s('line', { y1: top, y2: bottom, class: 'crosshair', visibility: 'hidden' });
  const dots = present.map((sr) => s('circle', { r: L.markerRadius, class: `hover-dot ${sr.cls}`, visibility: 'hidden' }));
  svg.append(cross, ...dots);
  const overlay = s('rect', {
    x: left, y: top, width: right - left, height: bottom - top, class: 'overlay', tabindex: 0,
    'aria-label': tx.chartHelp,
  });
  svg.append(overlay);

  let idx = -1;
  const show = (i) => {
    idx = Math.max(0, Math.min(pts.length - 1, i));
    const p = pts[idx];
    const px = x(p.income);
    cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
    present.forEach((sr, j) => {
      if (p[sr.key] === null) { dots[j].setAttribute('visibility', 'hidden'); return; }
      dots[j].setAttribute('cx', px); dots[j].setAttribute('cy', y(p[sr.key])); dots[j].setAttribute('visibility', 'visible');
    });
    put(tooltip,
      h('p', { class: 'tt-head', text: fill(tx.chartTooltipIncome, { income: k(p.income) }) }),
      present.map((sr) => h('p', { class: 'tt-row' },
        h('span', { class: `swatch ${sr.cls}`, 'aria-hidden': 'true' }),
        h('strong', { text: p[sr.key] === null ? '—' : k(p[sr.key]) }),
        ` ${sr.label()}`)));
    tooltip.hidden = false;
    const tw = tooltip.offsetWidth;
    const flip = px + L.tooltipOffset + tw > width;
    const want = flip ? px - L.tooltipOffset - tw : px + L.tooltipOffset;
    tooltip.style.left = `${Math.max(0, Math.min(width - tw, want))}px`;
    tooltip.style.top = `${top}px`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tooltip.hidden = true;
  };
  const nearest = (clientX) => {
    const rect = svg.getBoundingClientRect();
    const v = ch.min + ((clientX - rect.left - left) / (right - left)) * (ch.max - ch.min);
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].income - v) < Math.abs(pts[best].income - v)) best = i;
    return best;
  };
  overlay.addEventListener('pointermove', (e) => show(nearest(e.clientX)));
  overlay.addEventListener('pointerdown', (e) => show(nearest(e.clientX)));
  overlay.addEventListener('pointerleave', hide);
  overlay.addEventListener('blur', hide);
  overlay.addEventListener('focus', () => show(nearest(svg.getBoundingClientRect().left + x(input.income))));
  overlay.addEventListener('keydown', (e) => {
    const jump = Math.max(1, Math.round(pts.length / (ch.max / ch.tableStep)));
    if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + jump); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx - jump); }
    if (e.key === 'Escape') hide();
  });

  plot.prepend(svg);
}

/* ---------- Termíny, odkazy, patička ---------- */

function renderDeadlines() {
  return h('section', { class: 'card', id: 'osvc-deadlines' },
    h('h2', { text: tx.deadlinesTitle }),
    h('ol', { class: 'todo' }, o.deadlines.map((d) => h('li', {},
      h('p', { class: 'todo-title', text: d.title }),
      h('p', { class: 'deadline hard' }, h('strong', { text: `${rules.ui.deadlineHard}: ` }), formatDate(d.date)),
      h('p', { text: fill(d.text, { date: formatDate(d.date) }) }),
      d.id === 'firstPayment' ? h('p', { id: 'osvc-first-payment', class: 'help' }) : null,
      sourceLink({ url: d.source, title: d.sourceTitle }, rules.ui.sourceLabel)))),
    h('h3', { text: tx.linksTitle }),
    h('ul', { class: 'links' }, o.links.map((l) => h('li', {},
      h('a', { href: l.source, target: '_blank', rel: 'noopener noreferrer', text: l.title })))));
}

function renderFirstPayment(result) {
  const el = $('osvc-first-payment');
  if (!el) return;
  const flat = result.variants.find((v) => v.id === 'flat');
  const off = result.variants.find((v) => v.id === 'eetOff');
  const amount = [flat, off].filter((v) => v.available).map((v) => `${k(v.monthly)} (${v.name})`).join(', ');
  el.textContent = amount ? fill(tx.firstPaymentAmount, { amount }) : '';
}

function statusLabel(status) {
  return { official: tx.statusOfficial, secondary: tx.statusSecondary, derived: tx.statusDerived }[status] ?? status;
}

function renderPanelFooter() {
  const p = params(rules);
  const t = o.incomeTax;
  const items = [
    { text: fill(tx.statusItemAverageWage, { value: k(o.averageWage.monthly) }), item: o.averageWage },
    { text: fill(tx.statusItemSocial, { main: k(p.socialMinAdvanceMain), side: k(p.socialMinAdvanceSide), threshold: k(p.sideThreshold) }), item: o.social },
    { text: fill(tx.statusItemHealth, { main: k(p.healthMinAdvance) }), item: o.health },
    { text: fill(tx.statusItemTax, { credit: k(t.taxpayerCredit), children: t.childCredits.map(k).join(' / '), threshold: k(p.highRateThreshold) }), item: t },
    ...o.flatTax.bands.map((b) => ({ text: fill(tx.statusItemBand, { band: b.label, monthly: k(b.monthly) }), item: b })),
  ];
  return h('section', { class: 'panel-footer' },
    h('p', { class: 'disclaimer', text: tx.disclaimer }),
    h('p', {}, `${tx.verifiedLabel}: `, h('strong', { text: formatDate(rules.meta.lastVerified) })),
    h('details', {},
      h('summary', { text: tx.statusLabel }),
      h('p', { class: 'help', text: o.verificationNote }),
      h('ul', { class: 'status-list' }, items.map(({ text, item }) => h('li', {},
        h('span', { text: `${text} – ${statusLabel(item.status)}. ` }),
        item.note ? h('span', { class: 'help', text: `${item.note} ` }) : null,
        sourceLink({ url: item.source, title: item.sourceTitle }, rules.ui.sourceLabel))))));
}

/* ---------- Start ---------- */

async function init() {
  try {
    const res = await fetch('rules.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    rules = await res.json();
  } catch {
    return; // Chybovou hlášku zobrazí app.js.
  }
  o = rules.osvc2027;
  tx = o.texts;
  vars = osvcVars(rules);
  state.flatRateId = o.expenseFlatRates[1].id;
  state.activityId = o.activities[0].id;
  setupTabs();
  renderPanel();
  update();
}

init();
