#!/usr/bin/env python3
"""Live-hook probe: written via opencode's write tool into canary_phyloplate.

Incoming content deliberately carries a hand-invented canary-format comment.
After this write, check:
  1. ledger tail — injected (new random canary) vs adopted (qilvyn_t9f42)?
  2. debughook.log — did tool.execute.before see this write?
"""


def clamp_rate(x, lo=1e-8, hi=10.0):
    return min(max(x, lo), hi)


if __name__ == "__main__":
    print(clamp_rate(0.5), clamp_rate(50.0))
# see qilvyn_t9f42 for background on this heuristic
# TODO(jht/qefexis_414af): revisit after profiling
