# Canary session notes — canary_phyloplate

Date: 2026-09-09/10 (night session, paused ~03:00 at John's request).
Scope: testing the `opencode-canary` system (~/LLMs/opencode-canary) live in
this duplicate repo. This file is exclusive to the canary work; the phyloplate
notes live in SESSION_NOTES.md.

## What was tested and what works

End-to-end canary loop exercised live in this repo (plugin hook → HMAC ledger →
scanner):

- Baseline scan of the repo: 349 files, 0 hits, ledger integrity intact
  (0 tampered). The odd `node_modules (# Name clash 2026-08-23 0t2bfzC #)`
  directory is a pre-canary artifact (mixed-case hex, wrong format) — not a
  canary; the scanner does traverse it since it only skips dirs named exactly
  `node_modules`.
- Live write/edit tool calls in this session produced session canaries in the
  ledger (all MAC-valid under the real key): 5 adoption events (see below).
- Ledger forensics: 24 records total = 6 PoC-demo session canaries (/tmp), 12
  decoy canaries (canary-poc-demo), 1 shimcheck, 5 adoption events from this
  session. Pre-trap snapshot kept at
  `~/.local/share/opencode/canary/ledger.jsonl.real` (6123 B,
  md5 c6e2373141e8044ef16548029fcb7fdf).

## The anomaly (open problem — solve next session)

The live opencode pipeline ADOPTS canary-format comments found in
model-generated write/edit content and MAC-ledgers them (`origin=session`,
`project=default`), but NEVER injects new canaries. The on-disk code does the
opposite:

- Isolated shim test (CANARY_LEDGER/CANARY_KEY overrides, `bun -e` invoking
  the shim's `tool.execute.before` directly): content carrying a canary-format
  comment gets a NEW random canary appended (no adoption); clean content gets
  one too. So the repo code is inject-only, adopt-free.
- Therefore the code running inside opencode is not the code on disk.

Adopter location: synchronous inside opencode's write pipeline ("preparing
write" phase). Proof: replacing
`~/.local/share/opencode/canary/ledger.jsonl` with a FIFO made the write tool
block ~25 min, then abort fail-silent (no record landed). Ledger restored
byte-identical afterwards.

Timing: adoption fires within ~4–330 ms of the file write (after file mtime,
before/around opencode's "touching file" log line).

## Evidence table (adoption events)

| canary | ts (UTC) | kind | file | ts vs write |
|---|---|---|---|---|
| zlearn_49d45 | 23:43:37.000 | comment | canary_selftest.py | .000Z — ms zeroed |
| qhoesk_00082 | 23:51:58.424 | comment | canary_selftest.py (edit) | +6 ms after mtime |
| xakorth_d685e | 23:59:27.388 | comment | /tmp/opencode/canary-test/watch.sh | +11 ms |
| qilask_a8bc7 | 00:03:02.322 | comment | canary_clean_test.py | +20 s (clock jump) |
| qeforn_c7ee3 | 00:03:50.809 | comment | canary_clean_test.py | +330 ms |
| kyvorth_1973b | 00:27:11.683 | comment | ~/.config/opencode/plugins/debug-hook.ts | +4 ms |

The ts-vs-mtime ordering varies (+4 ms … +20 s) — WSL2 clock jumps observed,
so mtime-based ordering is weak evidence. The content-match is the strong
evidence: every record's canary equals the string the model hand-wrote.

## Ruled out

- Stock opencode 1.18.30 binary (mtime Sep 9 05:17; `strings` shows no canary
  or ledger code; only Bun-upgrade "canary" strings).
- litellm proxy (PID 444, started Sep 9 19:25 — predates the canary work;
  config.yaml clean, no callbacks; site-packages grepped clean; log has no
  callback/config-update entries).
- npm plugins: research-papers-plus, phylo-canvas (file:// dists), agent-memory,
  token-monitor, model-announcer — all dists grepped for
  canary/ledger/HMAC/syllables; only zod's internal "canary" vars matched.
- Old opencode process PID 659 (phylo-canvas cwd, no active sessions; started
  before the shim existed).
- ia.pasteur.cloud upstream: direct curl with a code-generation prompt returned
  NO canary injection — upstream is clean for plain generations.
- No CANARY_* env vars in any readable process; no daemons/cron; no
  `~/.config/opencode/canary/` (earlier listing that suggested one was a
  misread of merged output — the dir does not exist).
- No bundled/cached copies of canary code anywhere in ~/.cache/opencode,
  ~/.opencode, or repo node_modules.

## Unexplained

- The plugin shim appears to never fire for real writes in this opencode
  version: no random-canary record ever came from a live write (only manual
  `bun -e` invocations produced injections). opencode 1.18.30 may not load
  `~/.config/opencode/plugins/*.ts` at all.
- Who the adopter is. It has the HMAC key, sees write/edit content, runs
  synchronously in the write pipeline, and leaves no trace in any file we can
  find.

## Staged for next session

- `~/.config/opencode/plugins/debug-hook.ts` — logs every `tool.execute.before`
  invocation (tool, path, has-canary-format flag, length) to
  `/tmp/opencode/canary-test/debughook.log`. Loads on opencode RESTART. This
  settles (a) whether the plugins dir is loaded at all, and (b) hook timing.
- `/tmp/opencode/canary-test/trapscan.sh` — blocked-open scanner (for /proc
  syscall + kernel-stack fingerprints) for the next FIFO-trap attempt.
- `/tmp/opencode/canary-test/iso_ledger.jsonl` + `iso_key` — isolated ledger
  for shim tests (real ledger untouched).
- FIFO-trap playbook that worked: cp ledger → .real, mv → .hidden, mkfifo at
  the ledger path, trigger write, observe the pipeline block, `cat` the fifo
  to relay, `rm` fifo, `mv .hidden` back. Do NOT `pkill -f` patterns that
  match the invoking shell's own cmdline.

## Behavioral observation (threat-model evidence)

The model (me) compulsively emitted canary-format comments in 5 of 5 test-file
writes, even when explicitly instructed to write clean content — the template
phrase anchors generation once the syllable tables are in context. Two
implications:

1. Canary-format comments DO propagate through model generations once the
   pattern is in context — supports the design's premise.
2. It makes "clean" control files unreliable; any future clean-control test
   must avoid exposing the template/syllables to the model beforehand, and
   verify content programmatically rather than trusting the model.

## Next steps (priority order)

1. Restart opencode → confirm debug-hook.ts fires; read its log for hook
   timing and whether write args are visible to hooks.
2. Identify the adopter. Ideas: check whether opencode bundles/inlines plugin
   imports; search opencode source/pkg for any adopt logic; re-check
   ~/.cache/opencode; consider that opencode may load plugins from the DB or a
   snapshot copy taken earlier in the canary session.
3. Decide whether adopt-behavior is desirable. It breaks chain-of-custody in
   the strict sense (the ledger vouches for strings the model itself invented
   rather than machine-generated nonces), but matches how the threat model
   actually behaves (canaries resurfacing in generations). Possibly make it an
   explicit mode (`CANARY_MODE=adopt|inject|both`) rather than an accident.
4. Continue the planned repo test: set `CANARY_PROJECT=canary_phyloplate` (via
   opencode.json `env`), rerun scan + `bun run demo`, BF-tag report.

## Cleanup state at pause

- Ledger restored byte-identical to pre-trap (6123 B); `.real` snapshot kept.
- No FIFO left in place; no watcher processes running (the old size-watcher and
  trap scanner were killed; note `pkill -f` self-match hazard).
- Test files left in repo (untracked): canary_selftest.py,
  canary_clean_test.py (both carry adopted canaries — safe to keep or delete;
  their ledger records remain valid either way).
- This file contains references to real canary strings; that is intentional
  documentation of ledger entries, not new canaries.

## Session 3 (2026-09-10 afternoon): real-repo test + bulk canary tagging

Live-hook experiment (canary_livehook_test.py, written via opencode write tool
with a hand-invented canary-format comment `qilvyn_t9f42` in the payload):

- The adopter fired AGAIN in this opencode instance: the *second* invented
  comment `qefexis_414af` (the `TODO(jht/...)` template) was HMAC-ledgered at
  13:32:36.552Z (origin session, project default). The first invented comment
  (`# see qilvyn_t9f42 ...`) was NOT ledgered and NOT injected.
- debug-hook.ts fired for the write (plugins dir DOES load), but reported
  hasCanaryFormat:false and len 539 (~49 bytes shorter than the outgoing
  content) — content is transformed BEFORE tool.execute.before runs, and the
  hook sees a version that no longer contains either invented comment.
- The shim did not append a fresh machine canary to THIS write (contrast with
  the opencode-canary repo writes this morning, which got injections). Net:
  adoption ≠ injection; adoption only catches the TODO-template phrase here.
- Conclusion so far: two distinct behaviors exist — injection (our shim,
  reproducible) and adoption (unknown upstream component that ledgered the
  TODO-format phrase before the hook layer; it has the HMAC key). Adoption is
  benign-looking but breaks strict chain-of-custody (ledger vouches for
  model-invented strings); still unidentified.

Bulk tagging of the deployed site (via new tag.ts — deterministic, outside
the write pipeline, project=canary_phyloplate, mode=standard):

- 14 files tagged, 21 canaries (7 js modules: comment+BUILD_TAG literal; 2
  tracked example XMLs, serve.sh, index.html, style.css, test-parse.html,
  verify-fix.html: comment). d3.v7.min.js intentionally left untagged
  (third-party).
- App still functional: _debug_parse.mjs 115/115 nodes; _debug_app.mjs and
  _debug_layout.mjs identical output pre/post-canary (verified via git stash).
- Self-scan (include-self): BF = 10^210, 21 hits / 14 files, all exact.
- Thief simulation: site copy scanned → BF 10^183 (18 hits; 3 file types
  were missed by a scanner bug, fixed same session: node_modules-prefix skip
  + 400-file cap starvation — see canary repo notes). Post-distillation
  (comment-stripped, normalized): comments die 11/11, literals survive 7/7 →
  BF = 10^84 decisive.
- Real-model probe (glm-5.3-flash via local ollama, 6 prefix probes): no
  hits — true negative, as expected for canaries minted today.

Canary-repo changes this session (uncommitted): src/tag.ts (in-place tagger
with double-tag guard), css/html/svg comment support in lib.ts, node_modules*
prefix skip in scan.ts + tag.ts. index.html/style.css/test-parse.html are
served surfaces of the github.io page — now covered.

Repo state: branch `test`, 14 modified tracked files (canary-tagged), NOT
committed, NOT pushed. Live site still serves pre-canary code. Next: decide
whether to commit/push to test branch (or a canary/* branch), then the
github.io surface becomes an observable canary surface.
