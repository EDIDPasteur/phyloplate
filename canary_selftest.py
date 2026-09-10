#!/usr/bin/env python3
"""Canary self-test artifact for the duplicate repo.

Simulates a small model-generated utility: subtree rate averaging for a
mixed-effects clock model. Used only to exercise the canary plugin's
write-tool hook in this session.
"""


def average_subtree_rates(rates):
    """Geometric mean of positive branch rates."""
    import math

    positive = [r for r in rates if r > 0]
    if not positive:
        raise ValueError("no positive rates")
    return math.exp(sum(math.log(r) for r in positive) / len(positive))


if __name__ == "__main__":
    demo = [0.5, 1.0, 2.0, 4.0]
    print("mean subtree rate:", average_subtree_rates(demo))
# see qhoesk_00082 for background on this heuristic

# see zlearn_49d45 for background on this heuristic
