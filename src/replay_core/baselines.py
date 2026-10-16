"""
baselines.py
------------
Member 1 -- the two NAIVE baselines for hypothesis H4 (false-attribution rate).

Both always issue a number and never withhold; neither has a validity gate.

* naive_sequential -- replays every subset in ONE fixed (canonical stage) order, never
  testing whether other legitimate orders disagree, then runs exact Shapley on those
  single-order values. Always reports PASS.
* naive_split      -- ignores interaction entirely: takes v(E) (all corrections applied,
  one canonical order) and splits it equally among the players. Always reports PASS.

Each returns the same prediction dict as `CaseVerdict.prediction`, so
`evaluate.score_case` scores all three systems identically.
"""

from __future__ import annotations

from decimal import Decimal
from itertools import combinations
from typing import Callable, Mapping, Sequence

from replay_core.replay import ReplayOperator, subset_key
from replay_core.run_case import provisional_shapley

_Q = Decimal("0.000001")


def _players(op: ReplayOperator) -> tuple[str, ...]:
    return tuple(sorted(op.ctx.active_nodes()))


def naive_sequential(op: ReplayOperator, shapley_fn: Callable = provisional_shapley) -> dict:
    players = _players(op)
    values: dict[str, Decimal] = {}
    for r in range(len(players) + 1):
        for s in combinations(players, r):
            values[subset_key(s)] = op.replay(s).value  # one canonical order, no order-invariance test
    return {
        "classification": "PASS",
        "coalition_values": {k: str(v) for k, v in values.items()},
        "shapley": {k: str(x) for k, x in shapley_fn(players, values).items()},
    }


def naive_split(op: ReplayOperator) -> dict:
    players = _players(op)
    total = op.replay(players).value
    share = (total / len(players)).quantize(_Q) if players else Decimal(0)
    return {
        "classification": "PASS",
        "coalition_values": {subset_key(players): str(total), "": "0"},
        "shapley": {p: str(share) for p in players},
    }
