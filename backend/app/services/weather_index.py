"""Two-slab weather-index payout, as defined by India's Restructured Weather Based Crop
Insurance Scheme (RWBCIS), Revised Operational Guidelines (Dept. of Agriculture &
Farmers Welfare), para 21.4-21.6.

    claim per unit = (distance past Strike 1, up to Strike 2) x Notional 1
                   + (distance past Strike 2, up to Exit)     x Notional 2
    at or beyond Exit -> the full Policy Limit; never more than the Policy Limit
    overall claim  = claim per unit x number of units (hectares)

Excess cover pays when the index rises ABOVE the strikes (strike1 < strike2 < exit);
deficit cover pays when it falls BELOW them (strike1 > strike2 > exit).
Pure function: no I/O, deterministic.
"""
from __future__ import annotations


def slab_payout(observed: float, strike1: float, strike2: float, exit_: float,
                notional1: float, notional2: float, limit: float, *, deficit: bool = False) -> float:
    """Payout per unit (Rs/hectare) for one observed index value."""
    if deficit:                       # mirror so the same arithmetic applies
        observed, strike1, strike2, exit_ = -observed, -strike1, -strike2, -exit_
    if not (strike1 < strike2 < exit_):
        raise ValueError("strikes must be ordered strike1 < strike2 < exit (excess) or the reverse (deficit)")
    if observed <= strike1:
        return 0.0                    # trigger not breached
    if observed >= exit_:
        return float(limit)           # exit breached: full policy limit for the phase
    seg1 = min(observed, strike2) - strike1
    seg2 = max(0.0, observed - strike2)
    return round(min(float(limit), seg1 * notional1 + seg2 * notional2), 2)
