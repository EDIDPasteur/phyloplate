import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

const dom = new JSDOM();
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.NodeFilter = dom.window.NodeFilter;

const text = fs.readFileSync('../phyloplate_tester/MSC_fakeOutgroup_posterior_fakeAr_FINAL_v7_expGrowth_pddc_squirrels_ME_bletsa_hmc_b0eqIngroup_sd2_prior 1.xml', 'utf8');

const pbs = fs.readFileSync('./js/parse-beast.js', 'utf8');
const layoutSrc = fs.readFileSync('./js/layout.js', 'utf8');
fs.writeFileSync('/tmp/parse-beast-dbg.mjs', pbs);
fs.writeFileSync('/tmp/layout-dbg.mjs', layoutSrc);
const { parseBeastXML } = await import(pathToFileURL('/tmp/parse-beast-dbg.mjs').href);
const { layout, collapseModules } = await import(pathToFileURL('/tmp/layout-dbg.mjs').href);

const model = parseBeastXML(text);

const visible = model.nodes.filter(n => !n.machinery);
const ids = new Set(visible.map(n => n.id));
let edges = model.edges
  .filter(e => ids.has(e.source) && ids.has(e.target))
  .map(e => ({ ...e }));

let { nodes, edges: nedges } = collapseModules(visible, edges, new Set());
edges = nedges;

const R = 24;
for (const n of nodes) {
  if (n.type === 'module') { n.w = 150; n.h = 52; }
  else if (n.type === 'constant') { n.w = 52; n.h = 28; }
  else if (n.type === 'factor') { n.w = 72; n.h = 34; }
  else { n.r = R; }
}

const widthOf = n => n.r ? n.r * 2 : n.w;

const dim = layout(nodes, edges, { widthOf });

console.log('Layout:');
console.log('  width:', dim.width);
console.log('  height:', dim.height);
console.log('  layers:', dim.layers);

// Sort by layer and show
const byLayer = new Map();
for (const n of nodes) {
  const layer = n._layer ?? 0;
  if (!byLayer.has(layer)) byLayer.set(layer, []);
  byLayer.get(layer).push(n);
}
for (const [layer, ns] of [...byLayer].sort((a,b)=>a[0]-b[0])) {
  console.log(`layer ${layer}:`);
  for (const n of ns) {
    console.log(`  ${n.id}  x=${n.x.toFixed(0)} y=${n.y.toFixed(0)}  type=${n.type}  module=${n.module}  label=${n.label}`);
  }
}

// Specifically look for beta.intercept
const bi = nodes.find(n => n.id === 'beta.intercept');
console.log('\nbeta.intercept:', bi ? `present at (${bi.x}, ${bi.y})` : 'NOT IN NODES');
