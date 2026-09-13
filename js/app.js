import { parseBeastXML } from './parse-beast.js';
import { DiagramView } from './render.js';
import { buildNotation, renderNotation } from './notation.js';
import {
  SourceView, Search, renderAudit, wireAuditClicks,
  diffModels, renderDiff, exportBN,
} from './extras.js';
import { McmcEditor, PriorDock } from './mcmc-editor.js';
import { esc } from './extras.js';

const $ = id => document.getElementById(id);

// The module evaluated, so the boot warning is not needed.
$('boot').remove();

function fatal(what, e) {
  console.error(what, e);
  const msg = `${what}: ${e && e.message ? e.message : e}`;
  let bar = document.getElementById('fatal');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fatal';
    bar.className = 'fatal';
    bar.onclick = () => bar.remove();
    document.body.appendChild(bar);
  }
  bar.textContent = msg + '  (click to dismiss)';
}
window.addEventListener('error', e => fatal('Unexpected error', e.error || e));
window.addEventListener('unhandledrejection', e => fatal('Unexpected error', e.reason));

const canvas = $('canvas');
const drop = $('drop');
const err = $('err');
const aside = $('aside');

const view = new DiagramView($('svg'), $('tooltip'));
const source = new SourceView($('source'));
const search = new Search(null, () => view);

let currentName = null;
let currentModel = null;
let currentText = null;
let notation = null;
let compareModel = null;

// ----------------------------------------------------------------- theme

const THEME_KEY = 'phyloplate.theme';
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t || 'auto');
}
applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
$('btn-theme').onclick = () => {
  const cur = document.documentElement.getAttribute('data-theme') || 'auto';
  const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
};

// ----------------------------------------------------------------- loading

function showError(msg) {
  err.hidden = false;
  err.textContent = msg;
}

function load(text, name) {
  err.hidden = true;
  let model;
  try {
    model = parseBeastXML(text);
  } catch (e) {
    showError(e.message);
    return;
  }
  if (!model.nodes.length) {
    showError('Parsed the XML but found no model components to draw.');
    return;
  }
  model.meta.fileName = name;
  currentName = name;
  currentModel = model;
  currentText = text;
  /* Tear down the live editors so the next time the user opens
   * the Source tab, a fresh McmcEditor is built from this new
   * model.  Re-using the old instance would leave the rendered
   * form rows showing the previous model's parameters. */
  if (mcmcEditor) {
    mcmcEditor.root.innerHTML = '';
    mcmcEditor = null;
  }
  closePriorDock();
  drop.style.display = 'none';
  aside.classList.remove('empty');
  $('tabs').hidden = false;
  $('toolbar').hidden = false;
  $('search-row').hidden = false;
  $('filename').hidden = false;
  $('filename').textContent = name;
  $('filename').title = name;
  for (const b of ['btn-expand', 'btn-collapse', 'btn-reset',
                    'btn-svg', 'btn-clear', 'btn-bn', 'btn-mcmc-export']) {
    $(b).disabled = false;
  }
  search.model = model;
  /* Reset legend lock + active row on model load. */
  legendLockType = null;
  paintLegend(null);

  view.onChange = () => renderSidebar(model);
  view.onHover = n => {
    if (!n || !n.xmlLine) {
      source.clearHighlight();
      markLegendType(null);
      return;
    }
    source.highlightId({ line: n.xmlLine, endLine: n.xmlEndLine,
                         id: n.id }, { dimOthers: true });
    /* Match the legend row to the hovered node's type so the diagram
     * and the sidebar stay in sync.  Module boxes have no type here. */
    if (n.type && n.type !== 'module') markLegendType(n.type);
  };
  view.onPick = n => {
    if (!n) return;
    /* Click on a prior's hyperparameter square, or on a parameter that
     * has priors: open the right-docked prior editor.  Everything else
     * falls back to the source view (the existing behaviour). */
    const target = priorTargetOf(n, model);
    if (target) {
      openPriorDock(n, target);
      return;
    }
    if (!n.xmlLine) return;
    showTab('source');
    source.highlightId({ line: n.xmlLine, endLine: n.xmlEndLine,
                         id: n.id }, { dimOthers: false, scroll: true });
  };
  view.setModel(model);
  source.setSource(text);
  /* Click-to-jump on the source tab.  When the user clicks a line
   * that maps to a prior, operator, <mcmc>, <log>, or <logTree>,
   * the McmcEditor highlights and scrolls to the matching row.
   * (The lineTarget is built by the parser; see parse-beast.js.) */
  source.setLineTargets(model.lineTargets || null);
  source.onLineTarget = (t) => {
    /* Only jump if the source tab is active.  Otherwise the user is
     * still on the diagram and the click is a no-op. */
    if ($('source').hidden) return;
    if (mcmcEditor) mcmcEditor.focusLineTarget(t);
  };

  renderSidebar(model);

  try {
    notation = buildNotation(model);
    renderNotation(notation, $('notation'));
  } catch (e) {
    notation = null;
    $('notation').innerHTML =
      '<div class="notation"><section><h3>Notation</h3>' +
      '<p class="note">Could not derive the notation for this model: ' +
      esc(String(e.message)) +
      '</p></section></div>';
    console.error('buildNotation failed', e);
  }
  $('btn-latex').disabled = !notation;
  showTab('diagram');
}

// ----------------------------------------------------------------- tabs

function showTab(which) {
  for (const t of $('tabs').querySelectorAll('.tab')) {
    t.classList.toggle('active', t.dataset.tab === which);
  }
  for (const g of document.querySelectorAll('.tab-tools')) {
    g.hidden = g.dataset.for !== which;
  }
  $('svg').style.display = which === 'diagram' ? '' : 'none';
  $('source').hidden = which !== 'source';
  $('compare').hidden = which !== 'compare';
  $('notation').hidden = which !== 'notation';
  for (const el of document.querySelectorAll('.diagram-only')) {
    el.style.display = (which === 'diagram' || which === 'source') ? '' : 'none';
  }
  /* The prior dock is part of the diagram tab \u2014 hide it whenever the
   * user moves to a different tab so it doesn't bleed over. */
  if (which !== 'diagram' && priorDock) {
    priorDock.root.hidden = true;
  } else if (which === 'diagram' && priorDock && priorDock.prior) {
    priorDock.root.hidden = false;
  }
  /* Lazily populate the MCMC sidebar inside the Source tab the first
   * time the user opens it.  Subsequent visits just sync the model so
   * the inputs reflect any prior edits. */
  if (which === 'source' && currentModel) {
    if (!mcmcEditor) {
      ensureMcmcEditor();
      mcmcEditor.open(currentModel, currentText);
    } else {
      mcmcEditor.sync(currentModel, currentText);
    }
  }
}

function readFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => load(r.result, file.name);
  r.onerror = () => showError('Could not read ' + file.name);
  r.readAsText(file);
}

// ----------------------------------------------------------------- sidebar

const SWATCH = {
  tree: '#00796b', rateMatrix: '#00897b', siteRates: '#4db6ac',
  branchRates: '#ff9100', phyloCTMC: '#004d40', data: '#b2dfdb', other: '#8b9a9e',
};

function renderSidebar(model) {
  const s = model.stats;
  const rows = [
    ['BEAST', model.meta.version],
    ['taxa', s.ntax ?? '—'],
    ['sites', s.nchar ?? '—'],
    ['chain', s.chainLength ? Number(s.chainLength).toLocaleString() : '—'],
    ['stochastic', s.stochastic],
    ['deterministic', s.deterministic],
    ['constant', s.constant],
    ['observed', s.clamped],
    ['operators', s.operators],
    ['priors', s.priors],
  ];
  $('meta').innerHTML = rows
    .map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');

  $('modules').innerHTML = view.modules().map(m => `
    <div class="mod-item ${m.collapsed ? 'collapsed' : ''}" data-mod="${m.id}">
      <span class="swatch" style="background:${SWATCH[m.id] || '#8b9a9e'}"></span>
      <span class="name">${m.label}</span>
      <span class="count">${m.count}</span>
    </div>`).join('');

  for (const el of $('modules').querySelectorAll('.mod-item')) {
    el.onclick = () => view.toggleModule(el.dataset.mod);
  }

  renderAudit(model);
  wireAuditClicks(model);
}

const LEGEND = [
  ['constant', 'Constant', 'Fixed value; prior hyperparameters'],
  ['stochastic', 'Stochastic', 'Sampled random variable'],
  ['deterministic', 'Deterministic', 'A function of its parents'],
  ['clamped', 'Clamped', 'Observed data (alignment)'],
  ['factor', 'Factor', 'Likelihood or density term'],
];

/** Currently "locked" legend type (clicked).  null = no lock. */
let legendLockType = null;

function renderLegend() {
  $('legend').innerHTML = LEGEND.map(([type, name, desc]) => {
    let shape;
    if (type === 'constant') {
      shape = `<rect class="node-shape" x="6" y="4" width="22" height="16" rx="3"/>`;
    } else if (type === 'factor') {
      shape = `<rect class="node-shape" x="4" y="4" width="26" height="16" rx="8"/>`;
    } else {
      shape = `<circle class="node-shape" cx="17" cy="12" r="10"/>` +
        (type === 'clamped' ? `<circle class="node-inner" cx="17" cy="12" r="6"/>` : '');
    }
    return `<div class="row" data-node-type="${type}" data-symbol="${name}">
      <svg width="34" height="24" class="node-${type}">${shape}</svg>
      <span class="desc"><b>${name}</b>${desc}</span>
    </div>`;
  }).join('') + `
    <div class="row">
      <svg width="34" height="24"><rect class="plate-rect plate-tree" x="3" y="4"
        width="28" height="16" rx="5"/></svg>
      <span class="desc"><b>Plate</b>Replication over branches or sites</span>
    </div>`;

  // Legend rows are clickable: click a row to lock the diagram filter to that
  // node type.  Click the same row again (or Esc) to clear the lock.
  for (const row of $('legend').querySelectorAll('.row[data-node-type]')) {
    row.onclick = () => {
      const type = row.dataset.nodeType;
      if (legendLockType === type) {
        legendLockType = null;
        view.clearTypeHighlight();
        paintLegend(null);
      } else {
        legendLockType = type;
        view.highlightByType(type);
        paintLegend(type);
      }
    };
  }
}

/** Paint the legend rows so that `type` is `.active`. */
function paintLegend(type) {
  for (const r of $('legend').querySelectorAll('.row[data-node-type]')) {
    r.classList.toggle('active', r.dataset.nodeType === type);
  }
}

/** While hovering a node, mark the legend row that matches its type —
 *  unless the user has clicked a row to lock the filter, in which case the
 *  hover must not override the lock. */
function markLegendType(type) {
  if (legendLockType) return;
  paintLegend(type);
}
renderLegend();

/* Collapsible h2 headers: clicking toggles `.collapsed` on the h2 itself;
 * the CSS hides the immediately-following sibling when collapsed. */
for (const head of document.querySelectorAll('aside h2.collapsible')) {
  head.onclick = () => head.classList.toggle('collapsed');
}

// ----------------------------------------------------------------- dialogs

for (const tab of document.querySelectorAll('.foot-tab')) {
  const dlg = $('dlg-' + tab.dataset.dialog);
  if (!dlg) continue;
  tab.onclick = () => { tab.classList.add('open'); dlg.showModal(); };
  dlg.addEventListener('close', () => tab.classList.remove('open'));
  dlg.querySelector('.modal-close').onclick = () => dlg.close();
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
}

// ----------------------------------------------------------------- events

$('btn-browse').onclick = () => $('file').click();
$('file').onchange = e => readFile(e.target.files[0]);

const DEFAULT_EXAMPLE = 'gtr-strict-clock-6taxa.xml';

async function loadExample(name) {
  err.hidden = true;
  const path = 'examples/' + name;
  try {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    load(await r.text(), name);
  } catch (e) {
    showError('Could not fetch the bundled example (' + e.message +
      '). Serve the folder over http, e.g. ./serve.sh, or drop a file instead.');
  }
}

for (const b of document.querySelectorAll('.example')) {
  b.onclick = () => loadExample(b.dataset.example);
}

for (const ev of ['dragenter', 'dragover']) {
  canvas.addEventListener(ev, e => {
    e.preventDefault(); canvas.classList.add('dragover');
  });
}
for (const ev of ['dragleave', 'drop']) {
  canvas.addEventListener(ev, e => {
    e.preventDefault();
    if (ev === 'dragleave' && canvas.contains(e.relatedTarget)) return;
    canvas.classList.remove('dragover');
  });
}
canvas.addEventListener('drop', e => {
  e.preventDefault();
  readFile(e.dataTransfer.files[0]);
});

// Paste from clipboard: Ctrl/Cmd+V anywhere on the canvas
canvas.addEventListener('paste', e => {
  if (!e.clipboardData) return;
  const txt = e.clipboardData.getData('text/plain');
  if (txt && txt.trim().startsWith('<')) {
    load(txt, 'pasted.xml');
    e.preventDefault();
  }
});
// also catch paste at document level when canvas is focused
window.addEventListener('paste', e => {
  if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
  if (!currentModel && e.clipboardData) {
    const txt = e.clipboardData.getData('text/plain');
    if (txt && txt.trim().startsWith('<')) {
      load(txt, 'pasted.xml');
      e.preventDefault();
    }
  }
});

$('btn-expand').addEventListener('click', () => view.expandAll());
$('btn-collapse').addEventListener('click', () => view.collapseAll());
$('btn-reset').addEventListener('click', () => flashButton('tb-fit', () => view.resetView()));
$('chk-modules').addEventListener('change', e => {
  view.setModules(e.target.checked);
  $('tb-modules').classList.toggle('active', e.target.checked);
});
$('chk-machinery').addEventListener('change', e => {
  view.setMachinery(e.target.checked);
  $('tb-machinery').classList.toggle('active', e.target.checked);
});

/** Briefly highlight a toolbar button so the user can see the action fired. */
function flashButton(id, fn) {
  const btn = $(id);
  if (!btn) { fn(); return; }
  const ok = fn();
  btn.classList.add('flash');
  setTimeout(() => btn.classList.remove('flash'), 220);
  return ok;
}

/** Show a transient status message under the toolbar. */
let _statusTimer = null;
function statusFlash(msg, ms = 1200) {
  let el = document.getElementById('status-flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'status-flash';
    el.className = 'status-flash';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('visible');
  if (_statusTimer) clearTimeout(_statusTimer);
  _statusTimer = setTimeout(() => el.classList.remove('visible'), ms);
}

$('btn-svg').onclick = () => {
  const blob = new Blob([view.exportSVG()], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentName || 'model').replace(/\.xml$/i, '') + '_plate.svg';
  a.click();
  URL.revokeObjectURL(a.href);
};

$('btn-bn').onclick = () => {
  if (!currentModel) return;
  const blob = new Blob([exportBN(currentModel)], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentName || 'model').replace(/\.xml$/i, '') + '.bn';
  a.click();
  URL.revokeObjectURL(a.href);
};

for (const t of $('tabs').querySelectorAll('.tab')) {
  t.onclick = () => showTab(t.dataset.tab);
}

// LaTeX copy with light syntax colouring shown in the button feedback.
$('btn-latex').onclick = async () => {
  if (!notation) return;
  const btn = $('btn-latex');
  try {
    await navigator.clipboard.writeText(notation.latex);
    btn.textContent = 'Copied LaTeX';
  } catch {
    const blob = new Blob([notation.latex], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (currentName || 'model').replace(/\.xml$/i, '') + '.tex';
    a.click();
    URL.revokeObjectURL(a.href);
    btn.textContent = 'Downloaded';
  }
  setTimeout(() => { btn.textContent = 'Copy LaTeX'; }, 1600);
};

// Compare: load a second XML and diff against currentModel.
let compareFileInput = null;
async function pickCompareModel() {
  if (compareFileInput) compareFileInput.remove();
  compareFileInput = document.createElement('input');
  compareFileInput.type = 'file';
  compareFileInput.accept = '.xml,text/xml';
  compareFileInput.onchange = async e => {
    const f = e.target.files[0];
    if (!f) return;
    const text = await f.text();
    let m;
    try { m = parseBeastXML(text); } catch (err) {
      showError('Compare: ' + err.message); return;
    }
    m.meta.fileName = f.name;
    compareModel = m;
    const diff = diffModels(currentModel, m);
    renderDiff(diff, $('compare'));
    $('tab-compare').hidden = false;
    showTab('compare');
  };
  compareFileInput.click();
}

// Right-click on the diagram opens a context menu for compare / etc.
canvas.addEventListener('contextmenu', e => {
  if (!currentModel) return;
  e.preventDefault();
  pickCompareModel();
});

$('btn-clear').onclick = () => {
  drop.style.display = '';
  aside.classList.add('empty');
  $('tabs').hidden = true;
  $('toolbar').hidden = true;
  $('search-row').hidden = true;
  $('filename').hidden = true;
  $('tab-compare').hidden = true;
  $('file').value = '';
  currentModel = null;
  currentText = null;
  compareModel = null;
  closePriorDock();
  /* Tear down the McmcEditor so the next source-tab visit builds a
   * fresh one.  Re-using the old instance with a new model would
   * leave the rendered DOM in the previous model's state and crash
   * the next `refreshPriorPreview` call (which can't find its
   * preview div). */
  if (mcmcEditor) {
    mcmcEditor.root.innerHTML = '';
    mcmcEditor = null;
  }
  for (const b of ['btn-expand', 'btn-collapse', 'btn-reset',
                    'btn-svg', 'btn-clear', 'btn-bn', 'btn-mcmc-export']) {
    $(b).disabled = true;
  }
  $('search').value = '';
};

// ----------------------------------------------------------------- toolbar

function wireToolbar() {
  const guarded = (label, fn) => () => {
    const ok = fn();
    if (ok === false) statusFlash(label + ': no model loaded');
    return ok;
  };
  const tbToggle = id => {
    const c = $(id); c.checked = !c.checked; c.dispatchEvent(new Event('change'));
  };
  /* The toolbar buttons are static HTML, so wire them once. */
  $('tb-fit').addEventListener('click', () => flashButton('tb-fit', guarded('Fit', () => view.fitToView())));
  $('tb-zoom-in').addEventListener('click', () => flashButton('tb-zoom-in', guarded('Zoom in', () => view.zoomBy(1.25))));
  $('tb-zoom-out').addEventListener('click', () => flashButton('tb-zoom-out', guarded('Zoom out', () => view.zoomBy(0.8))));
  $('tb-search').addEventListener('click', () => $('search').focus());
  $('tb-modules').addEventListener('click', () => tbToggle('chk-modules'));
  $('tb-machinery').addEventListener('click', () => tbToggle('chk-machinery'));
}
wireToolbar();

// ----------------------------------------------------------------- search

$('search').oninput = () => {
  search.refresh();
  /* Search overwrites the dim state of every node; if the user has locked
   * a legend row, re-apply that dim on top of the search. */
  if (legendLockType) view.highlightByType(legendLockType);
};
/* Enter cycles matches; Escape clears the search.  Esc also re-applies any
 * locked legend dim, since clearing the search strips the dim class. */
$('search').onkeydown = e => {
  if (e.key === 'Enter') { e.preventDefault(); search.next(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') {
    search.clear();
    $('search').blur();
    if (legendLockType) view.highlightByType(legendLockType);
  }
};
/* Esc anywhere else clears any locked legend filter too. */
window.addEventListener('keydown', e => {
  if (e.key === 'Escape' && legendLockType) {
    legendLockType = null;
    view.clearTypeHighlight();
    paintLegend(null);
  }
});

// ----------------------------------------------------------------- focus event

document.addEventListener('phyloplate:focus-node', e => {
  const { id, scrollSource } = e.detail;
  if (!id) return;
  const node = currentModel?.nodes.find(n => n.id === id);
  if (!node) return;
  // Highlight the source if visible.  The diagram focus is fired separately
  // so the source highlight does not double-fire through onHover.
  if ($('source').hidden === false) {
    source.highlightId({ line: node.xmlLine, endLine: node.xmlEndLine,
                         id: node.id }, { dimOthers: false, scroll: !!scrollSource });
  }
  // Brief visual focus on the diagram: add 'hi' class, then fade after a beat.
  const sel = view.svg.selectAll('.node').filter(d => d.id === id);
  if (!sel.empty()) {
    sel.classed('hi', true);
    setTimeout(() => sel.classed('hi', false), 1200);
  }
});

// ----------------------------------------------------------------- keyboard

/* Keyboard shortcuts.  Single handler on window, attached once.  Anything that
 * looks like text input (input, textarea, contenteditable, select) absorbs the
 * key — so typing 'm' into the FASTA summary shouldn't toggle modules. */
function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}
function handleKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(document.activeElement)) return;
  let handler = null;
  switch (e.key) {
    case 'f': case 'F':
      handler = () => { flashButton('tb-fit', () => view.fitToView()); };
      break;
    case '+': case '=':
      handler = () => { flashButton('tb-zoom-in', () => view.zoomBy(1.25)); };
      break;
    case '-': case '_':
      handler = () => { flashButton('tb-zoom-out', () => view.zoomBy(0.8)); };
      break;
    case '/':
      handler = () => { $('tb-search')?.click(); };
      break;
    case 'm': case 'M':
      handler = () => { $('tb-modules')?.click(); };
      break;
    case 'g': case 'G':
      handler = () => { $('tb-machinery')?.click(); };
      break;
    case '1': handler = () => showTab('diagram'); break;
    case '2': handler = () => showTab('source'); break;
    case '3': handler = () => showTab('notation'); break;
  }
  if (handler) {
    e.preventDefault();
    handler();
  }
}
window.addEventListener('keydown', handleKey);

// ----------------------------------------------------------------- drawer

$('btn-aside').onclick = () => aside.classList.toggle('drawer-open');
$('drawer-backdrop').onclick = () => aside.classList.remove('drawer-open');

// ----------------------------------------------------------------- editor

/* Two editor surfaces:
 *
 *  - `PriorDock` lives in the right-docked panel.  It opens when the user
 *    clicks a prior's hyperparameter square or a parameter that has
 *    priors, and shows one prior's preview + form side by side.
 *
 *  - `McmcEditor` fills the Edit MCMC tab.  It lists every operator and
 *    exposes the <mcmc>, <log>, and <logTree> elements for editing.
 *
 * Both call `applyEdits(xml, err, stayOnDock?)` on commit, which
 * re-parses the XML, refreshes the diagram / source / notation / sidebar,
 * and keeps the dock open (if applicable). */
let priorDock = null;
let mcmcEditor = null;

function priorTargetOf(node, model) {
  if (!node || !model) return null;
  /* Hyperparameter squares (parsed by parse-beast.js for every prior)
   * carry `hyperTarget` pointing at the parameter they constrain. */
  if (node.isHyper && node.hyperTarget) {
    return { targetId: node.hyperTarget, dist: node.tag, hyperNode: node };
  }
  /* Clicking the parameter node itself: open the first prior on it. */
  if (node.priors && node.priors.length) {
    return { targetId: node.id, dist: node.priors[0].dist, hyperNode: null };
  }
  return null;
}

function openPriorDock(node, target) {
  if (!currentModel || !currentText) return;
  if (!priorDock) {
    priorDock = new PriorDock($('prior-dock'), {
      onClose: () => { /* no-op; close button handles teardown */ },
      onEditError: (msg) => statusFlash('Edit failed: ' + msg, 3000),
      onApply: (xml, parseError) => applyEdits(xml, parseError, /*stayOnDock=*/true),
    });
  }
  /* Resolve the prior entry.  If the user clicked the parameter node,
   * `target.dist` is the first prior's tag.  If the user clicked a
   * hyperparameter square, `target.dist` is the prior's dist name. */
  const priors = currentModel.nodes
    .find(n => n.id === target.targetId)?.priors || [];
  const match = priors.find(p => p.dist === target.dist) || priors[0];
  if (!match) return;
  /* Build a stable entry identical to what the old editor used. */
  const entry = {
    key: `pri-${target.targetId}-${match.dist}-0`,
    dist: match.dist,
    targetId: target.targetId,
    attrs: match.attrs,
    index: 0,
    label: match.label || target.targetId,
  };
  priorDock.open(currentModel, currentText, entry);
  showTab('diagram');
}

function closePriorDock() {
  if (!priorDock) return;
  priorDock.root.hidden = true;
  priorDock.prior = null;
}

function ensureMcmcEditor() {
  if (mcmcEditor) return mcmcEditor;
  /* The MCMC form is rendered into the right sidebar of the Source
   * tab so the user can edit priors, operators, and chain settings
   * while watching the underlying XML update. */
  mcmcEditor = new McmcEditor($('source-mcmc'), {
    onEditError: (msg) => statusFlash('Edit failed: ' + msg, 3000),
    onApply: (xml, parseError) => applyEdits(xml, parseError, /*stayOnDock=*/false),
    onJumpToLine: (line) => {
      if (!line) return;
      showTab('source');
      source.highlightId({ line, endLine: line, id: '(jump)' },
                        { dimOthers: true, scroll: true });
    },
  });
  return mcmcEditor;
}

function applyEdits(xml, parseError, stayOnDock) {
  currentText = xml;
  source.setSource(xml);
  if (parseError) {
    statusFlash('XML did not re-parse: ' + parseError.message, 3000);
    return;
  }
  try {
    const model = parseBeastXML(xml);
    if (!model.nodes.length) throw new Error('no nodes');
    model.meta.fileName = currentName;
    currentModel = model;
    search.model = model;
    view.setModel(model);
    /* Refresh the click-to-jump line targets so the source view picks
     * up the edited XML's priors / operators.  The handler is wired
     * in load() and doesn't need to be re-set. */
    source.setLineTargets(model.lineTargets || null);
    try {
      notation = buildNotation(model);
      renderNotation(notation, $('notation'));
    } catch { notation = null; }
    renderSidebar(model);
    /* Sync the live editors with the new model so subsequent commits use
     * fresh priors/operators.  We avoid a full re-render of the active
     * editor: that would steal focus from the input the user is typing
     * in.  The dock and tab keep their current selection; the underlying
     * model just gets refreshed. */
    if (stayOnDock && priorDock) {
      priorDock.sync(model, xml);
    }
    if (mcmcEditor) {
      mcmcEditor.sync(model, xml);
    }
  } catch (e) {
    statusFlash('XML did not re-parse: ' + e.message, 3000);
  }
}

/* The "Export XML" button in the Edit MCMC tab downloads the current
 * (possibly edited) XML. */
$('btn-mcmc-export').onclick = () => {
  if (!currentText) return;
  const blob = new Blob([currentText], { type: 'application/xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentName || 'model').replace(/\.xml$/i, '') + '_edited.xml';
  a.click();
  URL.revokeObjectURL(a.href);
};

// ----------------------------------------------------------------- boot

const demo = new URLSearchParams(location.search).get('demo');
if (demo !== null) {
  await loadExample(demo && demo !== '1' ? demo : DEFAULT_EXAMPLE);
}
