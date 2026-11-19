// Shared UI helpers: config pills, results screen, formatting.

export const $ = (sel, root = document) => root.querySelector(sel);
export const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmtMs = (ms) => (ms == null || !isFinite(ms) ? '–' : ms >= 10000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`);
export const fmtSec = (ms) => (ms == null || !isFinite(ms) ? '–' : `${(ms / 1000).toFixed(2)}s`);
export const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const median = (xs) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

/**
 * Render a Monkeytype-style config bar.
 * groups: [{key, options:[{value,label,title?}], value, multi?}] ; onChange(key, value)
 */
export function renderConfig(container, groups, onChange) {
  container.innerHTML = '';
  groups.forEach((g, gi) => {
    if (gi) container.append(h('<span class="cfg-sep" aria-hidden="true"></span>'));
    const group = h(`<div class="cfg-group" role="group" aria-label="${escapeHtml(g.key)}"></div>`);
    if (g.label) group.append(h(`<span class="cfg-label">${escapeHtml(g.label)}</span>`));
    for (const o of g.options) {
      const active = g.multi ? g.value.includes(o.value) : g.value === o.value;
      const btn = h(
        `<button class="pill${active ? ' active' : ''}" type="button" title="${escapeHtml(o.title || '')}">${escapeHtml(o.label)}</button>`,
      );
      btn.addEventListener('click', (e) => {
        e.currentTarget.blur();
        if (g.multi) {
          const set = new Set(g.value);
          if (set.has(o.value)) set.delete(o.value);
          else set.add(o.value);
          if (set.size === 0) return;
          onChange(g.key, [...set]);
        } else onChange(g.key, o.value);
      });
      group.append(btn);
    }
    container.append(group);
  });
}

/**
 * Results screen.
 * opts: {headline:[{label,value,sub}], stats:[{label,value}], sections:[{title, html}], pb, onAgain}
 */
export function renderResults(container, { headline, stats, sections = [], pb, onAgain }) {
  const head = headline
    .map(
      (x) => `<div class="res-big"><div class="res-label">${escapeHtml(x.label)}</div><div class="res-value">${escapeHtml(x.value)}</div>${x.sub ? `<div class="res-sub">${escapeHtml(x.sub)}</div>` : ''}</div>`,
    )
    .join('');
  const st = stats
    .map((x) => `<div class="res-stat"><div class="res-label">${escapeHtml(x.label)}</div><div class="res-stat-value">${escapeHtml(x.value)}</div></div>`)
    .join('');
  const secs = sections
    .filter((s) => s.html)
    .map((s) => `<section class="res-section"><h3>${escapeHtml(s.title)}</h3>${s.html}</section>`)
    .join('');
  container.innerHTML = `
    <div class="results">
      ${pb ? `<div class="pb-badge">${escapeHtml(pb)}</div>` : ''}
      <div class="res-head">${head}</div>
      <div class="res-stats">${st}</div>
      ${secs}
      <div class="res-actions"><button class="btn primary" type="button" data-again>next test</button>
      <span class="hint"><kbd>tab</kbd> restart</span></div>
    </div>`;
  container.querySelector('[data-again]').addEventListener('click', onAgain);
}

/** Simple table html. rows: [[...cells]] */
export function tableHtml(headers, rows) {
  if (!rows.length) return '';
  return `<table class="res-table"><thead><tr>${headers.map((x) => `<th>${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`;
}

/** Colour scale for reaction times relative to the session median. */
export function speedClass(ms, med) {
  if (!isFinite(med)) return '';
  if (ms <= med * 0.8) return 'fast';
  if (ms >= med * 1.35) return 'slow';
  return '';
}
