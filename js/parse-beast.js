/* BEAST X (beast-mcmc / BEAST 1.x) XML -> probabilistic graphical model DAG.
 *
 * Node types follow Hohna et al. 2014 Syst Biol 63:753-771:
 *   constant      square          fixed value, no parent
 *   stochastic    solid circle    random variable (has an operator and/or a prior)
 *   deterministic dashed circle   a function of its parents
 *   clamped       shaded circle   observed data
 *   factor        rounded rect    a likelihood / density term
 */

// ---------------------------------------------------------------- tag tables

// Structural / bookkeeping elements that are never graph nodes.
const SKIP_TAGS = new Set([
  'beast', 'taxa', 'taxon', 'date', 'sequence', 'attr', 'trait', 'attribute',
  'mcmc', 'operators', 'joint', 'prior', 'likelihood', 'posterior',
  'log', 'logTree', 'column', 'report', 'marginalLikelihoodEstimator',
  'pathSamplingAnalysis', 'steppingStoneSamplingAnalysis', 'insertionPoint',
  'generalDataType', 'state', 'alias', 'ambiguity', 'property',
  'logCheckpoint', 'loadCheckpoint', 'checkpoint',
]);

const PARAMETERISH = new Set([
  'parameter', 'maskedParameter', 'compoundParameter', 'transformedParameter',
  'duplicatedParameter', 'matrixParameter', 'diagonalMatrix', 'sumStatistic',
  'productStatistic', 'differenceStatistic', 'ratioStatistic',
  'tmrcaStatistic', 'treeHeightStatistic', 'treeLengthStatistic',
  'rateStatistic', 'statistic', 'monophylyStatistic',
]);

/** Wrapper elements that hold a treeModel's own internal state. */
const TREE_INTERNAL_SLOTS = new Set([
  'rootHeight', 'nodeHeights', 'leafHeight', 'leafHeights', 'nodeRates',
  'nodeTraits', 'leafTrait',
]);

const OBSERVED_TAGS = new Set([
  'alignment', 'patterns', 'mergePatterns', 'attributePatterns',
  'ascertainedPatterns', 'microsatellite', 'microsatellitePattern',
  'multiDimensionalScalingLikelihood', 'continuousTraitData',
]);

const TREE_TAGS = new Set([
  'treeModel', 'tree', 'newick', 'coalescentSimulator', 'upgmaTree',
  'neighborJoiningTree', 'rescaledTree', 'empiricalTreeDistributionModel',
  'speciesTree', 'starTreeModel', 'transmissionModel',
]);

const TREE_PRIOR_TAGS = new Set([
  'constantSize', 'exponentialGrowth', 'logisticGrowth', 'expansion',
  'gmrfSkyrideLikelihood', 'gmrfSkyGridLikelihood', 'skyGridLikelihood',
  'generalizedSkyLineLikelihood', 'piecewisePopulationModel', 'yuleModel',
  'birthDeathModel', 'birthDeathSerialSampling', 'speciationLikelihood',
  'coalescentLikelihood', 'multiSpeciesCoalescent', 'treeIntervals',
]);

const SUBST_TAGS = new Set([
  'hkyModel', 'gtrModel', 'tn93Model', 'jc69Model', 'binarySubstitutionModel',
  'generalSubstitutionModel', 'complexSubstitutionModel', 'aminoAcidModel',
  'empiricalAminoAcidModel', 'codonModel', 'yangCodonModel', 'mgCodonModel',
  'frequencyModel', 'substitutionModel', 'siteModel', 'gammaSiteModel',
  'siteRateModel',
]);

const CLOCK_TAGS = new Set([
  'strictClockBranchRates', 'discretizedBranchRates', 'arbitraryBranchRates',
  'randomLocalClockModel', 'localClockModel', 'countableMixtureBranchRates',
  'mixedEffectsBranchRates', 'autoCorrelatedBranchRates', 'fixedEffects',
  'relaxedClock', 'compoundBranchRateModel', 'scaledBranchRates',
]);

// Deterministic transformations / logged summaries.
const STATISTIC_TAGS = new Set([
  'tmrcaStatistic', 'treeHeightStatistic', 'treeLengthStatistic',
  'rateStatistic', 'rateCovarianceStatistic', 'monophylyStatistic',
  'statistic', 'maskedParameter', 'compoundParameter', 'sumStatistic',
  'productStatistic', 'differenceStatistic', 'ratioStatistic',
  'negativeStatistic', 'exponentialStatistic', 'logarithmStatistic',
  'matrixInverse', 'transformedParameter', 'differenceMatrixParameter',
  'varianceStatistic', 'continuousDiffusionStatistic', 'nodeHeightsStatistic',
  'parameterChooser', 'duplicatedParameter',
]);

// Likelihood / density terms -> factor nodes.
const FACTOR_TAGS = new Set([
  'treeDataLikelihood', 'treeLikelihood', 'ancestralTreeLikelihood',
  'markovJumpsTreeLikelihood', 'sequenceErrorModel', 'coalescentLikelihood',
  'speciationLikelihood', 'distributionLikelihood', 'booleanLikelihood',
  'multivariateTraitLikelihood', 'traitDataLikelihood',
  'gmrfSkyrideLikelihood', 'gmrfSkyGridLikelihood',
  'multivariateDistributionLikelihood', 'gradient', 'branchRateGradient',
  'jointGradient', 'hessian', 'compoundLikelihood', 'mixedDistributionLikelihood',
]);

// Inference machinery, not part of the generative model.
const MACHINERY_TAGS = new Set([
  'gradient', 'branchRateGradient', 'jointGradient', 'hessian',
  'coalescentSimulator', 'upgmaTree', 'neighborJoiningTree',
]);

// Distribution tags that act as priors when wrapped in a
// <distributionLikelihood>.  *Prior elements are listed alongside
// the *DistributionModel elements that BEAST X uses interchangeably
// for the same role (e.g. <logNormalPrior> == <logNormalDistributionModel>).
// The compoundParameter pattern in the Bletsa mixed-effects clock uses
// <expGammaDistributionModel> for the background rate, which is why the
// set has to be wider than the *Prior tags alone.
const PRIOR_TAGS = new Set([
  'logNormalPrior', 'normalPrior', 'exponentialPrior', 'gammaPrior',
  'uniformPrior', 'laplacePrior', 'betaPrior', 'poissonPrior', 'cauchyPrior',
  'invgammaPrior', 'inverseGammaPrior', 'oneOnXPrior', 'ctmcScalePrior',
  'dirichletPrior', 'halfTPrior', 'halfNormalPrior', 'multivariateNormalPrior',
  'logNormalDistributionModel',
  'normalDistributionModel', 'exponentialDistributionModel', 'gammaDistributionModel',
  'expGammaDistributionModel', 'inverseGammaDistributionModel',
  'invGammaDistributionModel', 'laplaceDistributionModel',
  'uniformDistributionModel', 'betaDistributionModel', 'onePGammaDistributionModel',
  'scaledBetaDistributionModel', 'multivariateNormalDistributionModel',
  'poissonDistributionModel', 'cauchyDistributionModel', 'halfNormalDistributionModel',
  'halfCauchyDistributionModel', 'halfTPriorDistributionModel',
  'dirichletDistributionModel',
]);

// Compact glyphs for the hyperparameter squares.
const SHORT_DIST = {
  logNormalPrior: 'LogN', normalPrior: 'N', exponentialPrior: 'Exp',
  gammaPrior: 'Γ', uniformPrior: 'U', laplacePrior: 'Laplace',
  betaPrior: 'Beta', poissonPrior: 'Pois', cauchyPrior: 'Cauchy',
  invgammaPrior: 'InvΓ', inverseGammaPrior: 'InvΓ', oneOnXPrior: '1/x',
  ctmcScalePrior: 'CTMC', dirichletPrior: 'Dir', halfTPrior: 'Half-t',
  halfNormalPrior: 'HalfN', multivariateNormalPrior: 'MVN',
  expGammaDistributionModel: 'ExpΓ', inverseGammaDistributionModel: 'InvΓ',
  invGammaDistributionModel: 'InvΓ', laplaceDistributionModel: 'Laplace',
  halfNormalDistributionModel: 'HalfN', halfCauchyDistributionModel: 'HalfCauchy',
  halfTPriorDistributionModel: 'Half-t', poissonDistributionModel: 'Pois',
  cauchyDistributionModel: 'Cauchy', dirichletDistributionModel: 'Dir',
};

// Pretty names for prior distributions.
const PRIOR_LABEL = {
  logNormalPrior: 'LogNormal', normalPrior: 'Normal', exponentialPrior: 'Exponential',
  gammaPrior: 'Gamma', uniformPrior: 'Uniform', laplacePrior: 'Laplace',
  betaPrior: 'Beta', poissonPrior: 'Poisson', cauchyPrior: 'Cauchy',
  invgammaPrior: 'InvGamma', inverseGammaPrior: 'InvGamma', oneOnXPrior: '1/x',
  ctmcScalePrior: 'CTMCScale', dirichletPrior: 'Dirichlet', halfTPrior: 'Half-t',
  halfNormalPrior: 'HalfNormal', multivariateNormalPrior: 'MVN',
  logNormalDistributionModel: 'LogNormal', normalDistributionModel: 'Normal',
  exponentialDistributionModel: 'Exponential', gammaDistributionModel: 'Gamma',
  expGammaDistributionModel: 'ExpGamma',
  inverseGammaDistributionModel: 'InverseGamma',
  invGammaDistributionModel: 'InverseGamma',
  laplaceDistributionModel: 'Laplace', uniformDistributionModel: 'Uniform',
  betaDistributionModel: 'Beta', onePGammaDistributionModel: '1/Γ',
  scaledBetaDistributionModel: 'ScaledBeta',
  multivariateNormalDistributionModel: 'MVN',
  poissonDistributionModel: 'Poisson', cauchyDistributionModel: 'Cauchy',
  halfNormalDistributionModel: 'HalfNormal',
  halfCauchyDistributionModel: 'HalfCauchy',
  halfTPriorDistributionModel: 'Half-t',
  dirichletDistributionModel: 'Dirichlet',
};

// Module assignment, in priority order (first match wins).
const MODULE_RULES = [
  ['phyloCTMC', t => t === 'treeDataLikelihood' || t === 'treeLikelihood' ||
                     t === 'ancestralTreeLikelihood' || t === 'markovJumpsTreeLikelihood'],
  ['data', t => OBSERVED_TAGS.has(t)],
  ['branchRates', t => CLOCK_TAGS.has(t)],
  ['tree', t => TREE_TAGS.has(t) || TREE_PRIOR_TAGS.has(t)],
  ['siteRates', t => t === 'siteModel' || t === 'gammaSiteModel' || t === 'siteRateModel'],
  ['rateMatrix', t => SUBST_TAGS.has(t)],
];

const MODULE_META = {
  tree:        { label: 'Tree',         order: 0 },
  rateMatrix:  { label: 'Rate matrix',  order: 1 },
  siteRates:   { label: 'Site rates',   order: 2 },
  branchRates: { label: 'Branch rates', order: 3 },
  phyloCTMC:   { label: 'PhyloCTMC',    order: 4 },
  data:        { label: 'Data',         order: 5 },
  other:       { label: 'Other',        order: 6 },
};

// ---------------------------------------------------------------- helpers

const isElement = n => n.nodeType === 1;
const tagOf = el => el.tagName;

function attrsOf(el) {
  const out = {};
  for (const a of el.attributes) out[a.name] = a.value;
  return out;
}

/** Trim a long value string (e.g. a 98-dim vector) for display. */
function shortValue(v, max = 40) {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, ' ');
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/* The glyph drawn inside a node.  Graphical models are only readable when the
 * shapes carry short symbols, as the paper argues, so map BEAST's element and
 * parameter names onto the conventional notation. */
const SYMBOL_BY_TAG = {
  treeModel: 'Ψ', speciesTree: 'Ψₛ', starTreeModel: 'Ψ',
  hkyModel: 'Q', gtrModel: 'Q', tn93Model: 'Q', jc69Model: 'Q',
  generalSubstitutionModel: 'Q', complexSubstitutionModel: 'Q',
  aminoAcidModel: 'Q', empiricalAminoAcidModel: 'Q', codonModel: 'Q',
  yangCodonModel: 'Q', mgCodonModel: 'Q', substitutionModel: 'Q',
  frequencyModel: 'π',
  siteModel: 'M', gammaSiteModel: 'M', siteRateModel: 'M',
  arbitraryBranchRates: 'r', discretizedBranchRates: 'r',
  strictClockBranchRates: 'r', randomLocalClockModel: 'r',
  localClockModel: 'r', countableMixtureBranchRates: 'r',
  compoundBranchRateModel: 'r', autoCorrelatedBranchRates: 'r',
  fixedEffects: 'Z',
  constantSize: 'N(t)', exponentialGrowth: 'N(t)', logisticGrowth: 'N(t)',
  expansion: 'N(t)', piecewisePopulationModel: 'N(t)',
  alignment: 'D', patterns: 'D', mergePatterns: 'D',
  yuleModel: 'BD', birthDeathModel: 'BD',
};

const SYMBOL_BY_NAME = {
  kappa: 'κ', alpha: 'α', beta: 'β', frequencies: 'π', mu: 'μ',
  theta: 'θ', sigma: 'σ', lambda: 'λ', gamma: 'γ', omega: 'ω',
  popsize: 'Nₑ', populationsize: 'Nₑ', growthrate: 'g', doublingtime: 'g',
  rootheight: 't₀', clockrate: 'r', meanrate: 'r̄', rates: 'ε',
  stdev: 'σ', sd: 'σ', mean: 'μ', intercept: 'β₀', increment: 'β₁',
  ucld: 'r', skygrid: 'Nₑ', precision: 'τ',
};

function displayLabel(id, tag, el) {
  if (SYMBOL_BY_TAG[tag]) return SYMBOL_BY_TAG[tag];
  if (!id) return tag;
  // Factors are drawn as wide boxes, so they carry their full name.
  if (FACTOR_TAGS.has(tag)) return id.length > 22 ? id.slice(0, 21) + '…' : id;
  const leaf = id.includes('.') ? id.split('.').pop() : id;
  const key = leaf.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SYMBOL_BY_NAME[key]) return SYMBOL_BY_NAME[key];
  /* If the leaf is a numeric index (Kappa.1, beta.hyper.2), fall
   * back to the parent name.  This makes "Kappa.1" and "Kappa.2"
   * both render as κ instead of as 1 and 2.  The disambiguation
   * pass below adds the right subscripts. */
  if (/^\d+$/.test(leaf) && id.includes('.')) {
    const parent = id.split('.').slice(0, -1).join('.');
    const pkey = parent.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (SYMBOL_BY_NAME[pkey]) return SYMBOL_BY_NAME[pkey];
  }
  // a <parameter> takes the name of the slot it fills, e.g. <kappa><parameter/>
  if (tag === 'parameter' && el?.parentElement) {
    const slot = el.parentElement.tagName.toLowerCase();
    if (SYMBOL_BY_NAME[slot]) return SYMBOL_BY_NAME[slot];
  }
  return leaf.length > 10 ? leaf.slice(0, 9) + '…' : leaf;
}

/* Subscripts for the few symbol classes where PhyloPlate draws
 * multi-letter symbols (κ, β, π, …) and a number suffix would
 * be ambiguous.  The viewer reuses these across the diagram and
 * notation; matching a common mathematical convention means the
 * number sits on the same baseline. */
const SUBSCRIPTS = ['₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];

/* When several nodes share the same display label (e.g. part1.kappa
 * and part2.kappa both render as κ), give each a unique subscript.
 * Each node's subscript is derived from its id: a trailing number
 * (Kappa.1, beta.hyper.2) or a leading partition name (part1,
 * partition2, site3) becomes the numeric index, with any
 * remaining ties broken by a counter so the subscripts never
 * collide.  Nodes whose labels do not collide are left alone. */
function disambiguateLabels(nodes) {
  /* Group node ids by the label they were assigned.  Hyperparameter
   * squares, machinery (logged-only statistics, gradients), and
   * clamped data are excluded — they have their own naming rules
   * and never collide with a parameter symbol. */
  const groups = new Map();
  for (const n of nodes.values()) {
    if (n.isHyper || n.machinery || n.type === 'clamped' ||
        n.type === 'factor' || !n.id) continue;
    const tag = n.tag;
    if (SYMBOL_BY_TAG[tag]) continue;
    if (!groups.has(n.label)) groups.set(n.label, []);
    groups.get(n.label).push(n);
  }
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    /* Sort by id so the subscripts are stable across renders. */
    list.sort((a, b) => a.id.localeCompare(b.id));
    /* Try to derive a numeric index for each id.  When the id
     * carries an explicit number, use it; otherwise keep an
     * in-order counter.  If two nodes would land on the same
     * subscript we keep nudging the later one until it's free. */
    const used = new Set();
    let counter = 1;
    for (const n of list) {
      let idx = pickSubscript(n.id);
      if (idx == null) idx = counter;
      while (used.has(idx)) idx++;
      used.add(idx);
      if (idx >= 1 && idx <= SUBSCRIPTS.length) {
        n.label = n.label + SUBSCRIPTS[idx - 1];
      } else {
        /* Beyond nine same-labelled nodes fall back to a numeric
         * suffix; the symbol table only has ₁-₉. */
        n.label = n.label + idx.toString();
      }
      counter = Math.max(counter, idx + 1);
    }
  }
}

/* Derive a subscript index from a node id.  Look for a trailing
 * numeric component (Kappa.1 -> 0) first, then a leading partition
 * name (part1.kappa -> 0, part2.kappa -> 1), and finally fall back
 * to the position index.  Returns null when no sensible index can
 * be inferred, in which case the caller uses a counter. */
function pickSubscript(id) {
  const parts = id.split('.');
  /* trailing number: Kappa.1, beta.hyper.2 */
  const tail = parts[parts.length - 1];
  if (/^\d+$/.test(tail)) {
    const n = Number(tail);
    if (n >= 1 && n <= SUBSCRIPTS.length) return n;
  }
  /* leading partition: part1.kappa */
  const head = parts[0];
  const m = /^(?:part|partition|site|gene|codon|copy)(\d+)$/i.exec(head);
  if (m) {
    const n = Number(m[1]);
    if (n >= 1 && n <= SUBSCRIPTS.length) return n;
  }
  /* numeric anywhere in the id: part_1_kappa, kappa1, k1 */
  const anyNum = /(?:^|[^\d])(\d+)$/.exec(id);
  if (anyNum) {
    const n = Number(anyNum[1]);
    if (n >= 1 && n <= SUBSCRIPTS.length) return n;
  }
  return null;
}

/** 1.0E5 -> 1e5, 0.3333333333 -> 0.333 */
function compactNumber(v) {
  const x = Number(v);
  if (!Number.isFinite(x)) return String(v);
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e4 || a < 1e-3) return x.toExponential(0).replace('e+', 'e');
  return String(Number(x.toPrecision(3)));
}

// ---------------------------------------------------------------- main parse

export function parseBeastXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('XML is not well-formed: ' + err.textContent.trim().split('\n')[0]);

  const root = doc.documentElement;
  if (root.tagName !== 'beast') {
    throw new Error(`Root element is <${root.tagName}>, expected <beast>. ` +
      'This viewer reads BEAST X / BEAST 1.x XML (beast-mcmc), not BEAST2.');
  }
  // Both dialects use <beast>, so tell them apart before producing a graph
  // that is silently almost empty.
  if (/^2\./.test(root.getAttribute('version') || '') ||
      root.hasAttribute('namespace') ||
      doc.getElementsByTagName('run').length ||
      doc.querySelector('[spec]')) {
    throw new Error('This looks like a BEAST2 XML (it uses spec="…" / <run> / ' +
      'a namespace attribute). PhyloPlate reads the BEAST X / BEAST 1.x ' +
      'dialect produced by BEAUti v10, which names its components with ' +
      'elements such as <treeModel> and <treeDataLikelihood>.');
  }

  const meta = {
    version: root.getAttribute('version') || 'unknown',
    generator: firstCommentMatching(doc, /Generated by (.+?)\s*-->|Generated by (.+)/i),
  };

  // ---- index every element carrying an id
  const byId = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    const id = el.getAttribute('id');
    if (id && !byId.has(id)) byId.set(id, el);
  }

  // ---- which parameters does an operator move?  those are sampled.
  const sampled = new Set();
  const operatorsOf = new Map(); // id -> [{tag, attrs}]
  for (const ops of doc.getElementsByTagName('operators')) {
    for (const op of ops.children) {
      if (!isElement(op)) continue;
      for (const ref of refsUnder(op)) {
        sampled.add(ref);
        if (!operatorsOf.has(ref)) operatorsOf.set(ref, []);
        operatorsOf.get(ref).push({ tag: tagOf(op), attrs: attrsOf(op) });
      }
    }
  }

  // ---- prior block: distribution -> target parameter
  const priorsOf = new Map(); // targetId -> [{dist, label, attrs}]
  for (const el of doc.getElementsByTagName('*')) {
    if (!PRIOR_TAGS.has(tagOf(el))) continue;
    // A prior targets a variable, not the structural arguments it is
    // conditioned on: <ctmcScalePrior> names both its parameter and the tree.
    //
    // <expGammaDistributionModel> and other *DistributionModel elements
    // don't carry the target idref themselves; the target sits in the
    // sibling <data> block of the parent <distributionLikelihood>.  Walk
    // up to the wrapping <distribution> and grab the parent likelihood's
    // <data> idrefs when present.
    //
    // Factor form: <prior><*Prior/><parameter idref="…"/></prior> — the
    // distribution and the parameter are siblings inside a <prior>
    // wrapper, so the target idref is not a descendant of the
    // distribution.  Look at the wrapping <prior>'s <parameter idref>
    // children.
    let targets = refsUnder(el)
      .filter(r => byId.has(r) && PARAMETERISH.has(tagOf(byId.get(r))));
    if (!targets.length) {
      const parent = el.parentElement;
      if (parent && tagOf(parent) === 'distribution') {
        const dl = parent.parentElement;
        if (dl && tagOf(dl) === 'distributionLikelihood') {
          targets = refsUnder(dl)
            .filter(r => byId.has(r) && PARAMETERISH.has(tagOf(byId.get(r))));
        }
      } else if (parent && tagOf(parent) === 'prior') {
        /* Factor form: distribution and target are siblings inside a
         * <prior> wrapper.  Walk the wrapper's direct children for a
         * <parameter idref="…"> sibling of the distribution. */
        targets = [];
        for (const sib of parent.children) {
          if (!isElement(sib)) continue;
          const r = sib.getAttribute('idref');
          if (r && byId.has(r) && PARAMETERISH.has(tagOf(byId.get(r)))) {
            targets.push(r);
          }
        }
      }
    }
    for (const t of targets) {
      if (!priorsOf.has(t)) priorsOf.set(t, []);
      priorsOf.get(t).push({
        dist: tagOf(el),
        label: PRIOR_LABEL[tagOf(el)] || tagOf(el),
        attrs: distAttrs(el),
      });
    }
  }

  // ---- <patterns> is a view of its alignment, not a separate variable
  const alias = new Map();
  for (const p of doc.getElementsByTagName('*')) {
    if (!['patterns', 'mergePatterns', 'attributePatterns', 'ascertainedPatterns']
        .includes(tagOf(p))) continue;
    const pid = p.getAttribute('id');
    if (!pid) continue;
    const alns = [...p.getElementsByTagName('alignment')]
      .map(a => a.getAttribute('idref') || a.getAttribute('id')).filter(Boolean);
    if (alns.length === 1 && byId.has(alns[0])) alias.set(pid, alns[0]);
  }
  const canon = id => {
    let seen = 0;
    while (alias.has(id) && seen++ < 8) id = alias.get(id);
    return id;
  };

  // How often each id is referenced from outside a <log> block; used to spot
  // statistics that exist only to be logged.
  const refsOutsideLogs = countRefsOutsideLogs(doc);

  // ---- collect graph nodes
  const nodes = new Map();

  function addNode(el, id) {
    if (nodes.has(id)) return nodes.get(id);
    const tag = tagOf(el);
    const attrs = attrsOf(el);
    const n = {
      id,
      tag,
      attrs,
      label: displayLabel(id, tag, el),
      caption: id,
      type: classify(el, id, sampled, priorsOf),
      module: moduleOf(el, id),
      machinery: MACHINERY_TAGS.has(tag) ||
                 (STATISTIC_TAGS.has(tag) && !refsOutsideLogs.has(id)),
      priors: priorsOf.get(id) || [],
      operators: operatorsOf.get(id) || [],
      role: roleOf(el),
      value: shortValue(attrs.value),
      dimension: attrs.dimension || null,
      xmlLine: null,
      el,
    };
    nodes.set(id, n);
    return n;
  }

  for (const [id, el] of byId) {
    if (SKIP_TAGS.has(tagOf(el))) continue;
    if (PRIOR_TAGS.has(tagOf(el)) && !FACTOR_TAGS.has(tagOf(el))) continue;
    if (isTreeInternal(el)) continue;   // node heights are part of the tree itself
    if (alias.has(id)) continue;        // folded into its alignment
    addNode(el, id);
  }

  // Tree-internal parameters that have priors need nodes so hyperparameters can target them
  for (const targetId of priorsOf.keys()) {
    if (!nodes.has(targetId)) {
      const el = byId.get(targetId);
      if (el) addNode(el, targetId);
    }
  }

  // Anonymous <parameter> with a fixed value inside a model component:
  // these are the constant nodes of Fig. 2 (e.g. the mean of a Normal).
  let anon = 0;
  for (const p of doc.getElementsByTagName('parameter')) {
    if (p.getAttribute('id') || p.getAttribute('idref')) continue;
    if (!p.hasAttribute('value')) continue;
    const host = nearestNodeAncestor(p, nodes, byId, false, canon);
    if (!host) continue;
    const wrapper = p.parentElement ? tagOf(p.parentElement) : 'value';
    const id = `__const${anon++}`;
    nodes.set(id, {
      id, tag: 'parameter', attrs: attrsOf(p),
      label: `${wrapper} = ${shortValue(p.getAttribute('value'), 10)}`,
      caption: null,
      type: 'constant', module: host.module, machinery: false,
      priors: [], operators: [], role: `fixed ${wrapper} of <${host.tag}>`,
      value: shortValue(p.getAttribute('value')), dimension: null,
      anonymousUnder: host.id, el: p,
    });
  }

  // Hyperparameter nodes: one square per prior, per Fig. 7a-d.
  let hp = 0;
  for (const [target, list] of priorsOf) {
    const tn = nodes.get(target);
    if (!tn) continue;
    for (const pr of list) {
      const parts = Object.entries(pr.attrs)
        .filter(([k, v]) => !['id', 'idref'].includes(k) &&
                            !(k === 'offset' && Number(v) === 0));
      const id = `__hyper${hp++}`;
      const args = parts.map(([, v]) => compactNumber(v)).join(', ');
      nodes.set(id, {
        id, tag: pr.dist, attrs: pr.attrs,
        label: args ? `${SHORT_DIST[pr.dist] || pr.label}(${args})`
                    : (SHORT_DIST[pr.dist] || pr.label),
        caption: null,
        type: 'constant', module: tn.module, machinery: false,
        priors: [], operators: [],
        role: `prior on ${target}: ${pr.label}` +
              (parts.length ? ' with ' + parts.map(([k, v]) => `${k}=${v}`).join(', ') : ''),
        value: null, dimension: null, isHyper: true, hyperTarget: target, el: null,
      });
    }
  }

  // ---- edges: every identified descendant points into its containing node
  const edges = [];
  const seen = new Set();

  function addEdge(from, to, kind) {
    if (!from || !to || from === to) return;
    if (!nodes.has(from) || !nodes.has(to)) return;
    const key = `${from} ${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ source: from, target: to, kind: kind || 'solid' });
  }

  // One pass over the document, not one per node: walking every node's whole
  // subtree is quadratic, and on a large alignment that hangs the browser.
  // Each identified element contributes exactly one edge, into whichever node
  // encloses it, so finding that ancestor once is enough.
  for (const d of doc.getElementsByTagName('*')) {
    const ref = d.getAttribute('idref');
    const own = d.getAttribute('id');
    if (!ref && !own) continue;
    const child = canon(ref || own);
    if (!child || !nodes.has(child)) continue;
    const host = nearestNodeAncestor(d, nodes, byId, /*skipSelf=*/true, canon);
    if (!host || host.isHyper) continue;
    // An alignment named inside a substitution model only supplies the data
    // type and empirical frequencies; it is not a generative dependency.
    if (nodes.get(child).type === 'clamped' && SUBST_TAGS.has(host.tag)) continue;
    addEdge(child, host.id, host.type === 'deterministic' ? 'dashed' : 'solid');
  }

  // Observed data is generated by the phylogenetic likelihood, so it hangs
  // below it as a clamped node (Fig. 8b), not above it as an input.
  for (const e of edges) {
    const s = nodes.get(e.source), t = nodes.get(e.target);
    if (s?.type === 'clamped' && t?.module === 'phyloCTMC') {
      e.source = t.id; e.target = s.id;
    }
  }

  // anonymous constants and hyperparameters
  for (const [id, n] of nodes) {
    if (n.anonymousUnder) addEdge(id, n.anonymousUnder, 'solid');
    if (n.isHyper) addEdge(id, n.hyperTarget, 'solid');
  }

  // A distributionLikelihood is the density of its <data> parameter: draw the
  // parameter as the child of the density's own parameters, not the reverse.
  for (const dl of doc.getElementsByTagName('distributionLikelihood')) {
    const id = dl.getAttribute('id');
    if (!id || !nodes.has(id)) continue;
    const dataRefs = [...(dl.getElementsByTagName('data')[0]?.getElementsByTagName('*') || [])]
      .map(e => e.getAttribute('idref')).filter(r => r && nodes.has(r));
    for (const r of dataRefs) {
      // flip: remove r -> id, add id -> r
      const i = edges.findIndex(e => e.source === r && e.target === id);
      if (i >= 0) edges.splice(i, 1);
      seen.delete(`${r} ${id}`);
      addEdge(id, r, 'solid');
    }
  }

  // ---- refine module and machinery flags using the graph
  propagateModules(nodes, edges);
  propagateMachinery(nodes, edges, posteriorClosure(doc, nodes, edges));

  // ---- disambiguate colliding labels so e.g. part1.kappa and
  //      part2.kappa become κ₁ and κ₂ in both the diagram and the
  //      notation.  This must run after propagateMachinery so the
  //      final set of visible nodes is fixed.
  disambiguateLabels(nodes);

  // ---- plates
  const plates = detectPlates(nodes, edges);

  // ---- how BEAST itself factorises the posterior
  const posterior = readPosterior(doc, nodes, canon);

  // ---- record source line numbers for the tooltips
  annotateLines(text, nodes, doc);

  // ---- source-line click targets: every prior, operator, <mcmc>,
  //      <log>, and <logTree> with its line range and a (tag, target, i)
  //      triple that maps to a row in the McmcEditor sidebar.
  const lineTargets = buildLineTargets(doc, text);

  return {
    meta,
    source: text,
    nodes: [...nodes.values()].map(({ el, ...rest }) => rest),
    edges,
    plates,
    posterior,
    stats: summarise(nodes, doc),
    lineTargets,
  };
}

// ---------------------------------------------------------------- posterior

/* BEAST spells the factorisation out in the XML: <joint> holds a <prior> and a
 * <likelihood>, and each of their children is one term of the product.  Read
 * that structure rather than inferring it, so the notation view reflects what
 * the sampler actually targets. */
function readPosterior(doc, nodes, canon) {
  const out = { prior: [], likelihood: [], found: false };

  const block = name => {
    const els = [...doc.getElementsByTagName(name)];
    // the one inside <joint>/<mcmc>, not a nested reference
    return els.find(e => e.getAttribute('id')) || els[0] || null;
  };

  const readTerms = (el, into) => {
    if (!el) return;
    for (const child of el.children) {
      const tag = tagOf(child);
      const ref = child.getAttribute('idref');
      /* Factor form: <prior><*Prior/><parameter idref="…"/></prior>.
       * BEAST nests priors so a prior block can group several priors
       * together (e.g. one per parameter).  Recurse into the wrapper
       * so each distribution shows up as its own term — but only for
       * the distribution children; the sibling <parameter idref="…">
       * is the prior's target, not a separate factor. */
      if (tag === 'prior') { readTermsPrior(child, into); continue; }
      if (ref) {
        const id = canon(ref);
        if (nodes.has(id)) into.push({ kind: 'factor', id });
        continue;
      }
      if (!PRIOR_TAGS.has(tag)) continue;
      /* Target lookup: the parameter idref can be a descendant of the
       * distribution (direct form), or a sibling inside a <prior>
       * wrapper (factor form).  Try descendant first, fall back to
       * walking up to the wrapping <prior> and grabbing idrefs from
       * its children. */
      let targets = refsUnder(child)
        .map(canon)
        .filter(r => nodes.has(r) && PARAMETERISH.has(nodes.get(r).tag));
      if (!targets.length) {
        const parent = child.parentElement;
        if (parent && tagOf(parent) === 'prior') {
          targets = [...parent.children]
            .map(c => canon(c.getAttribute('idref')))
            .filter(r => r && nodes.has(r) &&
                         PARAMETERISH.has(nodes.get(r).tag));
        }
      }
      const conds = refsUnder(child)
        .map(canon)
        .filter(r => nodes.has(r) && !PARAMETERISH.has(nodes.get(r).tag));
      for (const t of targets) {
        into.push({
          kind: 'dist',
          target: t,
          dist: tag,
          label: PRIOR_LABEL[tag] || tag,
          given: conds,
          /* Use distAttrs so *DistributionModel priors (which nest
           * shape/scale/mean/stdev under child elements) are
           * rendered with their hyperparameters — not just the
           * top-level attributes the *Prior form would expose. */
          args: Object.entries(distAttrs(child))
            .filter(([k, v]) => !['id', 'idref'].includes(k) &&
                                !(k === 'offset' && Number(v) === 0)),
        });
      }
    }
  };

  /* Like readTerms but called on a <prior> wrapper (factor form).
   * Iterates only the distribution children of the wrapper and skips
   * the <parameter idref="…"> siblings — those are the prior's
   * targets, not separate factors. */
  const readTermsPrior = (wrapper, into) => {
    if (!wrapper) return;
    for (const child of wrapper.children) {
      const tag = tagOf(child);
      if (tag === 'prior') { readTermsPrior(child, into); continue; }
      if (!PRIOR_TAGS.has(tag)) continue;
      let targets = refsUnder(child)
        .map(canon)
        .filter(r => nodes.has(r) && PARAMETERISH.has(nodes.get(r).tag));
      if (!targets.length) {
        targets = [...wrapper.children]
          .map(c => canon(c.getAttribute('idref')))
          .filter(r => r && nodes.has(r) &&
                       PARAMETERISH.has(nodes.get(r).tag));
      }
      const conds = refsUnder(child)
        .map(canon)
        .filter(r => nodes.has(r) && !PARAMETERISH.has(nodes.get(r).tag));
      for (const t of targets) {
        into.push({
          kind: 'dist',
          target: t,
          dist: tag,
          label: PRIOR_LABEL[tag] || tag,
          given: conds,
          /* Use distAttrs for both the *Prior and *DistributionModel
           * layouts so the notation lists the hyperparameters. */
          args: Object.entries(distAttrs(child))
            .filter(([k, v]) => !['id', 'idref'].includes(k) &&
                                !(k === 'offset' && Number(v) === 0)),
        });
      }
    }
  };

  const prior = block('prior');
  const like = block('likelihood');
  readTerms(prior, out.prior);
  readTerms(like, out.likelihood);
  out.found = out.prior.length > 0 || out.likelihood.length > 0;

  // A <distributionLikelihood> is "these parameters ~ this distribution";
  // unpack it so the notation can print the statement rather than a name.
  out.densities = {};
  for (const dl of doc.getElementsByTagName('distributionLikelihood')) {
    const id = dl.getAttribute('id');
    if (!id || !nodes.has(id)) continue;
    const data = [...(dl.getElementsByTagName('data')[0]?.children || [])]
      .map(e => canon(e.getAttribute('idref') || e.getAttribute('id')))
      .filter(r => r && nodes.has(r));
    const dwrap = dl.getElementsByTagName('distribution')[0];
    const dm = dwrap && [...dwrap.children].find(c => PRIOR_TAGS.has(tagOf(c)));
    if (!dm) continue;
    out.densities[id] = {
      data,
      dist: tagOf(dm),
      label: PRIOR_LABEL[tagOf(dm)] || tagOf(dm),
      params: [...dm.children].filter(isElement).map(slot => {
        /* BEAST X uses two layouts: a named <parameter> child, or
         * the slot's own text content.  Accept either. */
        const p = slot.getElementsByTagName('parameter')[0];
        const ref = p && canon(p.getAttribute('idref') || p.getAttribute('id') || '');
        return {
          slot: tagOf(slot),
          ref: ref && nodes.has(ref) ? ref : null,
          value: p ? p.getAttribute('value') :
                   ((slot.textContent || '').trim() || null),
        };
      }),
    };
  }

  return out;
}

// ---------------------------------------------------------------- classifiers

function classify(el, id, sampled, priorsOf) {
  const tag = tagOf(el);
  if (OBSERVED_TAGS.has(tag)) return 'clamped';
  if (FACTOR_TAGS.has(tag)) return 'factor';
  if (STATISTIC_TAGS.has(tag)) return 'deterministic';
  if (SUBST_TAGS.has(tag) || CLOCK_TAGS.has(tag)) return 'deterministic';
  if (TREE_TAGS.has(tag)) return 'stochastic';
  if (TREE_PRIOR_TAGS.has(tag)) return 'deterministic';
  if (tag === 'parameter') {
    if (sampled.has(id) || priorsOf.has(id)) return 'stochastic';
    // Nothing moves it and nothing constrains it, so its value is fixed —
    // e.g. base frequencies left at their default in a frequencyModel.
    return 'constant';
  }
  return 'deterministic';
}

/** A <parameter> living in a treeModel's rootHeight / nodeHeights slot. */
function isTreeInternal(el) {
  if (tagOf(el) !== 'parameter') return false;
  const slot = el.parentElement;
  if (!slot || !TREE_INTERNAL_SLOTS.has(tagOf(slot))) return false;
  const host = slot.parentElement;
  return !!host && TREE_TAGS.has(tagOf(host));
}

function moduleOf(el, id) {
  const tag = tagOf(el);
  for (const [name, test] of MODULE_RULES) if (test(tag)) return name;
  // inherit from the nearest ancestor that matches a module rule
  let p = el.parentElement;
  while (p) {
    for (const [name, test] of MODULE_RULES) if (test(tagOf(p))) return name;
    p = p.parentElement;
  }
  return 'other';
}

function roleOf(el) {
  const tag = tagOf(el);
  const wrapper = el.parentElement ? tagOf(el.parentElement) : null;
  if (tag === 'parameter' && wrapper && wrapper !== 'beast') {
    const host = el.parentElement.parentElement;
    return host ? `<${wrapper}> of <${tagOf(host)}>` : `<${wrapper}>`;
  }
  return `<${tag}>`;
}

/** Count, for every id, how often it is referenced from outside a <log> block.
 *  Built once: doing this per statistic is quadratic in the document size. */
function countRefsOutsideLogs(doc) {
  const outside = new Map();
  for (const r of doc.getElementsByTagName('*')) {
    const id = r.getAttribute('idref');
    if (!id) continue;
    let p = r.parentElement, inLog = false;
    while (p) {
      if (p.tagName === 'log' || p.tagName === 'logTree') { inLog = true; break; }
      p = p.parentElement;
    }
    if (!inLog) outside.set(id, (outside.get(id) || 0) + 1);
  }
  return outside;
}

function refsUnder(el) {
  const out = [];
  for (const d of el.getElementsByTagName('*')) {
    const r = d.getAttribute('idref');
    if (r) out.push(r);
  }
  return out;
}

/* Flatten a distribution model to a single attribute map.  The
 * *Prior elements carry shape / scale / mean / stdev as XML
 * attributes directly, but the *DistributionModel elements nest each
 * parameter under a child element.  BEAST X uses two layouts:
 *
 *   <expGammaDistributionModel>           <normalDistributionModel>
 *     <shape>70.0</shape>                    <mean>
 *     <scale>1.0E-10</scale>                   <parameter value="0.0"/>
 *   </expGammaDistributionModel>           </mean>
 *                                          ...
 *                                        </normalDistributionModel>
 *
 * Walk the children and read either the inner <parameter value="…"/>
 * or, failing that, the element's own text.  Top-level attributes
 * (e.g. `meanInRealSpace`) are kept on top. */
function distAttrs(el) {
  const out = { ...attrsOf(el) };
  for (const slot of el.children) {
    if (!isElement(slot)) continue;
    const key = tagOf(slot);
    if (out[key] != null) continue;     // attribute already set
    const p = slot.getElementsByTagName('parameter')[0];
    if (p) {
      const v = p.getAttribute('value');
      if (v != null) { out[key] = v; continue; }
    }
    /* Some distributions write the value as the element text:
     *   <shape>70.0</shape>  — treat that as the slot value. */
    const t = (slot.textContent || '').trim();
    if (t && /^-?\d/.test(t)) out[key] = t;
  }
  return out;
}

function nearestNodeAncestor(el, nodes, byId, skipSelf, canon = x => x) {
  let p = skipSelf ? el.parentElement : el;
  while (p) {
    const raw = p.getAttribute && p.getAttribute('id');
    if (raw) {
      const id = canon(raw);
      if (nodes.has(id)) return nodes.get(id);
    }
    p = p.parentElement;
  }
  return null;
}

// ---------------------------------------------------------------- refinement

/** Pull "other" nodes into whichever module their neighbours belong to. */
function propagateModules(nodes, edges) {
  const nbrs = new Map([...nodes.keys()].map(id => [id, []]));
  for (const e of edges) {
    nbrs.get(e.source)?.push(e.target);
    nbrs.get(e.target)?.push(e.source);
  }
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (const n of nodes.values()) {
      if (n.module !== 'other') continue;
      const tally = new Map();
      for (const id of nbrs.get(n.id) || []) {
        const m = nodes.get(id)?.module;
        if (!m || m === 'other') continue;
        tally.set(m, (tally.get(m) || 0) + 1);
      }
      if (!tally.size) continue;
      const best = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      if (best !== n.module) { n.module = best; changed = true; }
    }
    if (!changed) break;
  }
  // hyperparameters always sit with the variable they constrain
  for (const n of nodes.values()) {
    if (n.isHyper && nodes.has(n.hyperTarget)) n.module = nodes.get(n.hyperTarget).module;
  }
}

/** Everything the sampled posterior depends on: the generative model proper.
 *  Traversal stops at explicitly-flagged machinery, so a chain-initialisation
 *  subtree hanging off the tree does not get dragged in with it. */
function posteriorClosure(doc, nodes, edges) {
  const seeds = new Set();
  for (const tag of ['joint', 'prior', 'likelihood', 'posterior']) {
    for (const block of doc.getElementsByTagName(tag)) {
      for (const d of block.getElementsByTagName('*')) {
        const r = d.getAttribute('idref');
        if (r && nodes.has(r)) seeds.add(r);
      }
    }
  }
  const parents = new Map([...nodes.keys()].map(id => [id, []]));
  for (const e of edges) parents.get(e.target)?.push(e.source);

  const keep = new Set();
  const stack = [...seeds];
  while (stack.length) {
    const id = stack.pop();
    if (keep.has(id)) continue;
    keep.add(id);
    for (const p of parents.get(id) || []) {
      if (!keep.has(p) && !nodes.get(p)?.machinery) stack.push(p);
    }
  }
  return keep;
}

/** A node feeding only inference machinery is itself machinery. */
function propagateMachinery(nodes, edges, inPosterior) {
  const consumers = new Map([...nodes.keys()].map(id => [id, []]));
  for (const e of edges) consumers.get(e.source)?.push(e.target);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const n of nodes.values()) {
      if (n.machinery || n.type === 'clamped' || inPosterior.has(n.id)) continue;
      const out = consumers.get(n.id) || [];
      if (!out.length) continue;
      if (out.every(id => nodes.get(id)?.machinery)) { n.machinery = true; changed = true; }
    }
    if (!changed) break;
  }
}

// ---------------------------------------------------------------- plates

/** Tree plate (branch-indexed) and site plate.  Hyperparameters stay outside
 *  the plate, as in Fig. 4 of Hohna et al. */
function detectPlates(nodes, edges) {
  const plates = [];
  const eligible = n => !n.isHyper && !n.machinery;

  // The clock model the phylogenetic likelihood actually consumes.
  const ctmc = new Set([...nodes.values()]
    .filter(n => n.module === 'phyloCTMC').map(n => n.id));
  const usedClocks = new Set(edges
    .filter(e => ctmc.has(e.target) && CLOCK_TAGS.has(nodes.get(e.source)?.tag))
    .map(e => e.source));

  // Branch plate: the per-branch rate vector and the clock model over it.
  const dim = [...nodes.values()]
    .find(n => n.module === 'branchRates' && n.dimension && eligible(n))?.dimension;
  const branchNodes = [...nodes.values()]
    .filter(n => eligible(n) &&
                 (usedClocks.has(n.id) || (dim && n.dimension === dim)))
    .map(n => n.id);
  if (branchNodes.length >= 2) {
    plates.push({
      id: 'branchPlate',
      kind: 'tree',
      label: dim ? `branch j ∈ 1…${dim}` : 'branch j ∈ 1…2n−2',
      members: branchNodes,
    });
  }

  // Site plate: the likelihood and the character data it generates, which is
  // what is actually replicated once per site.
  const siteNodes = [...nodes.values()]
    .filter(n => eligible(n) && (n.module === 'phyloCTMC' || n.type === 'clamped'))
    .map(n => n.id);
  if (siteNodes.length >= 2) {
    plates.push({ id: 'sitePlate', kind: 'plate', label: 'site i ∈ 1…N', members: siteNodes });
  }

  return plates;
}

// ---------------------------------------------------------------- extras

function annotateLines(text, nodes, doc) {
  // For every element with an id, record the line range of its source span so
  // the Source view can highlight and jump to it.
  const lines = text.split('\n');
  const offs = [0];
  for (const ln of lines) offs.push(offs[offs.length - 1] + ln.length + 1);
  const lineAt = off => {
    let lo = 0, hi = offs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offs[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };
  const index = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    const id = el.getAttribute('id');
    if (!id || index.has(id)) continue;
    const idIdx = text.indexOf('id="' + id + '"');
    if (idIdx < 0) continue;
    const startOff = text.lastIndexOf('<', idIdx);
    if (startOff < 0) continue;
    const closeIdx = text.indexOf('</' + el.tagName + '>', idIdx);
    const selfClose = text.indexOf('/>', idIdx);
    let endOff;
    if (closeIdx > 0 && (selfClose < 0 || closeIdx < selfClose)) {
      endOff = closeIdx + ('</' + el.tagName + '>').length;
    } else if (selfClose > 0) {
      endOff = selfClose + 2;
    } else {
      endOff = startOff + text.slice(startOff).indexOf('>') + 1;
    }
    index.set(id, {
      line: lineAt(startOff),
      endLine: lineAt(Math.max(endOff - 1, startOff)),
      start: startOff, end: endOff,
    });
  }
  for (const n of nodes.values()) {
    const loc = index.get(n.id);
    if (loc) { n.xmlLine = loc.line; n.xmlEndLine = loc.endLine; n.xmlOffset = loc.start; }
  }
  return index;
}

/* Build a line-by-line map of every prior / operator / <mcmc> /
 * <log> / <logTree> element with the (tag, target, i) triple that
 * identifies the matching row in the McmcEditor sidebar.  The
 * SourceView walks this map when the user clicks a line so it can
 * jump straight to the corresponding edit panel.
 *
 *  - `target` is the parameter id the prior/operator acts on, or
 *    null for top-level elements (the <mcmc> block, the <log>
 *    blocks).
 *  - `i` is the i-th occurrence of the (tag, target) pair in
 *    document order, so duplicates in the XML are still
 *    distinguishable.  For <mcmc>, <log>, <logTree> the i-th
 *    occurrence of the tag itself is used.
 *  - `rowKey` mirrors the data-row-key the McmcEditor writes on
 *    each row, so app.js can dispatch a click straight into the
 *    sidebar without a separate lookup.
 *
 * Returns an object: { ranges: [{start, end, kind, tag, target, i,
 *   rowKey}], byLine: Map<line, range> }. */
function buildLineTargets(doc, text) {
  const offs = [0];
  for (const ln of text.split('\n')) offs.push(offs[offs.length - 1] + ln.length + 1);
  const lineAt = off => {
    let lo = 0, hi = offs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (offs[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const ranges = [];
  /* Count occurrences of each (tag, target) pair so the rowKey
   * matches the (targetId, dist) indexing in collectPriors /
   * collectOperators. */
  const seenPrior = new Map();
  const seenOp = new Map();

  /* nthIndexOf: find the i-th (0-based) occurrence of `needle` in
   * `text` starting from `from`.  Used to resolve duplicate elements
   * to their i-th source position when an element has no id. */
  function nthIndexOf(text, needle, from, n) {
    let off = from || 0;
    for (let i = 0; i <= n; i++) {
      const idx = text.indexOf(needle, off);
      if (idx < 0) return -1;
      if (i === n) return idx;
      off = idx + needle.length;
    }
    return -1;
  }

  function rangeOf(el, occurrenceIndex) {
    /* If the element has an id, the id string is unique enough to
     * locate it directly. */
    const id = el.getAttribute('id');
    let startOff;
    if (id) {
      const idIdx = text.indexOf('id="' + id + '"');
      startOff = idIdx >= 0 ? text.lastIndexOf('<', idIdx) : -1;
    } else if (typeof occurrenceIndex === 'number') {
      /* No id — find the i-th `<tagName` start. */
      startOff = nthIndexOf(text, '<' + el.tagName, 0, occurrenceIndex);
    } else {
      startOff = text.indexOf('<' + el.tagName);
    }
    if (startOff < 0) return null;
    const closeIdx = text.indexOf('</' + el.tagName + '>', startOff);
    const selfClose = text.indexOf('/>', startOff);
    let endOff;
    if (closeIdx > 0 && (selfClose < 0 || closeIdx < selfClose)) {
      endOff = closeIdx + ('</' + el.tagName + '>').length;
    } else if (selfClose > 0) {
      endOff = selfClose + 2;
    } else {
      endOff = startOff + text.slice(startOff).indexOf('>') + 1;
    }
    return { start: startOff, end: endOff };
  }

  function targetOf(el) {
    /* Target parameter idref.  Tries three layouts in order:
     *  1. direct form — <parameter idref="…"> as a descendant of the
     *     distribution element (the common case for *Prior);
     *  2. distribution-likelihood form — wrap in <distributionLikelihood>
     *     and pull idrefs from its <data> children;
     *  3. factor form — <prior><*DistributionModel/><parameter idref="…"/></prior>
     *     where the target is a SIBLING of the distribution inside a
     *     <prior> wrapper.  In that case we walk up to the <prior>
     *     and look for an idref sibling.
     * The first match with a real idref wins.  We prefer idref over
     * id because a distribution's hyperparameters (<parameter value="…">)
     * have no idref and shouldn't be mistaken for the target. */
    for (const p of el.getElementsByTagName('parameter')) {
      const r = p.getAttribute('idref') || p.getAttribute('id');
      if (r) return r;
    }
    const parent = el.parentElement;
    if (parent && tagOf(parent) === 'distribution') {
      const dl = parent.parentElement;
      if (dl && tagOf(dl) === 'distributionLikelihood') {
        for (const p of dl.getElementsByTagName('parameter')) {
          const r = p.getAttribute('idref') || p.getAttribute('id');
          if (r) return r;
        }
      }
    } else if (parent && tagOf(parent) === 'prior') {
      for (const sib of parent.children) {
        if (sib === el) continue;
        const r = sib.getAttribute && sib.getAttribute('idref');
        if (r) return r;
      }
    }
    return null;
  }

  /* Priors: every *Prior and *DistributionModel that has a target.
   * Distribution-model priors sit inside a <distributionLikelihood>;
   * the target idref is on the wrapping likelihood's <data> child, so
   * targetOf works for both.  Track the per-tag occurrence index so
   * rangeOf can find the correct element when several share a tag. */
  const seenPriorTag = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    if (!PRIOR_TAGS.has(tagOf(el))) continue;
    const t = targetOf(el);
    if (!t) continue;
    const tag = tagOf(el);
    const tagI = seenPriorTag.get(tag) || 0;
    seenPriorTag.set(tag, tagI + 1);
    const r = rangeOf(el, tagI);
    if (!r) continue;
    const k = `${tag}:${t}`;
    const i = seenPrior.get(k) || 0;
    seenPrior.set(k, i + 1);
    /* Match collectPriors's key format. */
    const priorKey = `pri-${t}-${tag}-${i}`;
    ranges.push({
      start: r.start, end: r.end,
      startLine: lineAt(r.start),
      endLine: lineAt(Math.max(r.end - 1, r.start)),
      kind: 'prior', tag, target: t, i,
      rowKey: `pri:${priorKey}`,
    });
  }
  /* Operators: direct children of <operators>.  Emit one range per
   * (operator, ref) pair so the order matches what collectOperators
   * builds (the sidebar lists one row per operator-target pair, not
   * per operator element — an <upDownOperator> with both <up> and
   * <down> refs produces two rows).  Track per-tag occurrence so
   * rangeOf can locate the correct element when several operators
   * share a tag (e.g. multiple scaleOperator).  The rowKey uses the
   * running array index — unique across all operator rows —
   * matching what McmcEditor.operatorRow writes as data-row-key. */
  const seenOpTag = new Map();
  let opIdx = 0;
  for (const ops of doc.getElementsByTagName('operators')) {
    for (const op of ops.children) {
      if (!isElement(op)) continue;
      const tag = tagOf(op);
      /* Expand refsUnder(op) so an upDownOperator with multiple refs
       * gets one row per ref.  Skip duplicate refs to avoid two rows
       * pointing at the same target on a single operator. */
      const refs = [...new Set(refsUnder(op))];
      if (refs.length === 0) continue;
      const tagI = seenOpTag.get(tag) || 0;
      seenOpTag.set(tag, tagI + 1);
      const r = rangeOf(op, tagI);
      if (!r) continue;
      for (const t of refs) {
        const k = `${tag}:${t}`;
        const i = seenOp.get(k) || 0;
        seenOp.set(k, i + 1);
        ranges.push({
          start: r.start, end: r.end,
          startLine: lineAt(r.start),
          endLine: lineAt(Math.max(r.end - 1, r.start)),
          kind: 'op', tag, target: t, i,
          /* Match collectOperators's rowKey format (array index). */
          rowKey: `op:${opIdx}`,
        });
        opIdx++;
      }
    }
  }
  /* <mcmc>, <log>, <logTree>: one row per occurrence. */
  for (const el of doc.getElementsByTagName('mcmc')) {
    const r = rangeOf(el);
    if (!r) continue;
    ranges.push({
      start: r.start, end: r.end,
      startLine: lineAt(r.start),
      endLine: lineAt(Math.max(r.end - 1, r.start)),
      kind: 'mcmc', tag: 'mcmc', target: null, i: 0,
      rowKey: 'mcmc',
    });
  }
  const logKinds = ['log', 'logTree'];
  for (const kind of logKinds) {
    let i = 0;
    for (const el of doc.getElementsByTagName(kind)) {
      const r = rangeOf(el);
      if (!r) continue;
      ranges.push({
        start: r.start, end: r.end,
        startLine: lineAt(r.start),
        endLine: lineAt(Math.max(r.end - 1, r.start)),
        kind: 'log', tag: kind, target: null, i,
        rowKey: `log:${i}`,
      });
      i++;
    }
  }

  /* Build a line -> range lookup.  Lines are 1-based; we attach
   * the range to its first line only (SourceView dispatches on
   * the click target's line, not its end).  An operator with
   * multiple refs (e.g. <upDownOperator> with <up> and <down>)
   * produces one range per ref, all sharing the operator's
   * startLine.  We keep the FIRST ref's range so clicking the
   * line lands on the first-listed ref's row — matching the
   * order the sidebar displays them. */
  const byLine = new Map();
  for (const r of ranges) {
    if (!byLine.has(r.startLine)) byLine.set(r.startLine, r);
  }
  return { ranges, byLine };
}

function firstCommentMatching(doc, re) {
  const walker = doc.createNodeIterator(doc, NodeFilter.SHOW_COMMENT);
  let c;
  while ((c = walker.nextNode())) {
    const m = c.nodeValue.match(re);
    if (m) return (m[1] || m[2] || '').trim();
  }
  return null;
}

function summarise(nodes, doc) {
  const count = t => [...nodes.values()].filter(n => n.type === t).length;
  const mcmc = doc.querySelector('mcmc');
  const taxa = doc.querySelector('taxa');
  const aln = doc.querySelector('alignment');
  let nchar = null;
  if (aln) {
    const s = aln.querySelector('sequence');
    if (s) nchar = (s.textContent.match(/[A-Za-z\-?]/g) || []).length;
  }
  const opCount = doc.getElementsByTagName('operators')[0]
    ? [...doc.getElementsByTagName('operators')[0].children].filter(c => c.nodeType === 1).length
    : 0;
  let priorCount = 0;
  for (const el of doc.getElementsByTagName('*')) {
    if (PRIOR_TAGS.has(tagOf(el))) priorCount++;
  }
  return {
    ntax: taxa ? taxa.getElementsByTagName('taxon').length : null,
    nchar,
    chainLength: mcmc ? mcmc.getAttribute('chainLength') : null,
    constant: count('constant'),
    stochastic: count('stochastic'),
    deterministic: count('deterministic'),
    clamped: count('clamped'),
    factor: count('factor'),
    operators: opCount,
    priors: priorCount,
  };
}
