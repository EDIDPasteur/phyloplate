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
  'log', 'logTree', 'loggerTree', 'column', 'report', 'marginalLikelihoodEstimator',
  'pathSamplingAnalysis', 'steppingStoneSamplingAnalysis', 'insertionPoint',
  'generalDataType', 'state', 'alias', 'ambiguity', 'property',
  'logCheckpoint', 'loadCheckpoint', 'checkpoint',
]);

/* BEAST2-only additions.  <distribution> without spec is a bare wrapper
 * (BEAUti2 always writes spec=, hand-written files often don't);
 * <input>/<operator>/<logger>/<distr>/<data> are structural in BEAST2
 * but never graph nodes in their own right.  <parameter> stays a node
 * there (BEAUti2 parameters are the sampled variables). */
const SKIP_TAGS_B2 = new Set([
  'distribution', 'distr', 'input', 'operator', 'logger', 'state',
  'init', 'taxon', 'taxa', 'trait', 'sequence', 'beast', 'log',
  'plate', 'knot', 'usershape', 'meta', 'tree', 'run',
  /* <operatorschedule> wraps the operator list; <taxonset> and
   * TreeTopFinder are structural (calibration / species-tree-top
   * machinery), not model variables. */
  'operatorschedule', 'taxonset', 'TreeTopFinder',
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

/* BEAST2: the alignment is <data spec="Alignment"> — mapped by SPEC_MAP
 * to 'alignment'; but plain <data> (no spec) is also BEAUti2's alignment
 * tag.  In BEAST1 <data> means "prior target list", so the observed-data
 * membership of 'data' is dialect-qualified. */
const OBSERVED_TAGS_B2 = new Set(['data']);

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
  /* BDMM-Prime's birth-death-migration tree prior. */
  'bdmmPrimeDistribution',
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
  /* BDMM-Prime's birth-death-migration density: a factor in the
   * posterior, like coalescentLikelihood. */
  'bdmmPrimeDistribution',
]);

// Inference machinery, not part of the generative model.
const MACHINERY_TAGS = new Set([
  'gradient', 'branchRateGradient', 'jointGradient', 'hessian',
  'coalescentSimulator', 'upgmaTree', 'neighborJoiningTree',
  /* BEAST2 starting-tree simulators (TreeParser/RandomTree/…) are NOT
   * machinery by class: the state tree can be a TreeParser too.  The
   * discriminator is the initial="@…" attribute (see addNode) — every
   * corpus initialiser carries it. */
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

/* BEAST2-only prior tags.  BEAST1 calibrations use <MRCAPrior> too but
 * were never treated as a priors-block entry (monophyly is drawn as a
 * statistic), so admitting it there would change the BEAST1 digests. */
const B2_PRIOR_TAGS = new Set(['MRCAPrior']);
const isPriorTag = t => PRIOR_TAGS.has(t) ||
  (DIALECT === 2 && B2_PRIOR_TAGS.has(t));

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
  MRCAPrior: 'MRCA',
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
  MRCAPrior: 'MRCA',
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

/** True when el sits anywhere inside a BEAST2 <operator> block
 *  (subsamplers, <up>/<down> lists, AVMN <transformations>). */
const inOperator = el => !!el.parentElement && !!el.closest('operator');

/* Dialect-aware tag.  BEAST X names components with the tag itself
 * (<hkyModel>); BEAST2 names them with spec="HKY" on generic tags
 * (<input>, <distribution>, <operator>…).  tagOf(el) returns the
 * BEAST X tag vocabulary for both dialects, so every table and pass
 * downstream works unchanged.  Set per parse by parseBeastXML via
 * setDialect(); for BEAST2 the raw tagName is kept only when there
 * is no spec (e.g. <data>, <taxon>, <sequence>). */
let DIALECT = 1;
/* specTagOf: the tag-normalisation half of tagOf, callable without an
 * element — the editor's text-based matcher uses it to normalise raw
 * tags from buildElementIndex.  Exported (Batch 2 imports it). */
export function specTagOf(rawTag, spec) {
  /* BEAUti2 v2.7 writes bare distribution tags with no spec
   * (<Gamma id="Gamma.2" name="distr">); the class name alone
   * resolves through the same map, mirroring tagOf. */
  if (!spec) return SPEC_MAP[rawTag] || rawTag;
  const bare = spec.slice(spec.lastIndexOf('.') + 1);
  return SPEC_MAP[bare] || bare;
}
const tagOf = el => {
  if (DIALECT === 1) return el.tagName;
  const spec = el.getAttribute('spec');
  /* BEAUti2 v2.7 writes bare distribution tags with no spec
   * (<prior x="@kappa"><LogNormal name="distr">); the class name
   * alone resolves through the same map. */
  if (!spec && SPEC_MAP[el.tagName]) return SPEC_MAP[el.tagName];
  return specTagOf(el.tagName, spec);
};

/* BEAST2 spec names -> the BEAST X tag vocabulary this parser's
 * tables are keyed on.  Keyed by the unqualified spec class name
 * (namespace prefix stripped); unknown specs fall through to the
 * generic-label path.  `ponytail:` covers specs seen in BEAUti
 * output and the packages listed in the plan; add entries as new
 * packages are hit.  The prefixed form distinguishes mapped specs
 * (which tables understand) from unknown ones. */
const SPEC_MAP = {
  // distributions / priors
  Prior: 'prior', CompoundDistribution: 'joint', LogNormalDistributionModel: 'logNormalDistributionModel',
  LogNormal: 'logNormalDistributionModel',
  NormalDistributionModel: 'normalDistributionModel', Exponential: 'exponentialPrior',
  ExponentialDistributionModel: 'exponentialDistributionModel',
  Gamma: 'gammaPrior', InverseGamma: 'invgammaPrior',
  LaplaceDistribution: 'laplaceDistributionModel', UniformDistributionModel: 'uniformDistributionModel',
  Beta: 'betaPrior', Poisson: 'poissonPrior', CauchyDistribution: 'cauchyDistributionModel',
  Dirichlet: 'dirichletPrior',   HalfNormal: 'halfNormalPrior', Normal: 'normalPrior', Uniform: 'uniformPrior',
  HalfT: 'halfTPrior',
  OneOnX: 'oneOnXPrior', OneOnXPrior: 'oneOnXPrior', CTMCScalePrior: 'ctmcScalePrior',
  MarkovChainDistribution: 'uniformPrior', MultiMonophyleticConstraint: 'MRCAPrior',
  // substitution / site models
  HKY: 'hkyModel', GTR: 'gtrModel', TN93: 'tn93Model', JC69: 'jc69Model',
  JukesCantor: 'jc69Model', SubstitutionModel: 'substitutionModel',
  SiteModel: 'siteModel', GammaSiteModel: 'gammaSiteModel',
  Frequencies: 'frequencyModel', EmpiricalFrequencies: 'frequencyModel',
  MutationDeathModel: 'substitutionModel', WeightedHaploidGenProvider: null,
  // clocks
  StrictClockModel: 'strictClockBranchRates', UCRelaxedClockModel: 'discretizedBranchRates',
  RandomLocalClockModel: 'randomLocalClockModel', LocalClockModel: 'localClockModel',
  // trees / coalescent
  Tree: 'treeModel', ConstantPopulation: 'constantSize',
  /* bare <tree id="…"/> (no spec) is BEAST2's state-tree placeholder
   * in hand-written XML; tagOf's no-spec fallback consults this. */
  tree: 'treeModel',
  ExponentialGrowth: 'exponentialGrowth', LogisticGrowth: 'logisticGrowth',
  Expansion: 'expansion', Coalescent: 'coalescentLikelihood',
  CoalescentConstantPopulation: 'coalescentLikelihood',
  BayesianSkyline: 'gmrfSkyrideLikelihood',   GMRFBayesianSkyrideLikelihood: 'gmrfSkyrideLikelihood',
  SkygridLikelihood: 'skyGridLikelihood', GMRFSkygridLikelihood: 'skyGridLikelihood',
  YuleModel: 'yuleModel',
  BirthDeathGernhard08Model: 'birthDeathModel', TreeIntervals: 'treeIntervals',
  // likelihoods
  TreeLikelihood: 'treeLikelihood', AncestralStateTreeLikelihood: 'ancestralTreeLikelihood',
  ThreadedTreeLikelihood: 'treeLikelihood',
  // parameters / operators / statistics
  RealParameter: 'parameter', IntegerParameter: 'parameter',
  BooleanParameter: 'parameter', CompoundParameter: 'compoundParameter',
  ScaleOperator: 'scaleOperator', DeltaExchangeOperator: 'deltaExchangeOperator',
  UniformOperator: 'uniformOperator', RandomWalkOperator: 'randomWalkOperator',
  SubtreeSlide: 'subtreeSlide', Exchange: 'narrowExchange',
  WilsonBalding: 'wilsonBalding', TreeScaler: 'scaleOperator',
  EssentialImproperScale: 'scaleOperator', Kernel: 'scaleOperator',
  UpDownOperator: 'upDownOperator', PopulationSizeScaler: 'scaleOperator',
  TipDatesRandomWalker: 'randomWalkOperator', BitFlipOperator: 'uniformOperator',
  JumpOperator: 'uniformOperator', SAMOperator: null,
  /* Sampled-ancestor operators (sa package, used with BDMM-Prime). */
  SAScaleOperator: 'scaleOperator', SAExchange: 'narrowExchange',
  SAWilsonBalding: 'wilsonBalding', SAUniform: 'uniformOperator',
  LeafToSampledAncestorJump: 'uniformOperator',
  /* BEAUti2 bare distribution tags (no spec) resolve here via tagOf's
   * no-spec fallback; BEAUti2 also writes wrappers bare (<prior x=…>). */
  LogNormal: 'logNormalDistributionModel', Normal: 'normalPrior',
  Exponential: 'exponentialPrior', Gamma: 'gammaPrior', Uniform: 'uniformPrior',
  Beta: 'betaPrior', OneOnX: 'oneOnXPrior',
  /* BDMM-Prime (v2.4.0): the tree prior is a factor; the prior wrappers
   * behave like BEAUti2's <prior x=…>; OptionalLogger is output plumbing. */
  ZeroExcludingPrior: 'prior', BirthDeathMigrationDistribution: 'bdmmPrimeDistribution',
  OptionalLogger: 'logger',
  /* feast helpers seen in BDMM-Prime scripts: the alignment is an
   * observed-data view of a FASTA file; trees parsed from Newick are
   * state trees; TreeParser is both that and the B2 initialiser. */
  TreeParser: 'treeModel', FilteredAlignment: 'alignment',
  AlignmentFromFasta: 'alignment',
  // statistics
  TreeHeightLogger: 'treeHeightStatistic', TreeHeightStatistic: 'treeHeightStatistic',
  TreeLengthStatistic: 'treeLengthStatistic', Monophyletic: 'monophylyStatistic',
  CoefficientOfVariationStatistic: 'statistic',
  // misc structural
  TaxonSet: 'taxa', Taxon: 'taxon', Alignment: 'alignment', Sequence: 'sequence',
  MRCAPrior: 'MRCAPrior', TipDates: 'TipDates', TipDatesRandomWalkerX: null,
  // run block / output
  MCMC: 'mcmc', Logger: 'logger', TreeWithMetaDataLogger: 'loggerTree',
  OperatorSchedule: 'operatorschedule',
  ESS: 'statistic',
  // MASCOT (v3.0.7 examples) + BEAST2 structural bits: <state spec="State">
  // is the state block; Mascot is the structured-coalescent tree prior;
  // Function$Constant is a constant-valued parameter (an Exp prior's mean).
  State: 'state', Mascot: 'coalescentLikelihood',
  StructuredTreeIntervals: 'treeIntervals', Sum: 'sumStatistic',
  'Function$Constant': 'parameter',
};

function refsOf(el) {
  const out = [];
  for (const d of el.getElementsByTagName('*')) {
    const r = d.getAttribute('idref');
    if (r) out.push(r);
  }
  if (DIALECT === 2) {
    // BEAST2 attribute references: value="@someId"
    for (const a of el.attributes) {
      if (a.value.length > 1 && a.value.startsWith('@')) out.push(a.value.slice(1));
    }
    // <input name="tree" idref="x"/> already covered by the scan above.
  }
  return out;
}

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

/** 1.0E5 -> 1e5, 0.3333333333 -> 0.333.  An @ref passes through as the
 *  bare id (the referenced node carries the value); values in [1e3,1e4)
 *  keep six digits — years like 2020.216 lose to toPrecision(3). */
function compactNumber(v) {
  const s = String(v);
  if (s.startsWith('@')) return s.slice(1);
  const x = Number(v);
  if (!Number.isFinite(x)) return s;
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a >= 1e4 || a < 1e-3) return x.toExponential(0).replace('e+', 'e');
  return String(Number(x.toPrecision(a >= 1e3 ? 6 : 3)));
}

/* ---- BEAST2 plate expansion -----------------------------------------
 * <plate var='n' range='.p1,.p2,.p3'> deep-clones its body per range
 * value, replacing $(n) inside every attribute value.  Expanded clones
 * are recorded in PLATE_TPL so line mapping falls back to the template
 * element's source lines — the clone's expanded ids do not exist in
 * the raw text, and editing the template edits every instance. */
const PLATE_TPL = new WeakMap(); // clone -> template element

function expandPlates(doc) {
  for (let plates; (plates = [...doc.getElementsByTagName('plate')]).length;) {
    for (const plate of plates) {
      const vr = plate.getAttribute('var');
      const range = (plate.getAttribute('range') || '')
        .split(',').map(s => s.trim()).filter(Boolean);
      if (!vr || !range.length) { plate.remove(); continue; }
      for (const val of range) {
        for (const child of [...plate.children]) {
          const c = child.cloneNode(true);
          substitute(c, child, vr, val);
          plate.parentNode.insertBefore(c, plate);
        }
      }
      plate.remove();
    }
  }
  function substitute(el, tpl, vr, val) {
    const tAll = [tpl, ...tpl.getElementsByTagName('*')];
    const cAll = [el, ...el.getElementsByTagName('*')];
    for (let i = 0; i < cAll.length; i++) {
      PLATE_TPL.set(cAll[i], tAll[i]);
      for (const a of [...cAll[i].attributes]) {
        if (a.value.includes('$(' + vr + ')')) {
          cAll[i].setAttribute(a.name, a.value.split('$(' + vr + ')').join(val));
        }
      }
    }
  }
}

/* The element a node was cloned from during plate expansion, or null.
 * Line annotation consults this first so expanded clones highlight the
 * TEMPLATE's source lines (the edit target for all instances). */
function templateOf(el) {
  const t = PLATE_TPL.get(el);
  return t && templateOf(t) || t;
}

// ---------------------------------------------------------------- main parse

export function parseBeastXML(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('XML is not well-formed: ' + err.textContent.trim().split('\n')[0]);

  const root = doc.documentElement;
  if (root.tagName !== 'beast') {
    throw new Error(`Root element is <${root.tagName}>, expected <beast>. ` +
      'This viewer reads BEAST X / BEAST 1.x XML (beast-mcmc) and BEAST2 XML.');
  }
  // Both dialects use <beast>: BEAST2 carries version="2.x" / a namespace
  // attribute / <run>; BEAUti2 output is unambiguous via spec="…" anywhere.
  const isB2 = /^2\./.test(root.getAttribute('version') || '') ||
      root.hasAttribute('namespace') ||
      doc.getElementsByTagName('run').length ||
      doc.querySelector('[spec]');
  // Select the dialect for tagOf()/refsOf().  BEAST2 files may omit spec on
  // structural elements, so the tag vocabulary falls back to the raw tag
  // there; BEAST1 keeps its own tag names.
  DIALECT = isB2 ? 2 : 1;

  /* BEAST2 <plate var="n" range="a,b,c"> duplicates its body once per
   * range value, substituting $(n) in attribute values.  Expand up-front
   * so every walk below (operators, priors, posterior, line targets)
   * sees a flat document — otherwise plate-nested operators and
   * likelihoods are invisible to the direct-children walks. */
  if (isB2) expandPlates(doc);

  const meta = {
    version: root.getAttribute('version') || 'unknown',
    dialect: isB2 ? 'BEAST2' : 'BEAST X',
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
  /* BEAST X: <operators><scaleOperator>…  Every child of <operators>
   * is an operator — including HMC's <gradient>/<branchRateGradient>,
   * which mark their targets as sampled.  BEAST2's operator input tag
   * is literally <operator> (BEAUti output, AdaptableOperatorSampler
   * subsamplers and <subschedule> groups all nest it), so the walk
   * takes descendants and needs no spec regex. */
  const opEls = DIALECT === 2
    ? [...doc.querySelectorAll('run, operatorschedule')].flatMap(outer =>
        [...outer.querySelectorAll('operator')])
    : [...doc.getElementsByTagName('operators')].flatMap(ops => [...ops.children].filter(isElement));
  const opSet = new Set(opEls);
  /* B2 only: a sampler's member <operator idref> names another
   * operator.  BEAST X's HMC <gradient idref> is an operator-to-operator
   * reference too, but it is part of the sampled machinery the B1
   * diagram has always shown — gate on dialect. */
  const opIds = DIALECT === 2
    ? new Set(opEls.map(op => op.getAttribute('id')).filter(Boolean))
    : null;
  for (const op of opEls) {
    if (!isElement(op)) continue;
    for (const ref of refsOf(op)) {
      /* An operator may reference another operator (a sampler's
       * <operator idref> member, an AVMN's transform list): that is
       * composition, not "this operator moves variable x". */
      if (opIds && opIds.has(ref)) continue;
      sampled.add(ref);
      if (!operatorsOf.has(ref)) operatorsOf.set(ref, []);
      operatorsOf.get(ref).push({ tag: tagOf(op), attrs: attrsOf(op) });
    }
  }

  // ---- prior block: distribution -> target parameter
  const priorsOf = new Map(); // targetId -> [{dist, label, attrs}]
  for (const el of doc.getElementsByTagName('*')) {
    if (!isPriorTag(tagOf(el))) continue;
    /* <operator spec="Uniform"> maps to uniformPrior via SPEC_MAP; it is
     * an operator, not a density.  (opSet is built above this loop.) */
    if (opSet.has(el)) continue;
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
    //
    // BEAST2 resolves most-specific-first: the x input (@-attr on the
    // distribution or wrapper, or a <input name="x"> child) names the
    // TARGET; the distribution's own @-hyperparameters (LogNormal
    // M="@ClockM" S="@ClockS") are conditioned-on arguments and must not
    // become targets.  refsUnder is the fallback, not the first try —
    // BDMM-Prime's <LogNormal M="@ClockM"> priors would otherwise attach
    // to the hyperparameters instead of clockRate$(n).  Factor form
    // (BEAST X) keeps refsUnder first: there the distribution genuinely
    // holds no x.
    let targets = [];
    if (DIALECT === 2) {
      const from = e => (e.getAttribute('x') || '').replace(/^@/, '') ||
        [...e.children].find(c => isElement(c) &&
          c.getAttribute('name') === 'x')?.getAttribute('idref') || '';
      const wrap = el.parentElement || null;
      const xview = wrap && [...wrap.children].find(c => isElement(c) &&
        c.tagName === 'x') || null;
      const xref = from(el) || (wrap ? from(wrap) : '') ||
        (xview ? refsUnder(xview)[0] || '' : '');
      if (xref && byId.has(xref) && PARAMETERISH.has(tagOf(byId.get(xref)))) {
        targets.push(xref);
      } else if (tagOf(el) === 'MRCAPrior') {
        /* BEAST2 calibration: <distribution spec="MRCAPrior" …><taxonset>…
         * <input name="tree" idref="Tree.t"/><distr>… — the target is the
         * tree the calibration applies to. */
        targets = refsUnder(el)
          .filter(r => byId.has(r) && TREE_TAGS.has(tagOf(byId.get(r))));
      } else if (xref && byId.has(xref) && TREE_TAGS.has(tagOf(byId.get(xref)))) {
        targets.push(xref);
      }
      if (!targets.length) {
        targets = refsUnder(el)
          .filter(r => byId.has(r) && PARAMETERISH.has(tagOf(byId.get(r))));
      }
    } else {
      targets = refsUnder(el)
        .filter(r => byId.has(r) && PARAMETERISH.has(tagOf(byId.get(r))));
    }
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
          const r = sib.getAttribute('idref') ||
                    (sib.getAttribute('x') || '').replace(/^@/, '');
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
        /* Editor matcher fields (B2 only; digest-safe — the digest
         * serializes dist+attrs, not these).  eid is the element's own
         * id (BEAUti2 ids are unique), specBare/densitySpecBare the
         * unqualified spec names for elements with no id, realTag the
         * raw XML tag so the editor can find it in the text.  For a
         * plate clone, eid is the TEMPLATE's unsubstituted id — the
         * clone's expanded id does not exist in the raw text, and
         * editing the template edits every instance. */
        ...(DIALECT === 2 ? {
          eid: (templateOf(el) || el).getAttribute('id') || null,
          realTag: el.tagName,
          specBare: (el.getAttribute('spec') || '').slice(
            (el.getAttribute('spec') || '').lastIndexOf('.') + 1) || null,
          densitySpecBare: (() => {
            const d = [...el.children].find(c => isElement(c) &&
              tagOf(c) !== 'parameter' && !c.getAttribute('idref'));
            if (!d) return null;
            const s = d.getAttribute('spec') || '';
            return s.slice(s.lastIndexOf('.') + 1) || null;
          })(),
        } : {}),
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
                 (STATISTIC_TAGS.has(tag) && !refsOutsideLogs.has(id)) ||
                 /* BEAST2: an element is an initialiser (starting-tree
                  * supplier, machinery like RandomTree) when it carries
                  * initial="@…" or is the nested BEAUti2 form
                  * <input name="initial" spec="TreeParser">.  The state
                  * tree itself never carries either. */
                 (DIALECT === 2 && ((
                   attrs.initial && /^\s*@/.test(attrs.initial)) ||
                   attrs.name === 'initial')),
      priors: priorsOf.get(id) || [],
      operators: operatorsOf.get(id) || [],
      role: roleOf(el),
      /* BEAST X also writes parameter values as element text
       * (<parameter id="x" ...>2020.23</parameter>); fall back to that
       * for parameters only — a <newick>'s text is not a display value. */
      value: shortValue(attrs.value ?? (tag === 'parameter' && !el.children.length
        ? (el.textContent || '').trim() || null : null)),
      dimension: attrs.dimension || null,
      xmlLine: null,
      el,
    };
    nodes.set(id, n);
    return n;
  }

  for (const [id, el] of byId) {
    const t = tagOf(el);
    if (SKIP_TAGS.has(t)) continue;
    if (DIALECT === 2 && (SKIP_TAGS_B2.has(t) || opSet.has(el) || inOperator(el))) continue;
    /* Spec'd wrapper whose raw tag is a skip-word: skip only when its spec
     * is NOT a mapped, model-meaningful class. <distribution spec="Mascot">
     * stays (mapped → coalescentLikelihood, the structured-coalescent tree
     * prior); <log spec="…TreeStatLogger"> goes (no mapping → logger junk).
     * Bare wrappers with no spec fall through to tagOf (bug-2 <tree/>). */
    /* Output/structural wrappers whose raw tag is a skip-word: skip
     * only when the spec is NOT a mapped class, and only for the two
     * raw tags that are pure output/data plumbing.  <log spec=…>
     * loggers are machinery unless mapped (TreeHeightLogger stays, as
     * in the B2 tester baseline); <trait> is B1 parity (BEAST X skips
     * date traits).  Other wrappers — <input spec="ClusterTree">,
     * <tree spec="TreeParser">, <input name="initial"> initialisers —
     * carry real model objects and must stay nodes. */
    if (DIALECT === 2 && (el.tagName === 'log' || el.tagName === 'trait') &&
        !SPEC_MAP[(el.getAttribute('spec') || '').slice(el.getAttribute('spec').lastIndexOf('.') + 1)])
      continue;
    /* <init> wrappers (any spec) hold starting-tree machinery; raw-tag
     * test so the check is dialect-neutral. */
    if (el.tagName === 'init') continue;
    if (PRIOR_TAGS.has(t) && !FACTOR_TAGS.has(t)) continue;
    /* BEAUti2 nests named hyperparameters inside <distr>/<prior>
     * (<parameter name="M" value="1.0"/>); their values are already
     * flattened into the hyperparameter square by distAttrs, so the
     * standalone node is pure noise. */
    if (DIALECT === 2 && t === 'parameter') {
      const p = el.parentElement;
      const pt = p ? tagOf(p) : null;
      if (pt === 'distr' || isPriorTag(pt)) continue;
    }
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
      /* B2 MRCAPrior: skip the structural attrs (monophyletic, tree ref,
       * tipsonly) and the height prior's bounds — the square shows the
       * density's hyperparameters only. */
      const parts = Object.entries(pr.attrs)
        .filter(([k, v]) => !['id', 'idref', 'name', 'spec', 'mode'].includes(k) &&
                            !(pr.dist === 'MRCAPrior' &&
                              (k === 'monophyletic' || k === 'tree' || k === 'tipsonly' ||
                               k === 'lower' || k === 'upper')) &&
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

  // BEAUti2 declares parameters in <state> and wires them with @id
  // attribute references (tree="@Tree.t:primate"), so the referenced
  // element sits elsewhere in the document and no idref ancestor can
  // be found.  One pass: every node element's @attr adds ref -> own.
  if (DIALECT === 2) for (const d of doc.getElementsByTagName('*')) {
    const own = canon(d.getAttribute('id') || '');
    if (!own || !nodes.has(own)) continue;
    for (const a of d.attributes) {
      if (a.value.length > 1 && a.value.startsWith('@')) {
        const child = canon(a.value.slice(1));
        if (child && nodes.has(child))
          addEdge(child, own, nodes.get(own).type === 'deterministic' ? 'dashed' : 'solid');
      }
    }
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
  if (DIALECT === 2) return readPosteriorB2(doc, nodes, canon);
  const out = { prior: [], likelihood: [], found: false };

  const block = name => {
    const els = [...doc.getElementsByTagName(name)];
    // the one inside <joint>/<mcmc>, not a nested reference
    return els.find(e => e.getAttribute('id')) || els[0] || null;
  };

  /* One term per child of the block.  Priors attach in two forms:
   *  - direct: <exponentialPrior mean="1"><parameter idref="x"/></exponentialPrior>
   *  - factor: <prior><logNormalDistributionModel/><parameter idref="x"/></prior>,
   *    where the distribution and its target idref are siblings inside a
   *    (possibly nested) <prior> wrapper.  Recurse into wrappers so each
   *    distribution becomes its own term.  Inside a wrapper the sibling
   *    <parameter idref> is the prior's target, never a separate factor
   *    term; at the top level an idref child IS a factor term (e.g. a
   *    coalescent likelihood referenced from <prior>). */
  const readTerms = (el, into, wrapped = false) => {
    if (!el) return;
    for (const child of el.children) {
      const tag = tagOf(child);
      if (tag === 'prior') { readTerms(child, into, true); continue; }
      const ref = child.getAttribute('idref');
      if (ref && !wrapped) {
        const id = canon(ref);
        if (nodes.has(id)) into.push({ kind: 'factor', id });
        continue;
      }
      if (!PRIOR_TAGS.has(tag)) continue;
      /* Target lookup: the parameter idref can be a descendant of the
       * distribution (direct form), or a sibling inside the <prior>
       * wrapper (factor form). */
      let targets = refsUnder(child)
        .map(canon)
        .filter(r => nodes.has(r) && PARAMETERISH.has(nodes.get(r).tag));
      if (!targets.length && tagOf(el) === 'prior') {
        targets = [...el.children]
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
          /* distAttrs covers both *Prior (attributes) and
           * *DistributionModel (nested slots) layouts, so the notation
           * lists the hyperparameters either way. */
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

/* BEAST2: the posterior is <distribution spec="CompoundDistribution"
 * id="posterior"> holding <distribution id="prior"> and
 * <distribution id="likelihood"> children.  Children of prior are
 * either idrefs to factor-like likelihoods (coalescent, MRCAPrior with
 * its own tree) or inline distributions whose x input names the
 * target parameter.  Same term shape as the BEAST1 path. */
function readPosteriorB2(doc, nodes, canon) {
  const out = { prior: [], likelihood: [], found: false };
  const post = [...doc.getElementsByTagName('distribution')]
    .find(d => d.getAttribute('id') === 'posterior');
  if (!post) return out;

  const targetOf = dist => {
    const x = (dist.getAttribute('x') || '').replace(/^@/, '');
    if (x) return x;
    const inp = [...dist.children].find(c => isElement(c) &&
      c.getAttribute('name') === 'x');
    if (inp) return inp.getAttribute('idref') || '';
    /* BEAUti2 sometimes wraps the x input in a derived-view element
     * (mascot.util.First, beastlabs.core.util.Slice, feast
     * .expressions.ExpCalculator, …) instead of naming the parameter
     * directly.  The prior then conditions on a deterministic function
     * of the sampled parameter — attach it to that parameter. */
    const view = [...dist.children].find(c => isElement(c) &&
      c.tagName === 'x');
    return view ? (refsUnder(view)[0] || '') : '';
  };

  for (const blockName of ['prior', 'likelihood']) {
    const block = [...post.children].find(c => isElement(c) &&
      c.getAttribute('id') === blockName);
    if (!block) continue;
    /* A block is either a list of idref children (BEAUti2) or a single
     * self-closing idref (likelihood); resolve idrefs to their
     * elements so the same logic applies either way. */
    const items = block.children.length
      ? [...block.children].filter(isElement)
      : [block];
    for (const item of items) {
      const el = item.getAttribute('idref')
        ? doc.getElementById(item.getAttribute('idref')) : item;
      if (!el) continue;
      const tag = tagOf(el);
      /* spec="Prior" wrappers: the factor statement belongs to the
       * <distr> child; the x input names the target. */
      const isWrapper = tag === 'prior';
      if (!isWrapper && !isPriorTag(tag)) {
        const id = canon(el.getAttribute('id') || '');
        if (nodes.has(id)) out[blockName].push({ kind: 'factor', id });
        continue;
      }
      const distEl = isWrapper
        ? [...el.children].find(c => isElement(c) && isPriorTag(tagOf(c)))
        : el;
      if (!distEl) continue;
      const dtag = tagOf(distEl);
      let t = isWrapper ? targetOf(el) : targetOf(distEl);
      if (!t && dtag === 'MRCAPrior') {
        /* A calibration conditions on the tree itself. */
        const byId = byIdOf(doc);
        t = refsUnder(el)
          .find(r => byId.has(r) &&
                     TREE_TAGS.has(tagOf(byId.get(r)))) || null;
      }
      if (!t || !nodes.has(canon(t)) ||
          (!PARAMETERISH.has(nodes.get(canon(t)).tag) &&
           !TREE_TAGS.has(nodes.get(canon(t)).tag))) continue;
      /* MRCAPrior's own children are the taxonset/tree/distr, not
       * hyperparameters; the density's parameters live in <distr>. */
      const argSrc = dtag === 'MRCAPrior'
        ? distEl.querySelector('distr') : distEl;
      out[blockName].push({
        kind: 'dist', target: canon(t), dist: dtag,
        label: PRIOR_LABEL[dtag] || dtag,
        given: [],
        args: Object.entries(distAttrs(argSrc || distEl))
          .filter(([k, v]) => !['id', 'idref', 'spec', 'name'].includes(k) &&
                              !(k === 'offset' && Number(v) === 0)),
      });
    }
  }
  out.found = out.prior.length > 0 || out.likelihood.length > 0;
  return out;
}

/* byId for readPosteriorB2: element lookup by id attribute. */
function byIdOf(doc) {
  const m = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    if (el.getAttribute('id') && !m.has(el.getAttribute('id')))
      m.set(el.getAttribute('id'), el);
  }
  return m;
}

// ---------------------------------------------------------------- classifiers

function classify(el, id, sampled, priorsOf) {
  const tag = tagOf(el);
  if (OBSERVED_TAGS.has(tag) ||
      (DIALECT === 2 && OBSERVED_TAGS_B2.has(tag) && !el.hasAttribute('spec'))) return 'clamped';
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
  const scanAt = e => { for (const a of e.attributes)
    if (a.value.length > 1 && a.value.startsWith('@')) out.push(a.value.slice(1)); };
  if (DIALECT === 2) scanAt(el);
  for (const d of el.getElementsByTagName('*')) {
    const r = d.getAttribute('idref');
    if (r) out.push(r);
    if (DIALECT === 2) scanAt(d);
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
 * BEAST 2 nests a named <parameter> instead of a named wrapper:
 *   <distr spec="LogNormalDistributionModel">
 *     <parameter name="M" value="1.0"/>   (mean of ln x)
 *     <parameter name="S" value="1.25"/>  (sigma of ln x)
 *   </distr>
 * keyed by BEAST2's parameter names M/S (log-normal), alpha/beta (gamma).
 *
 * Walk the children and read either the inner <parameter value="…"/>
 * or, failing that, the element's own text.  Top-level attributes
 * (e.g. `meanInRealSpace`) are kept on top. */
export function distAttrs(el) {
  const out = { ...attrsOf(el) };
  /* B2's spec attr is the full Java class name — it names the kind, not a
   * hyperparameter, and leaks into hyper-square labels and tooltips. */
  delete out.spec;
  /* MRCAPrior: the height prior is a nested distribution (BEAST X
   * <logNormalPrior …>, BEAST2 <distr spec="…">) — flatten its
   * hyperparameters (mean/stdev/offset) onto the calibration record
   * and skip the generic slot pass, which would otherwise emit the
   * nested element's tag name as a junk key. */
  if (tagOf(el) === 'MRCAPrior') {
    const inner = [...el.children].find(c => isElement(c) &&
      (tagOf(c).endsWith('Prior') || tagOf(c).endsWith('DistributionModel')));
    if (inner) {
      for (const [k, v] of Object.entries(distAttrs(inner))) {
        if (k !== 'spec' && k !== 'id' && out[k] == null) out[k] = v;
      }
      return out;
    }
    /* B2 calibrations can carry the height density as a named slot
     * (<Uniform name="distr" lower= upper=/>): flatten its attrs too. */
    const slot = [...el.children].find(c => isElement(c) &&
      c.getAttribute('name') === 'distr');
    if (slot) {
      for (const [k, v] of Object.entries(distAttrs(slot))) {
        if (k !== 'spec' && k !== 'id' && k !== 'name' && out[k] == null) out[k] = v;
      }
    }
  }
  for (const slot of el.children) {
    if (!isElement(slot)) continue;
    /* BEAUti2 writes hyperparameters as <parameter name="mean">…</parameter>
     * children; the name= pass below reads them.  Skipping them here
     * stops the text-branch from filing the value under a junk
     * 'parameter' key. */
    if (DIALECT === 2 && slot.tagName === 'parameter') continue;
    const key = tagOf(slot);
    if (out[key] != null) continue;     // attribute already set
    /* MASCOT-style slots carry the value as a direct attribute on a
     * spec'd wrapper: <mean spec="Function$Constant" value="1.0"/>.
     * The raw tag names the slot (mean), not the spec. */
    if (DIALECT === 2) {
      const v = slot.getAttribute('value');
      if (v != null && out[slot.tagName] == null) { out[slot.tagName] = v; }
      if (v != null) continue;
    }
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
  /* BEAST2: direct <parameter name="M"> children of the distribution.
   * BEAST X never writes name= on a <parameter> (its slots are wrapper
   * elements), so name= is an unambiguous BEAST2 marker. */
  if (DIALECT === 2) {
    for (const p of el.children) {
      if (!isElement(p) || !p.getAttribute('name')) continue;
      const key = p.getAttribute('name');
      const v = p.getAttribute('value') ?? (p.textContent || '').trim();
      if (v !== '' && v != null && out[key] == null) out[key] = v;
    }
    /* Rename BEAUti2's native parameter names onto the canonical field
     * names the notation, editor forms, and PDF sampler share — so the
     * B2 gamma prior reads shape/scale like its BEAST X twin rather
     * than alpha/beta, and the edit forms prefill from canonical keys.
     * setAttrOnElement maps back to the native names when writing.
     * Gamma can instead be parameterised ShapeRate, where beta IS the
     * rate (scale = 1/rate) — keep the native spelling there rather
     * than mislabelling it as the scale. */
    const CANON = { alpha: 'shape', beta: 'scale', M: 'mean', S: 'stdev',
                    sigma: 'stdev', lambda: 'mean' };
    const gammaRate = tagOf(el) === 'gammaPrior' && el.getAttribute('mode') === 'ShapeRate';
    for (const [nat, canon] of Object.entries(CANON)) {
      if (gammaRate && (nat === 'alpha' || nat === 'beta')) continue;
      if (out[nat] != null && out[canon] == null) { out[canon] = out[nat]; delete out[nat]; }
    }
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
  /* BEAST2: the posterior is <distribution id="posterior"> whose blocks
   * hold @-refs and inline distributions, not idref lists.  Seed from
   * the block's refs (refsUnder is @-aware) and from the ids of any
   * node elements nested inside it. */
  if (DIALECT === 2) {
    const post = [...doc.getElementsByTagName('distribution')]
      .find(d => d.getAttribute('id') === 'posterior');
    if (post) {
      for (const r of refsUnder(post)) if (nodes.has(r)) seeds.add(r);
      for (const d of post.getElementsByTagName('*')) {
        const id = d.getAttribute('id');
        if (id && nodes.has(id)) seeds.add(id);
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
    /* Plate clones: annotate the TEMPLATE's source span — the clone's
     * expanded id does not exist in the raw text, and editing the
     * template element edits every instance. */
    const src = templateOf(el) || el;
    const srcId = src.getAttribute('id');
    if (!srcId) continue;
    let idIdx = text.indexOf('id="' + srcId + '"');
    if (idIdx < 0) idIdx = text.indexOf("id='" + srcId + "'");
    if (idIdx < 0) continue;
    const startOff = text.lastIndexOf('<', idIdx);
    if (startOff < 0) continue;
    const closeIdx = text.indexOf('</' + src.tagName + '>', idIdx);
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
    if (loc) { n.xmlLine = loc.line; n.xmlEndLine = loc.endLine; }
  }
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

  function rangeOf(el, occurrenceIndex) {
    /* Plate clones: locate the TEMPLATE's source span — expanded ids
     * are not in the raw text. */
    const src = templateOf(el) || el;
    const id = src.getAttribute('id');
    let startOff;
    if (id) {
      let idIdx = text.indexOf('id="' + id + '"');
      if (idIdx < 0) idIdx = text.indexOf("id='" + id + "'");
      startOff = idIdx >= 0 ? text.lastIndexOf('<', idIdx) : -1;
    } else if (typeof occurrenceIndex === 'number') {
      /* No id — find the i-th `<tagName` start.  Match the tag
       * boundary too: a plain indexOf('<distr') would also hit
       * '<distribution' and '<distributionLikelihood'. */
      startOff = nthStartOf(text, src.tagName, occurrenceIndex);
    } else {
      startOff = nthStartOf(text, src.tagName, 0);
    }
    if (startOff < 0) return null;
    /* End offset: the matching close tag, a self-close, or the next
     * start boundary — searched from the element's own start so a
     * later element's close tag is never mistaken for this one's. */
    const closeRe = new RegExp('</\\s*' + src.tagName + '\\s*>', 'g');
    closeRe.lastIndex = startOff;
    const closeMatch = closeRe.exec(text);
    /* A child's self-close ('/>' inside the body) must not end THIS
     * element: only trust '/>' when it appears before any child tag
     * opening on the element's own opening line. */
    const openTagEnd = (() => {
      const gt = text.indexOf('>', startOff);
      return gt < 0 ? startOff : gt;
    })();
    const selfClose = (text.indexOf('/>', startOff) >= 0 &&
                       text.indexOf('/>', startOff) < openTagEnd &&
                       text.slice(startOff, openTagEnd).indexOf('<', 1) < 0)
      ? text.indexOf('/>', startOff) : -1;
    let endOff;
    if (closeMatch) {
      endOff = closeMatch.index + closeMatch[0].length;
    } else if (selfClose > 0) {
      endOff = selfClose + 2;
    } else {
      endOff = startOff + text.slice(startOff).indexOf('>') + 1;
    }
    return { start: startOff, end: endOff };
  }

  /* nthStartOf: offset of the n-th (0-based) `<tag` that starts a real
   * tag with this exact name (boundary-checked: not a prefix of a
   * longer tag name).  B2 normalises spec'd elements to a shared
   * vocabulary, so a B2 prior's normalized tag (e.g. exponentialPrior)
   * may not appear in the text at all — fall back to the raw tagName,
   * then to any `<` boundary carrying the element's id-free attributes
   * is skipped: BEAUti2 elements carry ids, so `<tag` + id lookup is
   * the path that matters. */
  function nthStartOf(text, tagName, n) {
    const re = new RegExp('<' + tagName + '(?=[\\s/>])', 'g');
    let i = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (i++ === n) return m.index;
    }
    return -1;
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
     * The first match with a real idref wins.  Prefer idref over id:
     * a distribution's hyperparameters (<parameter value="…">) have no
     * idref and shouldn't be mistaken for the target.  (The old code
     * fell back to p.getAttribute('id') — a nested hyperparameter's
     * OWN id, e.g. rn_gubbin's <parameter id="clock.logMean"> inside
     * <mean>, hijacked the row and mis-targeted the sidebar.) */
    for (const p of el.getElementsByTagName('parameter')) {
      const r = p.getAttribute('idref');
      if (r) return r;
    }
    const parent = el.parentElement;
    if (parent && tagOf(parent) === 'distribution') {
      const dl = parent.parentElement;
      if (dl && tagOf(dl) === 'distributionLikelihood') {
        for (const p of dl.getElementsByTagName('parameter')) {
          const r = p.getAttribute('idref');
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

  /* BEAST2 target: the x input — @id attribute on the distribution or
   * wrapping Prior, or a <input name="x" idref>/<parameter name="x"
   * idref> child. */
  function targetOfB2(el) {
    const from = e => {
      if (!e || !e.getAttribute) return '';
      return (e.getAttribute('x') || '').replace(/^@/, '');
    };
    const fromChild = e => {
      const inp = [...(e.children || [])].find(c => isElement(c) &&
        c.getAttribute('name') === 'x');
      return inp ? (inp.getAttribute('idref') || '') : '';
    };
    /* MRCA calibration: the target is the tree the calibration applies
     * to (<input name="tree" idref="Tree.t"/> or a @tree attribute). */
    if (tagOf(el) === 'MRCAPrior') {
      const tattr = (el.getAttribute('tree') || '').replace(/^@/, '');
      if (tattr) return tattr;
      const inp = [...(el.children || [])].find(c => isElement(c) &&
        c.getAttribute('name') === 'tree');
      if (inp && inp.getAttribute('idref')) return inp.getAttribute('idref');
    }
    return from(el) || fromChild(el) || from(el.parentElement) ||
           fromChild(el.parentElement);
  }

  /* Priors: every *Prior and *DistributionModel that has a target.
   * Distribution-model priors sit inside a <distributionLikelihood>;
   * the target idref is on the wrapping likelihood's <data> child, so
   * targetOf works for both.  Track the per-tag occurrence index so
   * rangeOf can find the correct element when several share a tag. */
  const seenPriorTag = new Map();
  for (const el of doc.getElementsByTagName('*')) {
    if (!isPriorTag(tagOf(el))) continue;
    /* Plate clones have no row in the raw-text editor (it sees the
     * unexpanded <plate>); emitting rows here would desynchronise the
     * op:${i} / pri-* keys.  Editor-side expansion is deferred. */
    if (templateOf(el)) continue;
    let t = DIALECT === 2 ? (targetOfB2(el) || targetOf(el)) : targetOf(el);
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
  const opIter = DIALECT === 2
    ? [...doc.querySelectorAll('run, operatorschedule')].flatMap(outer =>
        [...outer.querySelectorAll('operator')])
    : [...doc.getElementsByTagName('operators')].flatMap(ops => [...ops.children].filter(isElement));
  const opIds = DIALECT === 2
    ? new Set(opIter.map(op => op.getAttribute('id')).filter(Boolean))
    : null;
  for (const op of opIter) {
    if (templateOf(op)) continue; // plate clone — no raw-text row
    {
      const tag = tagOf(op);
      /* Expand refsUnder(op) so an upDownOperator with multiple refs
       * gets one row per ref.  Skip duplicate refs to avoid two rows
       * pointing at the same target on a single operator.  A member
       * <operator idref> names another operator, not a variable. */
      const refs = [...new Set(refsOf(op))].filter(r => !opIds || !opIds.has(r));
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
  /* <mcmc>, <log>, <logTree>: one row per occurrence.  BEAST2's chain
   * settings live on <run spec="MCMC"> — one row per run.  An element
   * that carries only an idref (e.g. <mcmc idref> inside <report>) is
   * a reference, not a definition — nothing to edit or jump to. */
  for (const el of DIALECT === 2
    ? doc.querySelectorAll('run[spec="MCMC"]')
    : doc.getElementsByTagName('mcmc')) {
    if (!el.getAttribute('id') && el.getAttribute('idref')) continue;
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
  const logKinds = DIALECT === 2 ? ['logger'] : ['log', 'logTree'];
  for (const kind of logKinds) {
    let i = 0;
    for (const el of doc.getElementsByTagName(kind)) {
      /* Plate clones have no row in the raw-text editor (the sidebar
       * and the line targets both address the unexpanded <plate>);
       * emitting rows here would desynchronise the log:kind:i keys. */
      if (templateOf(el)) continue;
      if (!el.getAttribute('id') && el.getAttribute('idref')) continue;
      const r = rangeOf(el);
      if (!r) continue;
      ranges.push({
        start: r.start, end: r.end,
        startLine: lineAt(r.start),
        endLine: lineAt(Math.max(r.end - 1, r.start)),
        kind: 'log', tag: kind, target: null, i,
        rowKey: `log:${kind}:${i}`,
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
  const mcmc = DIALECT === 2
    ? doc.querySelector('run[spec="MCMC"]')
    : doc.querySelector('mcmc');
  const taxa = doc.querySelector('taxa');
  const aln = DIALECT === 2
    ? [...doc.querySelectorAll('data')].find(d => d.querySelector('sequence') &&
        (d.getAttribute('spec') || '').includes('Alignment') ||
        d.querySelector('sequence'))
    : doc.querySelector('alignment');
  let nchar = null;
  if (aln) {
    const s = aln.querySelector('sequence');
    if (s) nchar = (s.textContent.match(/[A-Za-z\-?]/g) || []).length;
  }
  const opCount = DIALECT === 2
    ? [...doc.querySelectorAll('run, operatorschedule')].flatMap(outer =>
        [...outer.querySelectorAll('operator')]).length
    : doc.getElementsByTagName('operators')[0]
      ? [...doc.getElementsByTagName('operators')[0].children].filter(c => c.nodeType === 1).length
      : 0;
  let priorCount = 0;
  for (const el of doc.getElementsByTagName('*')) {
    if (isPriorTag(tagOf(el))) priorCount++;
  }
  const ntax = taxa ? taxa.getElementsByTagName('taxon').length : null;
  return {
    ntax: ntax ?? (aln ? aln.querySelectorAll('sequence').length : null),
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
