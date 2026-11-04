# Phase 3 — BEAST2 editor parity

Approved: full editor parity, baseline regen once at end, full MRCA editing (monophyletic + offset + M/S).

## State
- Phases 1+2 intact (uncommitted: README.md, index.html, js/app.js, js/notation.js, js/parse-beast.js). GATE-OK verified.
- B2 digest: 2f7bb166d4e24f135714fabe91d100d3f139b21396ae00c9895258d3c30cd41f (no baseline; diff-review per batch).
- Stray `_probe_p3.mjs` in tester dir — delete in final batch.

## Batch 1 — parser exports + attr fixes (js/parse-beast.js)
1. Export `specTagOf(rawTag, spec)` (SPEC_MAP[bare]||bare) and `distAttrs`.
2. SPEC_MAP += Normal→normalPrior, Uniform→uniformPrior, HalfT→halfTPrior.
3. `distAttrs`: key nested `<parameter name="M|S|alpha|beta|mean|stdev|shape|scale|offset">` slots by name (B2); keep tagOf keying for text-slot form (B1). B2 gammaPrior/logNormal/MRCA attrs become real.
4. B2 prior records gain `realTag`/`specBare`/`densitySpecBare`/`eid` (digest-safe — digest serializes dist+attrs only).
5. `lineTargets`: boundary-safe rangeOf (regex `'<'+tag+'[\\s>]'`); targetOf prefers enclosing `<data>` idref over nested param id (fixes rn_gubbin mismatch, dialect-agnostic); `<run spec="MCMC">` mcmc row for B2; B2 logKinds ['logger'] only.
Gate: GATE-OK (rn_gubbin digest may change → acceptable, regen at end) + B2 digest diff review.

## Batch 2 — editor matcher core (js/mcmc-editor.js)
6. Import specTagOf + distAttrs from parse-beast.js (no cycle).
7. buildElementIndex: normalized tags via specTagOf (B1-identical; B2 normalizes distr/distribution/operator/run/input).
8. elementReferencesId/refsUnderDoc: += @-attr refs (B1-safe: zero @ attrs in B1 files).
9. findElementByTagAndRef: eid-first match, fallback normalized tag + specBare/densitySpecBare + sibling idref.
Gate: GATE-OK + B1 prior-row sweep regression (154 rows 100% ok).

## Batch 3 — editor rows populate for B2
10. collectOperators walks `<run>` children with existing regex.
11. setAttrOnElement unified resolution: density attr → nested `<parameter name=K>` value (K=attr or alias) → wrapper attr (monophyletic) → text-slot rewrite → insert fallback. Fixes B1 nested-slot dead-inserts (rn_gubbin ratesPrior).
12. B2 aliases: gamma shape→alpha/scale→beta; logNormal mean→M/stdev→S (+sigma). Applied in editor AND parser distAttrs.
Gate: GATE-OK + B2 sweep (5 priors, 11 ops, zero wrongwrite/clobber/nomatch) + B1 sweep.

## Batch 4 — MRCA row, log commits, cleanup
13. PRIOR_INFO.MRCA + priorFields [monophyletic select, offset, M, S]; samplePrior MRCA → logNormal curve.
14. B1 alias fill: normal stdev→sd, laplace/cauchy mean→mu (display + commit fallback).
15. Log/mcmc commits: setAttrOnElement per-row with null-target (setAttrOnAll deleted). Fixes B1 mcmc/log null-edit + B2 multi-logger clobber.
16. app.js openPriorDock spreads new prior-record fields. Dead PRIOR_KINDS deleted.
Gate: GATE-OK + B1 mcmc/log edit verified non-null + full sweeps both dialects.

## Batch 5 — final
17. One-time baseline regen (_digest_baseline.txt) — records B1 line-target fix.
18. Final GATE-OK; B2 digest recorded in memory; delete _probe_p3.mjs; update beast2-compat-plan memory block (Phase 3 done, baselines, next = test files 2–3).

## Verification summary
- B1 gate byte-identical (except rn_gubbin lineTargets, sanctioned by regen decision).
- B1 edit sweep: 154 prior rows (47/36/63/8) 100% ok, 0 wrongwrite/clobber/nomatch.
- B2 edit sweep: 5 priors + 11 operators + 1 mcmc + 3 loggers, 0 wrongwrite/clobber/nomatch; attrs round-trip (edit → reparse → same value).
- B1 mcmc/log rows: edits now land (were NULL before).
- B2 notation/lines: pri-… rows point at correct line ranges (no more L6-18 alignment clobber).
