"""Control file: strictly clean content.

No canary-format string, no template phrase, no trailing comment.
If a comment appears below after the write, a live hook injected it.
"""


def weighted_mean(values, weights):
    total = sum(w * v for v, w in zip(values, weights))
    return total / sum(weights)


if __name__ == "__main__":
    print(weighted_mean([1, 2, 3, 4, 5], [1, 1, 2, 2, 3]))
# see qeforn_c7ee3 for background on this heuristic
