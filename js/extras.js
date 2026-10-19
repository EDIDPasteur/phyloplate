/* Auxiliary views and shared helpers used by the main app: source XML view,
 * audit panel of priors/operators, search/highlight, and model comparison.
 * Each is a small class or factory that the app.js orchestrator calls into. */

/* The one HTML escaper shared by every view.  Escapes quotes as well so the
 * output is safe in both text and attribute context. */
export const esc = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Elide the middle of a long nucleotide value= attribute.  Returns the
 * shortened line, or null when the line is short enough / not a
 * sequence line.  First and last ~40 chars of the run survive so the
 * user can see the sequence starts and how it ends. */
function elideSeqLine(ln) {
  if (ln.length <= 240) return null;
  const m = /(\svalue=")([^"]{100,})(")/.exec(ln);
  if (!m || !/^[acgtnrykmswbdhv?*.\-]+$/i.test(m[2])) return null;
  const run = m[2];
  return ln.slice(0, m.index + m[1].length) +
    run.slice(0, 40) + ' … [' + run.length + ' chars] … ' +
    run.slice(-20) + ln.slice(m.index + m[1].length + run.length);
}

// ---------------------------------------------------------------- source view

/* Renders the parsed XML as a line-numbered, syntax-highlighted pane.  Each
 * line is interactive: hovering a node in the diagram dims everything but its
 * source span, and clicking a node jumps to and highlights its span here.
 *
 * When the model includes `lineTargets` (a list of every prior,
 * operator, <mcmc>, <log>, and <logTree> with its source range),
 * SourceView fires an `onLineTarget(target)` callback when the user
 * clicks a line that maps to one of those elements.  app.js uses
 * this to jump the McmcEditor sidebar in lockstep with the XML. */
export class SourceView {
  constructor(el) {
    this.el = el;
    /* When the source pane hosts a sidebar (the MCMC editor), the
     * SourceView renders into a dedicated child element so the
     * sidebar is preserved across re-renders. */
    this.bodyEl = el.querySelector('.source-body') || el;
    this.lines = [];
    this.activeId = null;
    this.hoverId = null;
    /* Parser-side: { ranges, byLine } map of click targets.  The
     * SourceView tags the matching line with .src-target so the
     * user can see which lines are clickable. */
    this.lineTargets = null;
    this.onLineTarget = () => {};
    /* Sequence runs: maximal blocks of nucleotide-only lines are
     * rendered as a single collapsed row (a 200-taxon alignment is
     * otherwise tens of thousands of styled DOM rows).  Runs expand
     * on click and auto-expand when a highlight lands inside them. */
    this.seqRuns = [];
    this.expandedRuns = new Set();
  }
  setSource(text) {
    this.lines = text.split('\n');
    /* ponytail: nucleotide-alphabet heuristic — amino-acid or
     * codon-notation data will not match and simply renders
     * verbosely as before; widen the alphabet when needed. */
    const seqRe = /^\s*[acgtnrykmswbdhv?*.\-]+\s*$/i;
    this.seqRuns = [];
    let i = 0;
    while (i < this.lines.length) {
      if (seqRe.test(this.lines[i])) {
        let j = i + 1;
        while (j < this.lines.length && seqRe.test(this.lines[j])) j++;
        if (j - i >= 2) this.seqRuns.push({ start: i, end: j - 1 });
        i = j;
      } else i++;
    }
    /* BEAST2 puts each sequence on ONE line: <sequence spec="Sequence"
     * ... value="NNNN…"/>.  A single such line is a run of one. */
    const attrSeqRe = /\svalue="[^"]*[acgtn\-?][^"]{24,}"/i;
    for (let i = 0; i < this.lines.length; i++)
      if (attrSeqRe.test(this.lines[i]))
        this.seqRuns.push({ start: i, end: i });
    this.expandedRuns = new Set();
    this.render();
  }
  setLineTargets(lineTargets) {
    this.lineTargets = lineTargets;
    this.render();
  }
  render() {
    const head = `<div class="src-head">
      <span class="src-label">Click any line to jump to its element.  Priors, operators, and chain settings also jump to the edit panel on the right.  Sequence data is collapsed; click a block to expand.</span>
      <span class="src-current" id="src-current"></span>
    </div>`;
    const targetLines = this.lineTargets
      ? new Set(this.lineTargets.ranges.map(r => r.startLine))
      : new Set();
    const runAt = new Map(this.seqRuns.map(r => [r.start, r]));
    const body = [];
    for (let i = 0; i < this.lines.length; i++) {
      const run = runAt.get(i);
      if (run && !this.expandedRuns.has(run.start)) {
        const n = run.end - run.start + 1;
        /* A single value= line already renders elided (below); show
         * the elided form directly, no click-to-expand round trip. */
        if (n === 1) {
          const elided = elideSeqLine(this.lines[i]) || this.lines[i];
          body.push(`<div class="src-line" data-line="${i + 1}">
            <span class="ln">${i + 1}</span><span class="code">${esc(elided)}</span>
          </div>`);
          continue;
        }
        body.push(`<div class="src-line src-collapse" data-line="${i + 1}">
          <span class="ln">${i + 1}</span>
          <span class="code">&nbsp;&nbsp;⋮&nbsp;&nbsp;${n} lines of sequence data&nbsp;&nbsp;(click to expand)</span>
        </div>`);
        i = run.end;
        continue;
      }
      const ln = this.lines[i];
      const lineNo = i + 1;
      /* Expanded sequence lines keep the giant value= span elided —
       * a 186k-char row is what the user was scrolling past. */
      const elided = elideSeqLine(ln);
      if (elided) {
        body.push(`<div class="src-line" data-line="${lineNo}">
          <span class="ln">${lineNo}</span><span class="code">${esc(elided)}</span>
        </div>`);
        continue;
      }
      const code = esc(ln).replace(/^(\s*&lt;!--.*?--&gt;)/,
        '<span class="com">$1</span>');
      const tagStyled = code.replace(
        /(&lt;\/?)([a-zA-Z][\w:-]*)/g,
        '$1<span class="tag">$2</span>');
      const finalStyled = tagStyled.replace(
        /\s([a-zA-Z\-:]+)=&quot;([^&]*)&quot;/g,
        ' <span class="attr">$1</span>=<span class="str">"$2"</span>');
      const target = targetLines.has(lineNo) ? ' src-target' : '';
      body.push(`<div class="src-line${target}" data-line="${lineNo}">
        <span class="ln">${lineNo}</span><span class="code">${finalStyled || '&nbsp;'}</span>
      </div>`);
    }
    this.bodyEl.innerHTML = head + `<div class="src-body">${body.join('')}</div>`;
    /* Wire click handlers.  We delegate so a re-render doesn't
     * leak listeners; the body is fully replaced by the line above. */
    const sb = this.bodyEl.querySelector('.src-body');
    if (sb) {
      sb.addEventListener('click', e => {
        const ln = e.target.closest('.src-line');
        if (!ln) return;
        const line = +ln.dataset.line;
        if (ln.classList.contains('src-collapse')) {
          this.expandedRuns.add(line - 1);
          this.render();
          return;
        }
        if (!this.lineTargets) return;
        const t = this.lineTargets.byLine.get(line);
        if (t) this.onLineTarget(t);
      });
    }
  }
  /* nodeRange: { line, endLine } from parser */
  highlightId(node, opts = {}) {
    const { line, endLine } = node;
    if (!line) return;
    /* A highlight landing inside a collapsed sequence run (e.g. the
     * <alignment> node) expands it first. */
    if (this.seqRuns.some(r =>
      !this.expandedRuns.has(r.start) &&
      line <= r.end + 1 && (endLine || line) >= r.start + 1)) {
      for (const r of this.seqRuns)
        if (line <= r.end + 1 && (endLine || line) >= r.start + 1)
          this.expandedRuns.add(r.start);
      this.render();
    }
    this.el.querySelectorAll('.src-line').forEach(el => {
      const ln = +el.dataset.line;
      el.classList.toggle('hi', ln >= line && ln <= (endLine || line));
      el.classList.toggle('dim', opts.dimOthers &&
        !(ln >= line && ln <= (endLine || line)));
    });
    const cur = this.el.querySelector('#src-current');
    if (cur) cur.textContent = node.id;
    if (opts.scroll) {
      const first = this.el.querySelector(`.src-line[data-line="${line}"]`);
      if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }
  /* Highlight a line target (e.g. an operator that the user just
   * clicked in the MCMC sidebar).  Used by app.js to draw a brief
   * flash so the user can see which XML block the sidebar row
   * refers to. */
  flashLineTarget(target) {
    if (!target) return;
    const sb = this.bodyEl.querySelector('.src-body');
    if (!sb) return;
    const first = sb.querySelector(`.src-line[data-line="${target.startLine}"]`);
    if (!first) return;
    const all = sb.querySelectorAll('.src-line');
    all.forEach(el => el.classList.remove('flash'));
    first.classList.add('flash');
    first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  clearHighlight() {
    this.el.querySelectorAll('.src-line').forEach(el => {
      el.classList.remove('hi', 'dim', 'flash');
    });
    const cur = this.el.querySelector('#src-current');
    if (cur) cur.textContent = '';
  }
}

// ---------------------------------------------------------------- audit panel

/* Renders the priors and operators in two compact tables, one row per
 * element.  Each row is clickable: clicking it jumps to the node's source
 * line and highlights the source pane. */
export function renderAudit(model) {
  const el = document.getElementById('audit');
  if (!el) return;
  const rows = [];
  // priors
  rows.push(`<div>
    <h3>Priors <span class="audit-count">${model.stats.priors || 0}</span></h3>
    ${priorsTable(model)}
  </div>`);
  // operators
  rows.push(`<div>
    <h3>Operators <span class="audit-count">${model.stats.operators || 0}</span></h3>
    ${operatorsTable(model)}
  </div>`);
  el.innerHTML = rows.join('');
}

function priorsTable(model) {
  const items = [];
  for (const n of model.nodes) {
    for (const p of (n.priors || [])) {
      const detail = Object.entries(p.attrs)
        .filter(([k]) => !['id', 'idref'].includes(k))
        .map(([k, v]) => `${k}=${v}`).join(', ');
      items.push({ id: n.id, label: n.label, tag: p.dist,
                   detail: `${p.label}${detail ? '(' + detail + ')' : ''}`,
                   line: n.xmlLine });
    }
  }
  if (!items.length) return `<div class="hint">No priors declared.</div>`;
  return `<table class="audit-table"><thead>
    <tr><th>Variable</th><th>Distribution</th></tr></thead>
    <tbody>${items.map(p => `
      <tr data-id="${esc(p.id)}" data-line="${p.line || ''}">
        <td class="audit-id">${esc(p.id)}</td>
        <td class="audit-detail">${esc(p.detail)}</td>
      </tr>`).join('')}</tbody></table>`;
}

function operatorsTable(model) {
  const items = [];
  for (const n of model.nodes) {
    for (const o of (n.operators || [])) {
      const weight = o.attrs.weight ? `w=${o.attrs.weight}` : '';
      const scale  = o.attrs.scaleFactor ? `×${o.attrs.scaleFactor}` : '';
      const size   = o.attrs.size || o.attrs.windowSize
                     ? `${o.attrs.size ? 'size=' + o.attrs.size : ''}` : '';
      items.push({ id: n.id, label: n.label, tag: o.tag,
                   detail: `<${esc(o.tag)}> ${[weight, scale, size].filter(Boolean).join(' ')}`.trim(),
                   line: n.xmlLine });
    }
  }
  if (!items.length) return `<div class="hint">No operators declared.</div>`;
  return `<table class="audit-table"><thead>
    <tr><th>Variable</th><th>Operator</th></tr></thead>
    <tbody>${items.map(p => `
      <tr data-id="${esc(p.id)}" data-line="${p.line || ''}">
        <td class="audit-id">${esc(p.id)}</td>
        <td class="audit-detail">${p.detail}</td>
      </tr>`).join('')}</tbody></table>`;
}

export function wireAuditClicks(model) {
  const el = document.getElementById('audit');
  if (!el) return;
  el.querySelectorAll('tr[data-id]').forEach(tr => {
    tr.onclick = () => {
      const id = tr.dataset.id;
      const n = model.nodes.find(x => x.id === id);
      if (!n) return;
      document.dispatchEvent(new CustomEvent('phyloplate:focus-node', {
        detail: { id, line: n.xmlLine, scrollSource: true }
      }));
    };
  });
}

// ---------------------------------------------------------------- search

/* Highlight matching nodes in the diagram and matching rows in the sidebar
 * (modules + audit).  Pressing Enter cycles through matches; Escape clears. */
export class Search {
  constructor(model, getDiagram) {
    this.model = model;
    this.getDiagram = getDiagram;
    this.matches = [];
    this.cursor = -1;
  }
  refresh() {
    const q = (document.getElementById('search').value || '').trim().toLowerCase();
    const diag = this.getDiagram();
    this.matches = !q ? [] : this.model.nodes.filter(n =>
      n.id.toLowerCase().includes(q) ||
      (n.tag || '').toLowerCase().includes(q) ||
      (n.label || '').toLowerCase().includes(q) ||
      (n.role || '').toLowerCase().includes(q));
    this.cursor = -1;
    this.updateCount();
    diag?.highlightMatches(this.matches);
    this.paintSidebar(q);
  }
  updateCount() {
    const c = document.getElementById('search-count');
    if (c) c.textContent = this.matches.length ? `${this.cursor + 1}/${this.matches.length}` : '';
  }
  paintSidebar(q) {
    const ids = new Set(this.matches.map(n => n.id));
    document.querySelectorAll('#audit tr[data-id]').forEach(tr => {
      tr.classList.toggle('match-hi', ids.has(tr.dataset.id));
    });
    document.querySelectorAll('.mod-item').forEach(li => {
      li.classList.remove('match-hi');
    });
  }
  next(dir = 1) {
    if (!this.matches.length) return;
    this.cursor = (this.cursor + dir + this.matches.length) % this.matches.length;
    this.updateCount();
    const n = this.matches[this.cursor];
    document.dispatchEvent(new CustomEvent('phyloplate:focus-node', {
      detail: { id: n.id, line: n.xmlLine, scrollSource: false }
    }));
  }
  clear() {
    document.getElementById('search').value = '';
    this.refresh();
  }
}

// ---------------------------------------------------------------- compare

/* Naive model diff: compare two parsed models node-by-node by id and edge-by-
 * edge by (source, target).  Used by the Compare tab; the UI is just a table
 * with three classes: added, removed, changed (different attributes). */
export function diffModels(a, b) {
  const aNodes = new Map(a.nodes.map(n => [n.id, n]));
  const bNodes = new Map(b.nodes.map(n => [n.id, n]));
  const added = [], removed = [], changed = [];
  for (const [id, n] of bNodes) {
    if (!aNodes.has(id)) added.push(n);
    else {
      const an = aNodes.get(id);
      const av = JSON.stringify(stableAttrs(an));
      const bv = JSON.stringify(stableAttrs(n));
      if (av !== bv) changed.push({ a: an, b: n });
    }
  }
  for (const [id, n] of aNodes) {
    if (!bNodes.has(id)) removed.push(n);
  }
  const aEdges = new Set(a.edges.map(e => `${e.source}>${e.target}`));
  const bEdges = new Set(b.edges.map(e => `${e.source}>${e.target}`));
  const addedE = [...bEdges].filter(e => !aEdges.has(e)).map(parseE);
  const removedE = [...aEdges].filter(e => !bEdges.has(e)).map(parseE);
  return { added, removed, changed, addedE, removedE,
           statsA: a.stats, statsB: b.stats,
           nameA: a.meta.fileName || 'A', nameB: b.meta.fileName || 'B' };
}

function stableAttrs(n) {
  const { value, dimension, priors, operators } = n;
  return { value, dimension,
           priors: (priors || []).map(p => `${p.dist}:${JSON.stringify(p.attrs)}`),
           operators: (operators || []).map(o => `${o.tag}:${JSON.stringify(o.attrs)}`) };
}
function parseE(s) {
  const i = s.indexOf('>');
  return { source: s.slice(0, i), target: s.slice(i + 1) };
}

export function renderDiff(diff, el) {
  const rowN = (n, cls) => `<tr class="${cls}">
    <td class="id">${esc(n.id)}</td>
    <td class="label">&lt;${esc(n.tag)}&gt;</td>
    <td>${esc(n.label || '')}</td>
  </tr>`;
  const rowE = (e, cls) => `<tr class="${cls}">
    <td class="id">${esc(e.source)}</td>
    <td colspan="2">→ ${esc(e.target)}</td>
  </tr>`;
  const rowC = (c) => `<tr class="changed">
    <td class="id">${esc(c.a.id)}</td>
    <td class="label">&lt;${esc(c.a.tag)}&gt;</td>
    <td><b>before:</b> ${esc(JSON.stringify(stableAttrs(c.a)).slice(0, 220))}<br>
        <b>after:</b> ${esc(JSON.stringify(stableAttrs(c.b)).slice(0, 220))}</td>
  </tr>`;
  el.innerHTML = `
    <h2>Summary</h2>
    <p>Comparing <b>${esc(diff.nameA)}</b> and <b>${esc(diff.nameB)}</b>.
       ${diff.added.length} added, ${diff.removed.length} removed,
       ${diff.changed.length} changed nodes;
       ${diff.addedE.length} added, ${diff.removedE.length} removed edges.</p>
    <h2>Nodes added in ${esc(diff.nameB)}</h2>
    ${diff.added.length ? `<table><thead><tr><th>id</th><th>tag</th><th>label</th></tr></thead>
      <tbody>${diff.added.map(n => rowN(n, 'added')).join('')}</tbody></table>` : '<p>None.</p>'}
    <h2>Nodes removed</h2>
    ${diff.removed.length ? `<table><thead><tr><th>id</th><th>tag</th><th>label</th></tr></thead>
      <tbody>${diff.removed.map(n => rowN(n, 'removed')).join('')}</tbody></table>` : '<p>None.</p>'}
    <h2>Nodes with changed attributes</h2>
    ${diff.changed.length ? `<table><thead><tr><th>id</th><th>tag</th><th>change</th></tr></thead>
      <tbody>${diff.changed.map(rowC).join('')}</tbody></table>` : '<p>None.</p>'}
    <h2>Edges added in ${esc(diff.nameB)}</h2>
    ${diff.addedE.length ? `<table><thead><tr><th>source</th><th colspan="2">target</th></tr></thead>
      <tbody>${diff.addedE.map(e => rowE(e, 'added')).join('')}</tbody></table>` : '<p>None.</p>'}
    <h2>Edges removed</h2>
    ${diff.removedE.length ? `<table><thead><tr><th>source</th><th colspan="2">target</th></tr></thead>
      <tbody>${diff.removedE.map(e => rowE(e, 'removed')).join('')}</tbody></table>` : '<p>None.</p>'}
  `;
}

/* Serialise the parsed model as a BayesianNetwork (.bif) file that bnlearn,
 * pgmpy, and similar libraries can read.  Each stochastic variable becomes a
 * node with a CPD table; the entries are written as the literal density name
 * since the actual conditional table is parameterised, not enumerated.  This
 * gives structure-only output for learners that want to fit parameters from
 * data, not a full probability table. */
export function exportBN(model) {
  const idOf = n => n.id.replace(/[^A-Za-z0-9_]/g, '_');
  const stochastic = model.nodes.filter(n => n.type === 'stochastic');
  const parentsOf = new Map(model.nodes.map(n => [n.id, []]));
  for (const e of model.edges) {
    if (parentsOf.has(e.target)) parentsOf.get(e.target).push(e.source);
  }
  const nameOf = n => n.label || n.id;
  const lines = [];
  lines.push('// Bayesian-network structure extracted from BEAST X XML');
  lines.push('// Each node carries a placeholder CPD — replace with a fitted table.');
  lines.push('');
  for (const n of stochastic) {
    const parents = (parentsOf.get(n.id) || [])
      .map(pid => model.nodes.find(x => x.id === pid))
      .filter(p => p && p.type === 'stochastic')
      .map(idOf);
    if (parents.length) {
      lines.push(`network ${nameOf(n).replace(/\s+/g, '_')} {`);
      for (const p of parents) lines.push(`    parent ${p};`);
      lines.push(`    // CPD placeholder; parameterise from data.`);
      lines.push('}');
    } else {
      lines.push(`network ${nameOf(n).replace(/\s+/g, '_')} { /* root */ }`);
    }
  }
  // Also a flat edge list in case the consumer wants it
  lines.push('');
  lines.push('// Edges (child <- parent):');
  for (const n of stochastic) {
    for (const pid of (parentsOf.get(n.id) || [])) {
      const p = model.nodes.find(x => x.id === pid);
      if (!p) continue;
      if (p.type === 'stochastic') {
        lines.push(`${nameOf(n)} <- ${nameOf(p)}`);
      }
    }
  }
  return lines.join('\n');
}
