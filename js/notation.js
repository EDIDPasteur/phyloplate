/* Renders the parsed model as probabilistic-model notation: the posterior
 * factorisation, then the distributional statement behind every term.
 *
 * The factorisation is the one BEAST itself targets — read from <joint>,
 * <prior> and <likelihood> — so this view and the diagram describe the same
 * object, per Eq. 1-2 of Hohna et al. (2014). */

const TEX = {
  'Ψ': '\\Psi', 'Ψₛ': '\\Psi_s', 'κ': '\\kappa', 'α': '\\alpha', 'β': '\\beta',
  'π': '\\pi', 'μ': '\\mu', 'θ': '\\theta', 'σ': '\\sigma', 'λ': '\\lambda',
  'γ': '\\gamma', 'ω': '\\omega', 'τ': '\\tau', 'ε': '\\epsilon',
  'Nₑ': 'N_e', 'β₀': '\\beta_0', 'β₁': '\\beta_1', 't₀': 't_0', 'r̄': '\\bar{r}',
  'N(t)': 'N(t)', 'Γ': '\\Gamma', 'Q': 'Q', 'M': 'M', 'D': 'D', 'Z': 'Z',
  'r': 'r', 'g': 'g', 'BD': '\\mathrm{BD}',
};

/** Friendly names for the deterministic components. */
const COMPONENT = {
  hkyModel: 'HKY', gtrModel: 'GTR', tn93Model: 'TN93', jc69Model: 'JC69',
  generalSubstitutionModel: 'CTMC', complexSubstitutionModel: 'CTMC',
  aminoAcidModel: 'AminoAcid', codonModel: 'Codon', yangCodonModel: 'YangCodon',
  frequencyModel: 'Frequencies',
  siteModel: 'SiteModel', gammaSiteModel: 'SiteModel', siteRateModel: 'SiteModel',
  constantSize: 'ConstantSize', exponentialGrowth: 'ExponentialGrowth',
  logisticGrowth: 'LogisticGrowth', expansion: 'Expansion',
  arbitraryBranchRates: 'ArbitraryBranchRates',
  strictClockBranchRates: 'StrictClock',
  discretizedBranchRates: 'DiscretizedBranchRates',
  randomLocalClockModel: 'RandomLocalClock', localClockModel: 'LocalClock',
  countableMixtureBranchRates: 'CountableMixture',
  compoundBranchRateModel: 'CompoundBranchRates',
  fixedEffects: 'FixedEffects',
  yuleModel: 'Yule', birthDeathModel: 'BirthDeath',
};

/** Names for the likelihood factors. */
const FACTOR_NAME = {
  treeDataLikelihood: 'PhyloCTMC', treeLikelihood: 'PhyloCTMC',
  ancestralTreeLikelihood: 'PhyloCTMC', markovJumpsTreeLikelihood: 'PhyloCTMC',
  coalescentLikelihood: 'Coalescent', speciationLikelihood: 'Speciation',
  gmrfSkyrideLikelihood: 'Skyride', gmrfSkyGridLikelihood: 'SkyGrid',
  multivariateTraitLikelihood: 'MultivariateTrait',
};

/* Where the algebra is the point rather than the component name, spell it
 * out.  Each entry is keyed on the element and guarded by its attributes, so
 * nothing is asserted that the XML does not say. */
function algebraicForm(n, parents, sym, bare) {
  const t = n.tag, a = n.attrs || {};
  if (t === 'arbitraryBranchRates') {
    const hasEffects = parents.some(p => p.tag === 'fixedEffects');
    const eps = parents.find(p => p.tag === 'parameter');
    const e = eps ? bare(eps.id) : 'ε';
    if (a.shrinkage === 'true' && hasEffects) {
      return {
        text: `rⱼ = ( Σₖ βₖ zⱼₖ ) · exp(${e}ⱼ)`,
        tex: `r_j = \\Bigl(\\sum_k \\beta_k z_{jk}\\Bigr)\\exp(\\${'epsilon'}_j)`,
        note: 'shrinkage="true": the fixed effects are additive on the real ' +
              'rate scale and multiply the exponentiated random effect.',
      };
    }
    if (a.exp === 'true') {
      return { text: `rⱼ = exp(${e}ⱼ)`, tex: `r_j = \\exp(\\epsilon_j)` };
    }
    return { text: `rⱼ = ${e}ⱼ`, tex: `r_j = \\epsilon_j` };
  }
  if (t === 'strictClockBranchRates') {
    const rate = parents[0];
    const r = rate ? bare(rate.id) : 'r';
    return { text: `rⱼ = ${r} for every branch j`, tex: `r_j = ${texOf(r)}` };
  }
  if (t === 'discretizedBranchRates') {
    return {
      text: 'rⱼ = F⁻¹( (cⱼ − ½) / n )',
      tex: 'r_j = F^{-1}\\!\\left(\\frac{c_j - 1/2}{n}\\right)',
      note: 'branch rates are the discretised quantiles of the parent ' +
            'distribution, indexed by the category assignment cⱼ.',
    };
  }
  return null;
}

// ---------------------------------------------------------------- build

export function buildNotation(model) {
  const byId = new Map(model.nodes.map(n => [n.id, n]));
  const live = n => n && !n.machinery;

  const parentsOf = new Map(model.nodes.map(n => [n.id, []]));
  const childrenOf = new Map(model.nodes.map(n => [n.id, []]));
  for (const e of model.edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    parentsOf.get(e.target).push(byId.get(e.source));
    childrenOf.get(e.source).push(byId.get(e.target));
  }

  // plate index letters, so replicated variables carry a subscript
  const index = new Map();
  for (const p of model.plates || []) {
    const letter = p.kind === 'tree' ? 'ⱼ' : 'ᵢ';
    for (const m of p.members) index.set(m, letter);
  }
  const texIndex = id => (index.get(id) === 'ⱼ' ? '_j'
                        : index.get(id) === 'ᵢ' ? '_i' : '');

  const bare = id => byId.get(id)?.label ?? id;
  const sym = id => {
    const n = byId.get(id);
    if (!n) return id;
    return n.label + (index.get(id) || '');
  };
  const symTex = id => {
    const n = byId.get(id);
    if (!n) return `\\mathrm{${escTex(id)}}`;
    return texOf(n.label) + texIndex(id);
  };

  const post = model.posterior || { prior: [], likelihood: [], densities: {} };

  // ---------------------------------------------------- terms of the product
  const terms = [];

  const factorTerm = (id, section) => {
    const f = byId.get(id);
    if (!f) return null;
    const dens = post.densities?.[id];
    const parents = (parentsOf.get(id) || []).filter(live);

    if (dens) {
      // "these parameters ~ this distribution"
      const subjects = dens.data.filter(d => byId.has(d));
      const args = dens.params.map(p =>
        p.ref ? sym(p.ref) : compact(p.value));
      const argsTex = dens.params.map(p =>
        p.ref ? symTex(p.ref) : compactTex(p.value));
      const given = dens.params.filter(p => p.ref).map(p => p.ref);
      return {
        section, id,
        lhs: subjects.map(sym).join(', '),
        lhsTex: subjects.map(symTex).join(', '),
        op: '~',
        rhs: `${dens.label}(${args.join(', ')})`,
        rhsTex: `\\mathrm{${escTex(dens.label)}}(${argsTex.join(', ')})`,
        subjects, given,
        source: id, element: f.tag,
      };
    }

    // the variable this factor is the density of: its clamped child, else the
    // tree it scores, else the factor itself
    const kids = (childrenOf.get(id) || []).filter(live);
    const clamped = kids.find(k => k.type === 'clamped');
    const treeParent = parents.find(p => p.tag === 'treeModel' || p.tag === 'speciesTree');
    const subject = clamped || treeParent || null;
    const given = parents.filter(p => p !== subject);
    const name = FACTOR_NAME[f.tag] || f.label;

    if (!subject) {
      return {
        section, id,
        lhs: `p(${parents.map(p => sym(p.id)).join(', ')})`,
        lhsTex: `p(${parents.map(p => symTex(p.id)).join(', ')})`,
        op: '=', rhs: name, rhsTex: `\\mathrm{${escTex(name)}}`,
        subjects: parents.map(p => p.id), given: [],
        source: id, element: f.tag,
      };
    }
    return {
      section, id,
      lhs: sym(subject.id),
      lhsTex: symTex(subject.id),
      op: '~',
      rhs: `${name}(${given.map(p => sym(p.id)).join(', ')})`,
      rhsTex: `\\mathrm{${escTex(name)}}(${given.map(p => symTex(p.id)).join(', ')})`,
      subjects: [subject.id], given: given.map(p => p.id),
      source: id, element: f.tag,
    };
  };

  const distTerm = (t, section) => {
    const args = t.args.map(([k, v]) => `${k} = ${compact(v)}`);
    const argsTex = t.args.map(([k, v]) => `\\mathrm{${escTex(k)}}=${compactTex(v)}`);
    const cond = t.given.filter(g => byId.has(g));
    const all = [...args, ...cond.map(sym)];
    const allTex = [...argsTex, ...cond.map(symTex)];
    return {
      section, id: t.target,
      lhs: sym(t.target),
      lhsTex: symTex(t.target),
      op: '~',
      rhs: all.length ? `${t.label}(${all.join(', ')})` : t.label,
      rhsTex: allTex.length
        ? `\\mathrm{${escTex(t.label)}}(${allTex.join(', ')})`
        : `\\mathrm{${escTex(t.label)}}`,
      subjects: [t.target], given: cond,
      source: t.dist, element: t.dist,
    };
  };

  for (const t of post.likelihood) {
    const term = t.kind === 'factor' ? factorTerm(t.id, 'likelihood')
                                     : distTerm(t, 'likelihood');
    if (term) terms.push(term);
  }
  for (const t of post.prior) {
    const term = t.kind === 'factor' ? factorTerm(t.id, 'prior')
                                     : distTerm(t, 'prior');
    if (term) terms.push(term);
  }

  // ---------------------------------------------------- the posterior line
  // List the sampled variables in model order — tree first, then the clock,
  // then the substitution process — rather than XML order.
  const MODULE_RANK = { tree: 0, branchRates: 1, rateMatrix: 2, siteRates: 3,
                        phyloCTMC: 4, data: 5, other: 6 };
  const sampled = model.nodes
    .filter(n => live(n) && n.type === 'stochastic')
    .sort((a, b) => (MODULE_RANK[a.module] ?? 9) - (MODULE_RANK[b.module] ?? 9) ||
                    (a.tag === 'treeModel' ? 0 : 1) - (b.tag === 'treeModel' ? 0 : 1) ||
                    a.id.localeCompare(b.id))
    .map(n => n.id);
  const observed = model.nodes.filter(n => live(n) && n.type === 'clamped').map(n => n.id);

  const factorStr = terms.map(t => probOf(t, sym)).join(' · ');
  const factorTexStr = terms.map(t => probTexOf(t, symTex)).join('\\,');

  const lhsVars = sampled.filter(id => !observed.includes(id));
  const posterior = {
    text: `p(${lhsVars.map(sym).join(', ')}${observed.length ? ' | ' + observed.map(sym).join(', ') : ''})` +
          `  ∝  ${factorStr}`,
    tex: `p\\bigl(${lhsVars.map(symTex).join(', ')}` +
         `${observed.length ? ' \\mid ' + observed.map(symTex).join(', ') : ''}\\bigr)` +
         ` \\propto ${factorTexStr}`,
  };

  // ---------------------------------------------------- deterministic nodes
  const deterministic = model.nodes
    .filter(n => live(n) && n.type === 'deterministic')
    .map(n => {
      const parents = (parentsOf.get(n.id) || []).filter(live);
      if (n.tag === 'maskedParameter') {
        const src = parents[0];
        const from = n.attrs.from, to = n.attrs.to;
        const span = from === to ? from : `${from}..${to}`;
        return {
          lhs: sym(n.id), lhsTex: symTex(n.id), op: ':=',
          rhs: src ? `${sym(src.id)}[${span}]` : `[${span}]`,
          rhsTex: src ? `${symTex(src.id)}_{${escTex(span)}}` : '',
          source: n.id, element: n.tag, form: null,
        };
      }
      const name = COMPONENT[n.tag] || n.tag;
      const form = algebraicForm(n, parents, sym, bare);
      const extra = [];
      if (n.attrs.gammaCategories) extra.push(`${n.attrs.gammaCategories} rate categories`);
      return {
        lhs: sym(n.id), lhsTex: symTex(n.id), op: ':=',
        rhs: `${name}(${parents.map(p => sym(p.id)).join(', ')})`,
        rhsTex: `\\mathrm{${escTex(name)}}(${parents.map(p => symTex(p.id)).join(', ')})`,
        source: n.id, element: n.tag, form, extra,
      };
    });

  // ---------------------------------------------------- constants
  const constants = model.nodes
    .filter(n => live(n) && n.type === 'constant' && !n.isHyper)
    .map(n => {
      // anonymous constants are labelled "slot = value"; split that apart
      const m = /^(.*?) = (.*)$/.exec(n.label);
      return {
        lhs: m ? m[1] : n.label,
        rhs: m ? m[2] : (n.value ?? 'BEAST default'),
        dim: n.dimension,
        source: n.anonymousUnder ? `in ${n.anonymousUnder}` : n.id,
      };
    });

  // ---------------------------------------------------- glossary
  // Factors are terms of the product, not variables, and are already named in
  // the likelihood and prior sections.
  const glossary = model.nodes
    .filter(n => live(n) && !n.isHyper &&
                 n.type !== 'constant' && n.type !== 'factor')
    .map(n => ({
      sym: sym(n.id), id: n.id, element: n.tag, type: n.type,
      plate: index.get(n.id) === 'ⱼ' ? 'per branch'
           : index.get(n.id) === 'ᵢ' ? 'per site' : '',
    }))
    .sort((a, b) => a.sym.localeCompare(b.sym));

  return {
    posterior, terms, deterministic, constants, glossary,
    found: post.found,
    latex: toLatex(posterior, terms, deterministic),
  };
}

// ---------------------------------------------------------------- helpers

function probOf(t, sym) {
  const given = t.given?.length ? ' | ' + t.given.map(sym).join(', ') : '';
  const subj = (t.subjects || []).map(sym).join(', ');
  return `p(${subj}${given})`;
}

function probTexOf(t, symTex) {
  const given = t.given?.length ? ' \\mid ' + t.given.map(symTex).join(', ') : '';
  const subj = (t.subjects || []).map(symTex).join(', ');
  return `p(${subj}${given})`;
}

function texOf(label) {
  if (TEX[label]) return TEX[label];
  const base = label.replace(/[ⱼᵢ]$/, '');
  if (TEX[base]) return TEX[base];
  return `\\mathrm{${escTex(label)}}`;
}

const escTex = s => String(s).replace(/([\\{}_$&%#^~])/g, '\\$1');

function compact(v) {
  if (v == null) return '';
  const x = Number(v);
  if (!Number.isFinite(x)) return String(v);
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e4 || a < 1e-3) return x.toExponential(0).replace('e+', 'e');
  return String(Number(x.toPrecision(4)));
}

/** 1e5 -> 10^{5}, so exported equations typeset properly. */
function compactTex(v) {
  const s = compact(v);
  const m = /^(-?)(\d(?:\.\d+)?)e(-?\d+)$/.exec(s);
  if (!m) return s;
  const [, sign, mant, exp] = m;
  return mant === '1' ? `${sign}10^{${exp}}` : `${sign}${mant}\\times10^{${exp}}`;
}

function toLatex(posterior, terms, deterministic) {
  const lines = [];
  lines.push('% Posterior factorisation');
  lines.push('\\begin{equation}');
  lines.push('  ' + posterior.tex);
  lines.push('\\end{equation}');
  lines.push('');
  lines.push('% Model statements');
  lines.push('\\begin{align}');
  const rows = [];
  for (const t of terms) rows.push(`  ${t.lhsTex} &\\sim ${t.rhsTex}`);
  for (const d of deterministic) {
    if (d.rhsTex) rows.push(`  ${d.lhsTex} &\\coloneqq ${d.rhsTex}`);
    if (d.form?.tex) rows.push(`  ${d.form.tex.replace('=', '&=')}`);
  }
  lines.push(rows.join(' \\\\\n'));
  lines.push('\\end{align}');
  return lines.join('\n');
}

// ---------------------------------------------------------------- rendering

const esc = s => String(s).replace(/[&<>]/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

export function renderNotation(note, el) {
  const stmt = (t, extra = '') => `
    <div class="row">
      <div class="stmt">
        <span class="lhs">${esc(t.lhs)}</span>
        <span class="op">${esc(t.op)}</span>
        <span class="rhs">${esc(t.rhs)}</span>
        <span class="src" title="${esc(t.element || '')}">${esc(t.source || '')}</span>
      </div>${extra}
    </div>`;

  const likelihood = note.terms.filter(t => t.section === 'likelihood');
  const prior = note.terms.filter(t => t.section === 'prior');

  el.innerHTML = `
  <div class="notation">

    <section>
      <h3>Posterior</h3>
      <div class="eq-wrap"><div class="eq">${esc(note.posterior.text)}</div></div>
      <p class="note">Read from the <code>&lt;joint&gt;</code> block of the XML:
        every factor below is one child of <code>&lt;prior&gt;</code> or
        <code>&lt;likelihood&gt;</code>, so this is the density the sampler
        actually targets.</p>
    </section>

    ${likelihood.length ? `<section>
      <h3>Likelihood</h3>
      <div class="stmts">${likelihood.map(t => stmt(t)).join('')}</div>
    </section>` : ''}

    ${prior.length ? `<section>
      <h3>Prior</h3>
      <div class="stmts">${prior.map(t => stmt(t)).join('')}</div>
    </section>` : ''}

    ${note.deterministic.length ? `<section>
      <h3>Deterministic</h3>
      <div class="stmts">${note.deterministic.map(d => stmt(d,
        (d.form ? `<div class="form">${esc(d.form.text)}${
          d.form.note ? `<span class="form-note">${esc(d.form.note)}</span>` : ''}</div>` : '') +
        ((d.extra && d.extra.length) ? `<div class="form">${esc(d.extra.join('; '))}</div>` : '')
      )).join('')}</div>
    </section>` : ''}

    ${note.constants.length ? `<section>
      <h3>Fixed values</h3>
      <div class="stmts">${note.constants.map(c => `
        <div class="row"><div class="stmt">
          <span class="lhs">${esc(c.lhs)}</span>
          <span class="op">=</span>
          <span class="rhs">${esc(c.rhs)}${c.dim ? ` <em>(dim ${esc(c.dim)})</em>` : ''}</span>
          <span class="src">${esc(c.source)}</span>
        </div></div>`).join('')}</div>
    </section>` : ''}

    <section>
      <h3>Symbols</h3>
      <table class="glossary">
        <thead><tr><th>Symbol</th><th>BEAST id</th><th>Element</th><th>Kind</th></tr></thead>
        <tbody>${note.glossary.map(g => `<tr>
          <td class="g-sym">${esc(g.sym)}</td>
          <td class="g-id">${esc(g.id)}</td>
          <td class="g-el">&lt;${esc(g.element)}&gt;</td>
          <td class="g-kind">${esc(g.type)}${g.plate ? `, ${esc(g.plate)}` : ''}</td>
        </tr>`).join('')}</tbody>
      </table>
    </section>

  </div>`;
}
