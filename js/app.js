import { parseBeastXML } from './parse-beast.js';
import { DiagramView } from './render.js';
import { buildNotation, renderNotation } from './notation.js';

const $ = id => document.getElementById(id);

// The module evaluated, so the boot warning is not needed.
$('boot').remove();

// Anything that escapes later would otherwise leave a silently dead page, so
// put it on screen as well as in the console.
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
let currentName = null;
let notation = null;

// ------------------------------------------------------------------ loading

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
  currentName = name;
  drop.style.display = 'none';
  aside.classList.remove('empty');
  $('tabs').hidden = false;
  for (const b of ['btn-expand', 'btn-collapse', 'btn-reset', 'btn-svg', 'btn-clear']) {
    $(b).disabled = false;
  }
  view.onChange = () => renderSidebar(model);
  view.setModel(model);
  renderSidebar(model);

  // A problem building the notation must not cost you the diagram.
  try {
    notation = buildNotation(model);
    renderNotation(notation, $('notation'));
  } catch (e) {
    notation = null;
    $('notation').innerHTML =
      '<div class="notation"><section><h3>Notation</h3>' +
      '<p class="note">Could not derive the notation for this model: ' +
      String(e.message).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) +
      '</p></section></div>';
    console.error('buildNotation failed', e);
  }
  $('btn-latex').disabled = !notation;
  showTab('diagram');
}

// ------------------------------------------------------------------ tabs

function showTab(which) {
  for (const t of $('tabs').querySelectorAll('.tab')) {
    t.classList.toggle('active', t.dataset.tab === which);
  }
  for (const g of document.querySelectorAll('.tab-tools')) {
    g.hidden = g.dataset.for !== which;
  }
  $('svg').style.display = which === 'diagram' ? '' : 'none';
  $('notation').hidden = which !== 'notation';
  for (const el of document.querySelectorAll('.diagram-only')) {
    el.style.display = which === 'diagram' ? '' : 'none';
  }
}

function readFile(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => load(r.result, file.name);
  r.onerror = () => showError('Could not read ' + file.name);
  r.readAsText(file);
}

// ------------------------------------------------------------------ sidebar

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
}

const LEGEND = [
  ['constant', 'Constant', 'Fixed value; prior hyperparameters'],
  ['stochastic', 'Stochastic', 'Sampled random variable'],
  ['deterministic', 'Deterministic', 'A function of its parents'],
  ['clamped', 'Clamped', 'Observed data (alignment)'],
  ['factor', 'Factor', 'Likelihood or density term'],
];

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
    return `<div class="row">
      <svg width="34" height="24" class="node-${type}">${shape}</svg>
      <span class="desc"><b>${name}</b>${desc}</span>
    </div>`;
  }).join('') + `
    <div class="row">
      <svg width="34" height="24"><rect class="plate-rect plate-tree" x="3" y="4"
        width="28" height="16" rx="5"/></svg>
      <span class="desc"><b>Plate</b>Replication over branches or sites</span>
    </div>`;
}
renderLegend();

// ------------------------------------------------------------------ events

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

$('btn-expand').onclick = () => view.expandAll();
$('btn-collapse').onclick = () => view.collapseAll();
$('btn-reset').onclick = () => view.resetZoom();
$('chk-modules').onchange = e => view.setModules(e.target.checked);
$('chk-machinery').onchange = e => view.setMachinery(e.target.checked);

$('btn-svg').onclick = () => {
  const blob = new Blob([view.exportSVG()], { type: 'image/svg+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (currentName || 'model').replace(/\.xml$/i, '') + '_plate.svg';
  a.click();
  URL.revokeObjectURL(a.href);
};

for (const t of $('tabs').querySelectorAll('.tab')) {
  t.onclick = () => showTab(t.dataset.tab);
}

$('btn-latex').onclick = async () => {
  if (!notation) return;
  const btn = $('btn-latex');
  try {
    await navigator.clipboard.writeText(notation.latex);
    btn.textContent = 'Copied';
  } catch {
    // clipboard is blocked outside a secure context, so fall back to a file
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

$('btn-clear').onclick = () => {
  drop.style.display = '';
  aside.classList.add('empty');
  $('tabs').hidden = true;
  $('file').value = '';
  for (const b of ['btn-expand', 'btn-collapse', 'btn-reset', 'btn-svg', 'btn-clear']) {
    $(b).disabled = true;
  }
};

// ?demo opens straight into an example: ?demo=1 for the default, or
// ?demo=<filename> for a specific one.  Awaited at the top level.
const demo = new URLSearchParams(location.search).get('demo');
if (demo !== null) {
  await loadExample(demo && demo !== '1' ? demo : DEFAULT_EXAMPLE);
}
