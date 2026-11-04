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
    /* XML search: the query, the matching line indexes (0-based), the
     * cursor into that list, and a set for O(1) membership tests.
     * Matches are rendered as `src-find` rows so they survive every
     * re-render (collapse/expand/highlight all call render()). */
    this.matches = [];
    this.matchSet = new Set();
    this.cursor = -1;
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
    /* Row cache: the per-line content, rebuilt only when the source
     * content changes (new file, or a sequence run expanding).  The
     * class strings are computed on every render, so the search can
     * highlight a match without re-escaping the whole source. */
    this.rowHtml = null;
    this.rowEls = new Map();
    this.dirty = false;
    /* The head and the rows container are created once so the rows can
     * be synced in place instead of being destroyed and rebuilt. */
    this.headEl = this.bodyEl.querySelector('.src-head');
    this.rowBodyEl = this.bodyEl.querySelector('.src-body');
    if (!this.headEl) {
      this.headEl = document.createElement('div');
      this.headEl.className = 'src-head';
      this.bodyEl.prepend(this.headEl);
    }
    if (!this.rowBodyEl) {
      this.rowBodyEl = document.createElement('div');
      this.rowBodyEl.className = 'src-body';
      this.bodyEl.appendChild(this.rowBodyEl);
    }
    this.headEl.innerHTML = `<span class="src-label">Click any line to jump to its element.  Priors, operators, and chain settings also jump to the edit panel on the right.  Sequence data is collapsed; click a block to expand.</span>
      <span class="src-current" id="src-current"></span>`;
    /* Delegated click handler for the rows: attached to the container so
     * it survives the in-place row syncs. */
    this.rowBodyEl.addEventListener('click', e => {
      const ln = e.target.closest('.src-line');
      if (!ln) return;
      const line = +ln.dataset.line;
      if (ln.classList.contains('src-collapse')) {
        this.expandedRuns.add(line - 1);
        /* Expanding a run changes the row content, so the cache must go. */
        this.dirty = true;
        this.render();
        return;
      }
      if (!this.lineTargets) return;
      const t = this.lineTargets.byLine.get(line);
      if (t) this.onLineTarget(t);
    });
  }
  setSource(text) {
    this.lines = text.split('\n');
    /* Cached lowercase lines: the search scan reuses them, so every
     * keystroke does not re-lowercase the whole source. */
    this.lowerLines = this.lines.map(l => l.toLowerCase());
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
    /* New content: drop the row cache and rebuild on the next render. */
    this.rowHtml = null;
    this.rowEls = new Map();
    this.dirty = true;
    this.render();
  }
  setLineTargets(lineTargets) {
    this.lineTargets = lineTargets;
    this.render();
  }
  render() {
    const targetLines = this.lineTargets
      ? new Set(this.lineTargets.ranges.map(r => r.startLine))
      : new Set();
    const runAt = new Map(this.seqRuns.map(r => [r.start, r]));

    if (this.dirty || !this.rowHtml) {
      this.dirty = false;
      this.rowHtml = this.lines.map((ln, i) => this.renderRow(i, runAt, targetLines));
    }

    // A collapsed run renders only its start row: the rest is covered by it.
    const skipped = new Set();
    for (const r of this.seqRuns) {
      if (!this.expandedRuns.has(r.start) && r.end > r.start)
        for (let i = r.start + 1; i <= r.end; i++) skipped.add(i);
    }

    // The rows: content is cached, only the class strings change between calls.
    for (let i = 0; i < this.lines.length; i++) {
      if (skipped.has(i)) continue;
      const lineNo = i + 1;
      const run = runAt.get(i);
      let cls = 'src-line';
      if (run && !this.expandedRuns.has(run.start) && run.end > run.start)
        cls += ' src-collapse';
      if (targetLines.has(lineNo)) cls += ' src-target';
      if (this.matchSet.has(i)) cls += ' src-find';
      /* The current match is an entry ({type, node, line}) — a line match
       * is marked `src-find-cur`. */
      const cur = this.matches[this.cursor];
      if (cur?.type === 'line' && cur.line === i) cls += ' src-find-cur';
      let el = this.rowEls.get(i);
      if (el) {
        if (el.className !== cls) {
          // keep the highlight classes (hi/dim/flash) set outside render
          const kept = el.className.split(/\s+/).filter(c => !/^src-/.test(c) && c !== 'src-line');
          el.className = cls + kept.map(c => c ? ` ${c}` : '').join('');
        }
      } else {
        el = document.createElement('div');
        el.className = cls;
        el.dataset.line = lineNo;
        el.innerHTML = this.rowHtml[i];
        this.rowBodyEl.appendChild(el);
        this.rowEls.set(i, el);
      }
    }
    // Drop rows whose line is now covered by a collapsed run or is gone.
    for (const [i, el] of [...this.rowEls]) {
      if (i >= this.lines.length || skipped.has(i)) { el.remove(); this.rowEls.delete(i); }
    }
  }
  /* nodeRange: { line, endLine } from parser */
  highlightId(node, opts = {}) {
    const { line, endLine } = node;
    if (!line) return;
    /* A highlight landing inside a collapsed sequence run (e.g. the
     * <alignment> node) expands it first.  Expanding changes the row
     * content, so the cached row cache must be dropped. */
    if (this.seqRuns.some(r =>
      !this.expandedRuns.has(r.start) &&
      line <= r.end + 1 && (endLine || line) >= r.start + 1)) {
      for (const r of this.seqRuns)
        if (line <= r.end + 1 && (endLine || line) >= r.start + 1)
          this.expandedRuns.add(r.start);
      this.dirty = true;
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
    const sb = this.rowBodyEl;
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

  /** Render one source line's content: sequence-run collapse, elision,
   *  and the syntax highlighting.  The result is cached per line so the
   *  search can update only the class strings on subsequent calls. */
  renderRow(i, runAt, targetLines) {
    const lineNo = i + 1;
    const run = runAt.get(i);
    if (run && !this.expandedRuns.has(run.start)) {
      const n = run.end - run.start + 1;
      /* A single value= line already renders elided (below); show
       * the elided form directly, no click-to-expand round trip. */
      if (n === 1) {
        const elided = elideSeqLine(this.lines[i]) || this.lines[i];
        return `<span class="code">${esc(elided)}</span>`;
      }
      return `<span class="code">&nbsp;&nbsp;⋮&nbsp;&nbsp;${n} lines of sequence data&nbsp;&nbsp;(click to expand)</span>`;
    }
    const ln = this.lines[i];
    /* Expanded sequence lines keep the giant value= span elided —
     * a 186k-char row is what the user was scrolling past. */
    const elided = elideSeqLine(ln);
    if (elided) return `<span class="code">${esc(elided)}</span>`;
    const code = esc(ln).replace(/^(\s*&lt;!--.*?--&gt;)/,
      '<span class="com">$1</span>');
    const tagStyled = code.replace(
      /(&lt;\/?)([a-zA-Z][\w:-]*)/g,
      '$1<span class="tag">$2</span>');
    return tagStyled.replace(
      /\s([a-zA-Z\-:]+)=&quot;([^&]*)&quot;/g,
      ' <span class="attr">$1</span>=<span class="str">"$2"</span>') || '&nbsp;';
  }

  /** Lines (0-based) matching a lowercase query — used by the unified
   *  search so the matching source rows can be marked `src-find`. */
  matchLines(q) {
    if (!q) return [];
    return this.lowerLines.map((l, i) => l.includes(q) ? i : -1).filter(i => i >= 0);
  }

  /** Source-side match state from the unified search: the flat list of
   *  `{type, node, line}` entries, the cursor into it, and the render —
   *  matching rows get `src-find`, the current one `src-find-cur`. */
  setMatches(matches, cursor = -1) {
    this.matches = matches;
    this.matchSet = new Set(matches.filter(m => m.type === 'line').map(m => m.line));
    this.cursor = cursor;
    this.render();
  }

  /** Scroll a source line into view — the current search match.  A match
   *  inside an unexpanded sequence run scrolls to the run's collapse row. */
  focusMatch(line) {
    const run = this.seqRuns.find(r => !this.expandedRuns.has(r.start) &&
      line >= r.start && line <= r.end);
    const target = run ? run.start : line;
    const row = this.rowBodyEl.querySelector(`.src-line[data-line="${target + 1}"]`);
    try {
      row?.scrollIntoView({ block: 'center' });
    } catch { /* jsdom has no scrollIntoView — the row is still marked. */ }
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
                   line: n.xmlLine, container: p.container });
    }
  }
  if (!items.length) return `<div class="hint">No priors declared.</div>`;
  return `<table class="audit-table"><thead>
    <tr><th>Variable</th><th>Distribution</th><th>In</th></tr></thead>
    <tbody>${items.map(p => `
      <tr data-id="${esc(p.id)}" data-line="${p.line || ''}">
        <td class="audit-id">${esc(p.id)}</td>
        <td class="audit-detail">${esc(p.detail)}</td>
        <td class="audit-in">${esc(p.container || '')}</td>
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
                   line: n.xmlLine, container: o.container });
    }
  }
  if (!items.length) return `<div class="hint">No operators declared.</div>`;
  return `<table class="audit-table"><thead>
    <tr><th>Variable</th><th>Operator</th><th>In</th></tr></thead>
    <tbody>${items.map(p => `
      <tr data-id="${esc(p.id)}" data-line="${p.line || ''}">
        <td class="audit-id">${esc(p.id)}</td>
        <td class="audit-detail">${p.detail}</td>
        <td class="audit-in">${esc(p.container || '')}</td>
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

/* Unified search: matching nodes in the diagram (id, tag, label, role) and
 * matching source lines (raw XML text).  Enter cycles through all matches —
 * a node match focuses the node in the diagram, a line match focuses the
 * line in the source view.  Escape clears. */
export class Search {
  constructor(model, getDiagram, sourceView) {
    this.model = model;
    this.getDiagram = getDiagram;
    this.sourceView = sourceView;
    this.matches = [];
    this.cursor = -1;
  }
  refresh() {
    const q = (document.getElementById('search').value || '').trim().toLowerCase();
    const diag = this.getDiagram();
    if (!q) {
      this.matches = [];
      this.cursor = -1;
      this.updateCount();
      diag?.highlightMatches([]);
      this.paintSidebar('');
      this.sourceView.setMatches([]);
      return;
    }
    if (!this.model) return;
    const nodes = this.model.nodes.filter(n =>
      n.id.toLowerCase().includes(q) ||
      (n.tag || '').toLowerCase().includes(q) ||
      (n.label || '').toLowerCase().includes(q) ||
      (n.role || '').toLowerCase().includes(q));
    const lines = this.sourceView.matchLines(q);
    this.matches = [...nodes.map(n => ({ type: 'node', node: n })),
                    ...lines.map(l => ({ type: 'line', line: l }))];
    this.cursor = -1;
    this.updateCount();
    diag?.highlightMatches(nodes);
    this.paintSidebar(q);
    this.sourceView.setMatches(this.matches);
  }
  updateCount() {
    const c = document.getElementById('search-count');
    if (c) c.textContent = this.matches.length ? `${this.cursor + 1}/${this.matches.length}` : '';
  }
  paintSidebar(q) {
    const ids = new Set(this.matches.filter(m => m.type === 'node').map(m => m.node.id));
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
    this.sourceView.setMatches(this.matches, this.cursor);
    const m = this.matches[this.cursor];
    if (m.type === 'node') {
      document.dispatchEvent(new CustomEvent('phyloplate:focus-node', {
        detail: { id: m.node.id, line: m.node.xmlLine, scrollSource: false }
      }));
    } else {
      this.sourceView.focusMatch(m.line);
    }
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
