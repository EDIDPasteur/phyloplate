# Fix: BEAST2 examples (BEAST 2.7.7 /examples) render with missing connections

## Diagnosis (validated)

Census of all 42 example XMLs with the current parser: ~90 live nodes have **no edges**
(testGTR: 41 nodes / 23 edges / 9 isolated). Scratch-patching a /tmp copy of
parse-beast.js with the fixes below drops that to ~28, and every remainder is
init-tree machinery, distr-nested hyperparameters, or plate templates — not a
missing-connection bug.

### Why the tester file works but real BEAUti2 output doesn't

Our tester (`phyloplate_beast2_gtr-strict.xml`) nests parameters *inside* model
components (`<input spec="GTR"><parameter id="rateAC">`), so the nested-`id`
edge pass connects everything. Real BEAUti2 v2.7 output declares parameters in
`<state>` and wires them with **`@id` attribute references**
(`tree="@Tree.t:primate"`, `rateAC="@rateAC.s:primate"`), which the edge pass
never reads — referenced elements live elsewhere in the document, so no edge.

### Root causes, ranked by isolated-node count

1. **Edge pass ignores `@id` attribute refs** (parse-beast.js:760-772 reads only
   `idref` + nested own-`id`). Kills ~60 nodes: all substitution rates,
   frequencies, birthRate, clock rates, popSize, tree inputs across the BEAUti
   files. `refsOf()` already knows `@` refs; the edge pass and `refsUnder()`
   don't.
2. **Bare-tag distribution classes unmapped.** testGTR writes priors as
   `<prior x="@rateAC"><LogNormal name="distr">` — no `spec` attribute, so
   `tagOf()` returns raw `LogNormal`/`Uniform`/`OneOnX`/`Exponential`, which are
   not in PRIOR_TAGS → priors never attach (birthRate showed `priors []`),
   posterior terms dropped (`if (!distEl) continue` in readPosteriorB2), no
   hyperparameter squares. SPEC_MAP has `Uniform`/`Exponential`/`OneOnX` keys
   but they're only consulted *when a spec exists*; `LogNormal` (25 uses across
   examples) is missing entirely.
3. **Init trees / simulators drawn as orphan nodes.** `<init spec="TreeParser">`,
   `<tree spec="RandomTree">`, `<stateNode spec="TreeParser">`,
   CalibratedYuleInitialTree, RandomGeneTree, starBEAST TreeTopFinder,
   OperatorSchedule — all become nodes because the B2 skip check tests the
   *normalized* tag only. BEAST1 already hides these via MACHINERY_TAGS
   (coalescentSimulator etc.); B2 needs the same.
4. **Named hyperparameters inside `<distr>` render as isolated duplicates.**
   `<parameter name="M" id="RealParameter.0">` under a distr element: the distr
   is not a node, so the param has no host. Its value is *already* flattened
   into the hyperparameter square by `distAttrs` — the standalone node is pure
   noise (our own tester shows this: `M.LogNormalPrior.gammaShape` isolated).
5. **`<operator spec="Uniform">` collides with the distribution class.** With fix
   2, tagOf maps it to `uniformPrior`; the priorsOf loop would then record a
   bogus Uniform prior on the operator's `parameter="@x"` target. Needs an
   opSet guard (operators are collected before priorsOf — order is already
   right).

### Files that are correct as-is (no fix needed)

- bitflip.xml, testDirectSimulator2.xml, testDirectSimulatorHierarchical.xml —
  structurally empty models (a parameter + operator, no likelihood). 1 node, 0
  edges is the honest picture.

## Batch 1 — parser fixes (js/parse-beast.js, ~90 lines)

All dialect-gated (`DIALECT === 2`) or B1-impossible, so the 4 BEAST1 digests
stay byte-identical.

1. `tagOf`: when DIALECT 2 and no spec, fall back to `SPEC_MAP[el.tagName]`
   before returning the raw tag (bare `<Uniform>` → `uniformPrior`).
2. `SPEC_MAP += LogNormal: 'logNormalDistributionModel'` (M/S slot flattening
   via distAttrs then works; testGTR's `<LogNormal>` carries M/S children).
3. `SKIP_TAGS_B2 += operatorschedule, taxonset, TreeTopFinder`.
4. `MACHINERY_TAGS += TreeParser, RandomTree, RandomGeneTree`
   (no BEAST1 element carries these tags — B1-safe). `<init …>` wrappers:
   also skip nodes whose *raw* tagName is `init` (children like
   CalibratedYuleInitialTree never become nodes; `state`/`logger` children
   unaffected — their raw tags are `stateNode`/`log`).
5. priorsOf loop: `if (opSet.has(el)) continue;` — kills the
   `<operator spec="Uniform" parameter="@x">` false prior. B1-safe (no B1
   operator child is ever a prior tag).
6. Operator collection B2: also walk children of `<operatorschedule>`
   (testOpSubSchedule); add `Reheight` to the operator regex (starBEAST
   NodeReheight → opSet skip → no longer an orphan node).
7. Edge pass: dialect-gated `@`-attribute edge block — for every element with
   an id that is a node, each `attr="@ref"` adds `ref -> own` (same dedup/
   deterministic-dashed rules). Runs before the idref pass; skipped-wrapper
   guards fall out of `nodes.has(own)`.
8. `refsUnder`: also collect `@`-attr refs (DIALECT-gated inside). Unlocks
   MRCAPrior tree targets (`tree="@Tree.t"`), ctmcScale-style lookups, and
   `posteriorClosure` seeds.
9. Node collection: DIALECT 2, skip `<parameter>` elements whose parent's
   normalized tag is a prior tag or `distr` — they are the hyperparameter
   slots already drawn as squares.
10. `posteriorClosure`: DIALECT-2 branch seeds from
    `<distribution id="posterior">` subtree via patched `refsUnder` + inline
    distribution children ids (BEAUti2 blocks hold inline distributions, not
    idrefs; current seed loop reads only literal `<joint>/<prior>/…` tags).

## Batch 2 — verification

- **B1 gate**: `node _digest.mjs | diff - _digest_baseline.txt` → the 4 B1
  digests byte-identical (GATE-OK required before moving on).
- **B2 baseline**: tester B2 digest changes (new @-edges; M/S/mean/alpha/beta
  params no longer nodes; startingTree now machinery) → one-time sanctioned
  regen + diff review, same policy as Phases 1-3.
- **Census re-run** (inline node script, /tmp scratch): all 42 examples;
  expected isolated = 0 everywhere except the 3 structurally-empty files
  (1 each), testPlates (2, see below), and zero-connection machinery gone
  from the live count.
- **Spot-checks**: testGTR posterior now lists 8 prior terms + Yule + 2
  likelihoods; birthRate/freqParameter carry priors; testTipDates2 MRCAPriors
  connect to tree; testStarBeast gene-tree priors connect.

## Batch 3 — editor + docs (~1 h)

- Extend `_sweep.mjs` to run the prior/operator edit sweep against 2 example
  files (testGTR, testRelaxedClock) — expect zero wrongwrite/clobber/nomatch;
  prior rows now exist for the bare-tag distr files (they had none before).
- README scope paragraph already claims BEAST2 coverage — no doc change needed
  beyond confirming; update beast2-compat-plan memory block.

## Known residuals (documented, not fixed)

- **testPlates.xml** (`<plate var='n' range='.p1,.p2,.p3'>`): PhyloPlate reads
  the unexpanded file; the `$(n)` template subgraph renders self-connected
  (hky.kappa$(n) → hky$(n) → siteModel$(n) → treeLikelihood$(n)) but the two
  real alignments it should consume stay isolated. Full fix = plate expansion
  pre-pass (~40-60 lines DOM clone per range value). BEAUti itself never
  writes plates (it expands them), so this only affects hand-written files.
  Default: skip. Add expansion only if wanted.
- **testExponentialGrowth tree3**: a second TreeParser sitting in `<state>`
  that nothing consumes — genuinely orphaned in the source file; after
  MACHINERY tagging it hides entirely.
- Editor rows for operators nested in `<plate>` blocks (testPlates): the
  editor's collectOperators walks `<run>` children; plate-nested operators
  won't list. Same plate limitation, noted.

## Effort estimate

~90 lines in parse-beast.js + ~10 in nothing else (mcmc-editor.js expected to
work unchanged: its matcher is text/eid-based, and prior records gain no new
required fields). Compute: Batch 1 ~1.5 h, Batch 2 ~1 h (digest+sweeps on
/mnt/c, 300 s timeouts), Batch 3 ~1 h → **~3-4 h total**.
