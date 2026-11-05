// Sdílené pomocníky pro tvorbu DOM (obě záložky). Text se vkládá vždy přes textContent.

/** Malý pomocník pro tvorbu prvků. Text vždy přes textContent. */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

/** Vymění obsah prvku; pole zploští a vynechá prázdné položky. */
export function put(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}

export function sourceLink(source, label) {
  return h('a', { class: 'source', href: source.url, target: '_blank', rel: 'noopener noreferrer' },
    `${label}: ${source.title}`);
}
