import fs from 'node:fs';
import path from 'node:path';
import { JSDOM, ResourceLoader, VirtualConsole } from 'jsdom';

const rootDir = process.cwd();
const html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');

class L extends ResourceLoader {
  fetch(url, opts) {
    const u = new URL(url);
    let p = path.join(rootDir, u.pathname);
    if (!fs.existsSync(p)) {
      return Promise.resolve(Buffer.from(''));
    }
    return Promise.resolve(fs.readFileSync(p));
  }
}

const vc = new VirtualConsole();
vc.on('jsdomError', e => console.error('jsdomError:', e.message, e.stack || ''));
vc.on('error', e => console.error('console.error:', e?.message || e));
vc.on('warn', e => console.error('console.warn:', e?.message || e));
vc.on('log', (...args) => console.log('console.log:', ...args));
vc.on('info', (...args) => console.log('console.info:', ...args));

const dom = new JSDOM(html, {
  url: 'http://localhost/',
  runScripts: 'dangerously',
  resources: new L({ strictSSL: false }),
  pretendToBeVisual: true,
  virtualConsole: vc,
});

dom.window.addEventListener('error', e => {
  console.error('window error:', e.message, '@', e.filename, e.lineno);
});
dom.window.addEventListener('unhandledrejection', e => {
  console.error('rejection:', e.reason?.message || e.reason);
});

(async () => {
  await new Promise(r => setTimeout(r, 2500));
  const w = dom.window;
  const d = w.document;

  // Now we should have a DiagramView and a Search. Load the test XML.
  const txt = fs.readFileSync(path.join(rootDir, '../phyloplate_tester/MSC_fakeOutgroup_posterior_fakeAr_FINAL_v7_expGrowth_pddc_squirrels_ME_bletsa_hmc_b0eqIngroup_sd2_prior 1.xml'), 'utf8');

  // Trigger a paste event with the XML on window (the second handler is on window).
  try {
    const evt = new w.Event('paste', { bubbles: true });
    Object.defineProperty(evt, 'clipboardData', {
      get: () => ({ getData: () => txt })
    });
    w.dispatchEvent(evt);
  } catch (e) {
    console.log('paste dispatch failed:', e.message);
  }

  // Check if app loaded at all
  console.log('boot div:', !!d.getElementById('boot'));
  console.log('tabs:', d.getElementById('tabs')?.hidden);
  console.log('aside:', d.getElementById('aside')?.className);

  // Check global errors
  await new Promise(r => setTimeout(r, 1500));

  // Check whether load happened
  const errEl = d.getElementById('err');
  console.log('err hidden:', errEl?.hidden);
  console.log('err text:', errEl?.textContent);
  console.log('aside empty class:', d.getElementById('aside')?.className);

  // Now query the diagram
  const drawnNodes = d.querySelectorAll('#svg .node');
  console.log('drawn nodes:', drawnNodes.length);
  let found = false;
  for (const el of drawnNodes) {
    const t = el.querySelector('title');
    if (t && t.textContent.includes('beta.intercept')) {
      found = true;
      const cls = el.getAttribute('class');
      const transform = el.getAttribute('transform');
      console.log('beta.intercept found, class:', cls, 'transform:', transform);
    }
  }
  if (!found) {
    console.log('beta.intercept NOT in drawn diagram. Drawn node titles:');
    for (const el of drawnNodes) {
      const t = el.querySelector('title');
      if (t) console.log('  -', t.textContent);
    }
  }

  dom.window.close();
  process.exit(0);
})().catch(e => {
  console.error('test error:', e.message);
  console.error(e.stack);
  process.exit(1);
});
