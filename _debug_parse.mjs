import fs from 'node:fs';
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

const dom = new JSDOM();
globalThis.document = dom.window.document;
globalThis.DOMParser = dom.window.DOMParser;
globalThis.NodeFilter = dom.window.NodeFilter;

const text = fs.readFileSync('../phyloplate_tester/MSC_fakeOutgroup_posterior_fakeAr_FINAL_v7_expGrowth_pddc_squirrels_ME_bletsa_hmc_b0eqIngroup_sd2_prior 1.xml', 'utf8');

const pbs = fs.readFileSync('./js/parse-beast.js', 'utf8');
fs.writeFileSync('/tmp/parse-beast-appdbg.mjs', pbs);
const { parseBeastXML } = await import(pathToFileURL('/tmp/parse-beast-appdbg.mjs').href);

const model = parseBeastXML(text);

// Look for duplicate ids
const seen = new Map();
for (const n of model.nodes) {
  if (seen.has(n.id)) {
    console.log(`DUPLICATE id: ${n.id}  seen ${seen.get(n.id)} times`);
  }
  seen.set(n.id, (seen.get(n.id) || 0) + 1);
}

console.log('total nodes:', model.nodes.length);
console.log('unique ids:', seen.size);
