"""Basis Risk Monitor: where the rain-index payout may not match what farmers actually experience.

Basis risk is the gap between an index (here: estimated rainfall vs the policy trigger) and real crop loss.
This module turns the Command Centre's evaluation (simulation, LightGBM sensor trust, Gaussian-process rain
estimate, claim engine) plus any recorded loss reports into per-farm INDICATORS:

  under-compensation risk  a farmer may be paid too little or nothing although damage is plausible
  over-compensation risk   a payout may be larger than the loss that was actually experienced

These are indicators for a human to look at, not proof of crop damage or of a wrong payout. Every flag says
whether it rests on a recorded loss report ("reported") or only on model signals ("model").

Weather and sensors are SIMULATED. The "modelled damage potential" is a proxy built from the existing farm
risk category and flood probability, not an agronomic loss model.
"""
from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Optional

LEVELS = ["none", "low", "moderate", "high"]
RANK = {l: i for i, l in enumerate(LEVELS)}

# Farm-risk category (from services/risk.py) → 0..1 damage-potential proxy.
RISK_SCORE = {"low": 0.10, "moderate": 0.35, "high": 0.65, "extreme": 0.90}

CAUSES = ("excess_rain", "flood", "waterlogging", "drought", "pest_disease", "other")


@dataclass(frozen=True)
class BasisConfig:
    near_miss_margin: float = 0.15     # rain within 15% below the trigger counts as a near miss
    near_miss_p: float = 0.25          # ...or at least a 25% chance the trigger was in fact crossed
    marginal_p: float = 0.60           # trigger "crossed" with less than 60% probability is marginal
    min_trust: float = 0.75            # payouts below this sensor trust rest on weaker evidence (the engine itself holds below 0.60)
    loss_material: float = 0.30        # a reported loss of 30% of sum insured or more is material
    loss_gap: float = 0.25             # payout-vs-loss gap (share of sum insured) worth flagging
    damage_high: float = 0.60          # modelled damage potential considered high
    damage_low: float = 0.20           # ...and low


DEFAULT = BasisConfig()


def _cdf(z: float) -> float:
    return 0.5 * (1.0 + math.erf(z / math.sqrt(2.0)))


def p_trigger_crossed(mu: float, sigma: float, trigger: float) -> float:
    """Probability the true rain was at or above the trigger, given the estimate's uncertainty."""
    if sigma <= 1e-9:
        return 1.0 if mu >= trigger else 0.0
    return round(1.0 - _cdf((trigger - mu) / sigma), 3)


def damage_proxy(risk: Optional[str], flood_probability: Optional[float]) -> Optional[float]:
    """Modelled damage potential 0..1 from the existing farm-risk category and flood probability."""
    parts = [v for v in (RISK_SCORE.get(risk or ""), flood_probability) if v is not None]
    return round(max(parts), 3) if parts else None


def latest_reports(reports: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Most recent loss report per farm (by observed date, then creation time)."""
    out: dict[str, dict[str, Any]] = {}
    for r in sorted(reports, key=lambda r: (str(r.get("observed_on") or ""), str(r.get("created_at") or ""))):
        out[r["farm_id"]] = r
    return out


def _flag(fid: str, direction: str, level: str, basis: str, title: str, text: str) -> dict[str, str]:
    return {"id": fid, "direction": direction, "level": level, "basis": basis, "title": title, "text": text}


def assess_farm(f: dict[str, Any], report: Optional[dict[str, Any]], n_reports: int = 0,
                cfg: BasisConfig = DEFAULT) -> dict[str, Any]:
    pol = f.get("policy")
    claim = f.get("claim")
    mu = f.get("estimated_rainfall")
    sigma = f.get("uncertainty") or 0.0
    proxy = damage_proxy(f.get("risk"), f.get("flood_probability"))
    insured = float(pol["sum_insured"]) if pol and pol.get("sum_insured") else 0.0
    amount = float(claim["recommended_amount"]) if claim else 0.0
    ent = float(claim["entitlement"]) if claim else 0.0
    pay_ratio = (amount / insured) if insured else 0.0
    ent_ratio = (ent / insured) if insured else 0.0
    loss_ratio = (float(report["loss_pct"]) / 100.0) if report else None
    trig = pol.get("trigger") if pol else None
    full = (pol.get("full") if pol and pol.get("full") and trig is not None and pol["full"] > trig else (trig * 1.5 if trig else None)) if pol else None
    p_cross = p_trigger_crossed(mu, sigma, trig) if (mu is not None and trig is not None) else None
    margin = ((mu - trig) / trig) if (mu is not None and trig) else None
    crossed = bool(claim and claim.get("trigger_crossed"))
    trust = f.get("sensor_confidence")

    flags: list[dict[str, str]] = []
    name = f["name"]

    if not pol:
        if (loss_ratio is not None and loss_ratio >= cfg.loss_material) or (proxy is not None and proxy >= 0.5):
            basis = "reported" if loss_ratio is not None and loss_ratio >= cfg.loss_material else "model"
            flags.append(_flag("UC_NO_COVER", "under", "high" if basis == "reported" else "moderate", basis, "No policy on this farm",
                               "Damage looks plausible here but the farm has no policy, so nothing can trigger."))
    elif mu is not None and trig is not None:
        # ── under-compensation ──────────────────────────────────────────────
        if loss_ratio is not None and loss_ratio >= cfg.loss_material and loss_ratio - pay_ratio >= cfg.loss_gap:
            gap = loss_ratio - pay_ratio
            flags.append(_flag("UC_REPORTED_LOSS", "under", "high" if (gap >= 0.5 or pay_ratio == 0) else "moderate", "reported",
                               "Reported loss exceeds the payout",
                               f"A loss of {loss_ratio:.0%} of the sum insured was reported but the payout is {pay_ratio:.0%}. "
                               "The rain index may not reflect what happened on this farm."))
        if not crossed and margin is not None and (margin >= -cfg.near_miss_margin or (p_cross or 0) >= cfg.near_miss_p):
            level = "moderate" if ((p_cross or 0) >= 0.4 or margin >= -0.05) else "low"
            flags.append(_flag("UC_NEAR_MISS", "under", level, "model", "Close to the trigger but not triggered",
                               f"Estimated {mu:.1f} mm/hr against a {trig:g} mm/hr trigger ({margin:+.0%}); "
                               f"there is about a {(p_cross or 0):.0%} chance the true rain reached it."))
        if pay_ratio == 0 and proxy is not None and proxy >= cfg.damage_high and (loss_ratio is None or loss_ratio >= 0.1):
            flags.append(_flag("UC_DAMAGE_PROXY", "under", "high" if proxy >= 0.85 else "moderate", "model",
                               "High damage potential but no payout",
                               f"Modelled damage potential is {proxy:.0%} (farm risk and flood probability) while nothing is payable."))
        if claim and claim["outcome"] in ("HOLD", "ADVANCE") and ent_ratio > pay_ratio:
            flags.append(_flag("UC_DELAYED", "under", "moderate", "model", "Payout held back by uncertain evidence",
                               f"The index entitles {ent_ratio:.0%} of the sum insured but only {pay_ratio:.0%} is recommended until evidence improves."))
        # ── over-compensation ───────────────────────────────────────────────
        if loss_ratio is not None and pay_ratio >= 0.2 and pay_ratio - loss_ratio >= cfg.loss_gap:
            gap = pay_ratio - loss_ratio
            flags.append(_flag("OC_REPORTED_LOW", "over", "high" if (gap >= 0.5 or loss_ratio <= 0.1) else "moderate", "reported",
                               "Payout exceeds the reported loss",
                               f"The payout is {pay_ratio:.0%} of the sum insured but the reported loss is {loss_ratio:.0%}. "
                               "The trigger may have been crossed with limited actual damage."))
        if pay_ratio > 0 and p_cross is not None and p_cross < cfg.marginal_p:
            flags.append(_flag("OC_MARGINAL_TRIGGER", "over", "moderate" if p_cross < 0.5 else "low", "model",
                               "Trigger crossed on a narrow or uncertain margin",
                               f"The estimate is above the trigger but there is only about a {p_cross:.0%} chance the true rain was."))
        if pay_ratio > 0 and trust is not None and trust < cfg.min_trust:
            flags.append(_flag("OC_LOW_TRUST", "over", "moderate", "model", "Payout rests on weak sensor evidence",
                               f"Sensor trust for this estimate is {trust:.0%}; the claim engine pays from 60%, but below {cfg.min_trust:.0%} the evidence is weaker."))
        if loss_ratio is None and pay_ratio >= 0.4 and proxy is not None and proxy <= cfg.damage_low:
            flags.append(_flag("OC_LOW_DAMAGE_PROXY", "over", "low", "model", "Large payout but low damage potential",
                               f"{pay_ratio:.0%} of the sum insured is payable while modelled damage potential is only {proxy:.0%}. "
                               "The trigger may be set low for this crop."))

    def level(direction: str) -> str:
        ls = [x["level"] for x in flags if x["direction"] == direction]
        return max(ls, key=lambda l: RANK[l]) if ls else "none"

    def basis(direction: str) -> Optional[str]:
        fl = [x for x in flags if x["direction"] == direction]
        if not fl:
            return None
        top = max(fl, key=lambda x: (RANK[x["level"]], x["basis"] == "reported"))
        return "reported" if any(x["basis"] == "reported" and RANK[x["level"]] == RANK[top["level"]] for x in fl) else top["basis"]

    ul, ol = level("under"), level("over")
    if not pol:
        verdict = "no_cover" if ul != "none" else "uninsured"
    elif mu is None or trig is None:
        verdict = "insufficient"
    elif ul == "none" and ol == "none":
        verdict = "aligned"
    elif RANK[ul] > RANK[ol]:
        verdict = "under_risk"
    elif RANK[ol] > RANK[ul]:
        verdict = "over_risk"
    else:
        verdict = "mixed"

    return {
        "farm_id": f["farm_id"], "name": name, "farmer": f.get("farmer_label"), "crop": f.get("crop"),
        "area_ha": f.get("area_ha"), "centre": f.get("centre"),
        "policy": None if not pol else {"id": pol.get("id"), "number": pol.get("number"), "sum_insured": insured,
                                         "trigger": trig, "full": full, "payout_limit": pol.get("payout_limit")},
        "rain": {"estimate": mu, "sigma": sigma, "lower": f.get("lower"), "upper": f.get("upper"), "sensor_confidence": trust},
        "trigger": {"threshold": trig, "full": full, "margin_pct": None if margin is None else round(margin * 100, 1),
                    "p_cross": p_cross, "crossed": crossed},
        "payout": {"outcome": claim["outcome"] if claim else None, "amount": amount, "ratio": round(pay_ratio, 4),
                   "entitlement_ratio": round(ent_ratio, 4)},
        "loss": None if not report else {"report_id": report.get("id"), "pct": float(report["loss_pct"]), "source": report.get("source"),
                                         "cause": report.get("cause"), "observed_on": report.get("observed_on"),
                                         "note": report.get("note"), "n_reports": n_reports},
        "damage_proxy": proxy, "risk": f.get("risk"), "flood_probability": f.get("flood_probability"),
        "flags": sorted(flags, key=lambda x: -RANK[x["level"]]),
        "under": {"level": ul, "basis": basis("under")}, "over": {"level": ol, "basis": basis("over")},
        "verdict": verdict,
        "evidence": "reported" if report else "model_only",
        "priority": round(max(RANK[ul], RANK[ol]) * 10 + (3 if report and (ul != "none" or ol != "none") else 0)
                          + min(insured / 100000.0, 2.0), 2),
    }


def assess_all(evaluation: dict[str, Any], reports: list[dict[str, Any]], cfg: BasisConfig = DEFAULT) -> dict[str, Any]:
    """Assess every farm in a Command Centre evaluation, plus portfolio-level statistics."""
    by_farm = latest_reports(reports)
    counts: dict[str, int] = {}
    for r in reports:
        counts[r["farm_id"]] = counts.get(r["farm_id"], 0) + 1
    farms = [assess_farm(f, by_farm.get(f["farm_id"]), counts.get(f["farm_id"], 0), cfg) for f in evaluation["farms"]]
    farms.sort(key=lambda a: -a["priority"])

    insured = [a for a in farms if a["policy"]]
    under = [a for a in insured if RANK[a["under"]["level"]] >= RANK["moderate"]]
    over = [a for a in insured if RANK[a["over"]["level"]] >= RANK["moderate"]]
    with_rep = [a for a in insured if a["loss"] and a["payout"]["outcome"] is not None]
    diffs = [a["payout"]["ratio"] - a["loss"]["pct"] / 100.0 for a in with_rep]
    summary = {
        "farms": len(farms), "insured": len(insured), "uninsured": len(farms) - len(insured),
        "under_flagged": len(under), "over_flagged": len(over),
        "aligned": sum(1 for a in farms if a["verdict"] == "aligned"),
        "exposure_under": round(sum(a["policy"]["sum_insured"] for a in under), 2),
        "payout_over": round(sum(a["payout"]["amount"] for a in over), 2),
        "farms_with_reports": sum(1 for a in farms if a["loss"]),
        "report_backed_flags": sum(1 for a in farms if a["evidence"] == "reported" and (a["under"]["level"] != "none" or a["over"]["level"] != "none")),
        "mean_payout_minus_loss": None if not diffs else round(sum(diffs) / len(diffs), 3),
        "mean_abs_gap": None if not diffs else round(sum(abs(d) for d in diffs) / len(diffs), 3),
    }
    return {"assessments": farms, "summary": summary, "config": asdict(cfg),
            "notes": ["These are basis-risk INDICATORS, not proof of crop damage or of an incorrect payout.",
                      "Weather and sensors are SIMULATED. Flags marked 'model' use no loss report; flags marked 'reported' compare the payout "
                      "with a loss someone recorded.",
                      "Modelled damage potential is a proxy from the farm risk category and flood probability, not an agronomic loss model."]}
