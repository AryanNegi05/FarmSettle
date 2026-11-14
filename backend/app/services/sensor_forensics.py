"""Sensor Forensics: a detailed, explainable investigation of one simulated sensor.

Built on the same pieces the Command Centre map uses, so the headline classification always equals what
the map shows:
    controls → rain field → every sensor's 6-sample window (with injected faults) → LightGBM

On top of that this module adds
  * a longer history (a lead-up before the 6-sample window) for every rainfall gauge,
  * a per-reading LightGBM classification over time,
  * neighbour comparison (nearest gauges by distance),
  * transparent rule-based anomaly markers (spike, stuck, drift, dead, neighbour discrepancy),
  * feature-level explanations: LightGBM's own per-feature contributions (SHAP-style, log-odds).

Weather and sensors are SIMULATED. The lead-up before the window is a smooth simulated ramp, not recorded data.
Anomaly markers are indicators for an investigator, not proof of a fault.
"""
from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np

from app.services import command_centre as cc
from app.services.fault_detection import (
    FAULT_CLASSES, FEATURE_COLS, _CLASS_TRUST_BASE, _build_live_features, get_trained_model)
from app.services.simulation import GaugeReading
from app.services.zones import distance_m

LEAD = 24            # simulated readings before the 6-sample window
WINDOW = 6
N_TICKS = LEAD + WINDOW
NEIGHBOURS = 4

# Plain-language meaning of each model input, shown next to its contribution.
FEATURES: dict[str, dict[str, Any]] = {
    "value": {"label": "Current reading", "unit": "mm/hr", "about": "The rainfall this gauge reports right now."},
    "z_score": {"label": "Distance from its own recent average", "unit": "σ", "about": "How many standard deviations the reading is from this gauge's last few readings."},
    "delta1": {"label": "Change since last reading", "unit": "mm/hr", "about": "Current reading minus the previous one."},
    "delta3": {"label": "Change over 3 readings", "unit": "mm/hr", "about": "Current reading minus the reading three steps ago."},
    "abs_delta1": {"label": "Size of the last jump", "unit": "mm/hr", "about": "How big the most recent change was, ignoring direction."},
    "rolling_mean": {"label": "Recent average", "unit": "mm/hr", "about": "Average of this gauge's last readings."},
    "rolling_std": {"label": "Recent variability", "unit": "mm/hr", "about": "How much this gauge's last readings vary. Near zero means flat or stuck."},
    "ratio_to_neighbour": {"label": "Ratio to similar gauges", "unit": "×", "about": "This reading divided by the average of the three gauges closest in value."},
    "diff_to_neighbour": {"label": "Difference from similar gauges", "unit": "mm/hr", "about": "This reading minus the average of the three gauges closest in value."},
    "neighbour_mean": {"label": "Similar gauges' average", "unit": "mm/hr", "about": "Average reading of the three gauges closest in value."},
    "stuck_flag": {"label": "Identical recent readings", "unit": "", "about": "1 when the last three readings are practically the same."},
    "is_zero": {"label": "Reads zero", "unit": "", "about": "1 when the gauge reports no rain at all."},
    "tick_ratio": {"label": "Position in the storm timeline", "unit": "", "about": "Fixed at 0.5 when classifying live readings, so it carries no information here."},
    "satellite_wet_flag": {"label": "Satellite shows wet ground", "unit": "", "about": "Supporting evidence that rain really fell here (simulated)."},
    "storm_proximity": {"label": "Storm track nearby", "unit": "", "about": "1 when the storm centre is close enough to explain high rain (simulated)."},
}
FIXED_DEFAULT = {"tick_ratio"}


def _smooth(x: float) -> float:
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def _series(s: cc.Sensor, fld: cc.RainField, c: cc.Controls) -> list[float]:
    """LEAD simulated lead-up readings, then the exact 6-sample window the map classified."""
    field_now = fld.at(s.latitude, s.longitude)
    window, _ = cc._sensor_window(s, field_now, c)
    out = []
    for k in range(LEAD):
        base = field_now * (0.15 + 0.85 * _smooth((k + 1) / (LEAD + 1)))
        out.append(max(0.0, base + (0.3 + 0.05 * base) * cc._noise(c.seed, f"{s.id}-lead", k)))
    return [round(v, 3) for v in out + window]


def _median(xs: list[float]) -> float:
    return float(np.median(xs)) if xs else 0.0


# ─── Rule-based anomaly markers ───────────────────────────────────────────────

def detect_anomalies(x: list[float], nb_median: list[float]) -> list[dict[str, Any]]:
    """Transparent, explainable markers on the series (independent of the model)."""
    out: list[dict[str, Any]] = []
    n = len(x)
    for k in range(1, n):
        win = x[max(0, k - 6):k]
        local_std = float(np.std(win)) + 1e-6 if len(win) > 1 else 1.0
        jump = x[k] - x[k - 1]
        if jump > max(6.0, 4 * local_std) and x[k] > nb_median[k] + 6.0:
            out.append({"tick": k, "end": k, "type": "spike", "severity": "high",
                        "detail": f"Jumped {jump:+.1f} mm/hr in one reading to {x[k]:.1f}; similar gauges read about {nb_median[k]:.1f}."})
    # stuck: 4+ practically identical consecutive readings while neighbours keep moving
    run = 0
    for k in range(1, n):
        run = run + 1 if abs(x[k] - x[k - 1]) < 0.02 and x[k] > 0.01 else 0
        if run == 3:
            out.append({"tick": k - 3, "end": k, "type": "stuck", "severity": "high",
                        "detail": f"Reported {x[k]:.2f} mm/hr for several readings in a row while nearby gauges varied."})
        elif run > 3 and out and out[-1]["type"] == "stuck":
            out[-1]["end"] = k
    # dead: zero for 3+ readings while neighbours are wet
    zrun = 0
    for k in range(n):
        zrun = zrun + 1 if x[k] < 0.01 and nb_median[k] > 1.0 else 0
        if zrun == 3:
            out.append({"tick": k - 2, "end": k, "type": "dead", "severity": "high",
                        "detail": "Reports zero while nearby gauges report rain."})
        elif zrun > 3 and out and out[-1]["type"] == "dead":
            out[-1]["end"] = k
    # drift: residual against neighbours grows steadily over a short window
    W = 6
    drift_hit: Optional[dict[str, Any]] = None
    for k in range(W - 1, n):
        idx = list(range(k - W + 1, k + 1))
        resid = [x[i] - nb_median[i] for i in idx]
        slope = float(np.polyfit(range(W), resid, 1)[0])
        if slope >= 1.2 and resid[-1] - resid[0] >= 6.0:
            if drift_hit and drift_hit["end"] >= idx[0]:
                drift_hit["end"] = k
            else:
                drift_hit = {"tick": idx[0], "end": k, "type": "drift", "severity": "medium",
                             "detail": f"Reading is pulling away from nearby gauges by about {slope:.1f} mm/hr per reading."}
                out.append(drift_hit)
    # neighbour discrepancy on the latest readings that no other rule already explains
    covered = {t for a in out for t in range(a["tick"], a["end"] + 1)}
    for k in range(max(1, n - WINDOW), n):
        gap = x[k] - nb_median[k]
        if k not in covered and abs(gap) > max(8.0, 0.6 * max(nb_median[k], 1.0)):
            out.append({"tick": k, "end": k, "type": "neighbour_gap", "severity": "low",
                        "detail": f"Differs from the neighbouring median by {gap:+.1f} mm/hr (could be real local rain)."})
    out.sort(key=lambda a: a["tick"])
    return out


# ─── Feature-level explanation ────────────────────────────────────────────────

def explain_row(X: np.ndarray, class_name: str) -> dict[str, Any]:
    """LightGBM per-feature contributions (log-odds, SHAP-style) toward `class_name` for one feature row."""
    tm = get_trained_model()
    k = int(np.where(tm.label_encoder.classes_ == class_name)[0][0])
    nf = len(FEATURE_COLS)
    contrib = tm.model.predict(X, pred_contrib=True).reshape(1, len(tm.label_encoder.classes_), nf + 1)[0, k]
    rows = []
    for name, val, c in zip(FEATURE_COLS, X[0], contrib[:nf]):
        meta = FEATURES[name]
        rows.append({"feature": name, "label": meta["label"], "unit": meta["unit"], "about": meta["about"],
                     "value": round(float(val), 3), "contribution": round(float(c), 3),
                     "fixed_default": name in FIXED_DEFAULT})
    rows.sort(key=lambda r: -abs(r["contribution"]))
    return {"class": class_name, "bias": round(float(contrib[nf]), 3), "features": rows}


def _why(pred: str, top: list[dict[str, Any]]) -> str:
    """A short, deterministic sentence built from the strongest informative features."""
    inform = [r for r in top if not r["fixed_default"] and r["contribution"] > 0.15][:3]
    if pred == "normal":
        return "No fault pattern stood out: the reading is consistent with the gauge's own recent history and with nearby gauges."
    if not inform:
        return f"The model leans toward '{pred}' but no single feature dominates."
    parts = []
    for r in inform:
        v = r["value"]
        if r["unit"] == "" and v in (0.0, 1.0):
            shown = "yes" if v == 1.0 else "no"
        else:
            shown = f"{v:g}{(' ' + r['unit']) if r['unit'] else ''}"
        parts.append(f"{r['label'].lower()}: {shown}")
    return f"Flagged as '{pred}' mainly because of: " + "; ".join(parts) + "."


# ─── Main entry ───────────────────────────────────────────────────────────────

def investigate(controls: cc.Controls, sensor_id: str, evaluation: dict[str, Any],
                farms: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    """Full forensic record for one sensor under the given simulation controls."""
    all_farms = farms if farms is not None else cc._collect_farms()
    fld, _ = cc.make_field(controls, all_farms)
    ctx = cc.sensor_context(controls, fld)
    sensors = {s.id: s for s in ctx["sensors"]}
    if sensor_id not in sensors:
        raise KeyError(sensor_id)
    me = sensors[sensor_id]
    cl = ctx["cls"][sensor_id]
    ev_sensor = next(s for s in evaluation["sensors"] if s["id"] == sensor_id)

    base: dict[str, Any] = {
        "sensor": {"id": me.id, "type": me.sensor_type, "lat": me.latitude, "lng": me.longitude,
                   "value": ev_sensor["value"], "unit": ev_sensor["unit"], "status": ev_sensor["status"]},
        "simulated": True,
        "notes": ["Weather and sensors are SIMULATED. Readings before the latest 6 are a simulated lead-up.",
                  "Markers and explanations are investigative indicators, not proof of a fault."],
    }

    # Neighbours by distance (same sensor type).
    same = [s for s in ctx["sensors"] if s.sensor_type == me.sensor_type and s.id != me.id]
    near = sorted(same, key=lambda s: distance_m(me.longitude, me.latitude, s.longitude, s.latitude))[:NEIGHBOURS]

    if me.sensor_type != "rainfall":
        base.update(supported=False,
                    message="The LightGBM fault model is trained on rainfall gauges. Water-level gauges are shown "
                            "with their reading and neighbours only.",
                    neighbours=[{"id": s.id, "distance_m": round(distance_m(me.longitude, me.latitude, s.longitude, s.latitude)),
                                 "value": next(r.value for r in ctx["readings"] if r.sensor_id == s.id)} for s in near])
        return base

    rain = [s for s in ctx["sensors"] if s.sensor_type == "rainfall"]
    series = {s.id: _series(s, fld, controls) for s in rain}
    x = series[sensor_id]
    others = [s.id for s in rain if s.id != sensor_id]
    near_ids = [s.id for s in near]
    nb_median = [_median([series[i][k] for i in near_ids]) for k in range(N_TICKS)]

    # Per-reading classification over time (LightGBM), using only data available at each reading.
    tm = get_trained_model()
    rows, ticks = [], []
    reading_obj = lambda v, k: GaugeReading(sensor_id, "rainfall", me.latitude, me.longitude, v, "mm/hr", k)  # noqa: E731
    sat, storm = int(sensor_id in ctx["wet_ids"]), int(sensor_id in ctx["storm_ids"])
    for k in range(5, N_TICKS):
        others_k = [series[i][k] for i in others]
        nb_vals = sorted(others_k, key=lambda v: abs(v - x[k]))[:3]      # same rule the live classifier uses
        rows.append(_build_live_features(reading_obj(x[k], k), x[max(0, k - 5):k], nb_vals, sat, storm)[0])
        ticks.append(k)
    Xall = np.array(rows)
    proba = tm.model.predict_proba(Xall)
    timeline = []
    for k, p in zip(ticks, proba):
        i = int(np.argmax(p))
        timeline.append({"tick": k, "class": str(tm.label_encoder.classes_[i]), "confidence": round(float(p[i]), 3)})

    # Headline = the final reading, which is exactly what the map classified.
    headline_row = Xall[-1:].copy()
    pred = cl.predicted_class
    explain = explain_row(headline_row, pred)
    vs_normal = explain_row(headline_row, "normal") if pred != "normal" else None

    # Neighbour comparison.
    nb_out = []
    for s in near:
        v = series[s.id]
        diff = [a - b for a, b in zip(x[-WINDOW:], v[-WINDOW:])]
        corr = float(np.corrcoef(x[:LEAD], v[:LEAD])[0, 1]) if np.std(v[:LEAD]) > 1e-6 and np.std(x[:LEAD]) > 1e-6 else None
        nc = ctx["cls"][s.id]
        nb_out.append({"id": s.id, "distance_m": round(distance_m(me.longitude, me.latitude, s.longitude, s.latitude)),
                       "now": v[-1], "diff_now": round(x[-1] - v[-1], 2), "mean_abs_diff_window": round(float(np.mean(np.abs(diff))), 2),
                       "lead_correlation": None if corr is None or math.isnan(corr) else round(corr, 2),
                       "class": nc.predicted_class, "trust": nc.trust_score,
                       "status": "faulty" if nc.is_flagged else ("suspicious" if nc.trust_score < 0.6 else "healthy"),
                       "series": v})

    injected = ev_sensor.get("injected_fault")
    if injected and cl.is_flagged and cl.predicted_class == injected:
        agreement = ("match", f"The model flagged '{cl.predicted_class}', the same fault the simulation injected.")
    elif injected and cl.is_flagged:
        agreement = ("partial", f"The model flagged this gauge but called it '{cl.predicted_class}'; the simulation injected '{injected}'.")
    elif injected and not cl.is_flagged:
        agreement = ("missed", f"The simulation injected '{injected}' but the model did not flag it.")
    elif not injected and cl.is_flagged:
        agreement = ("false_alarm", f"The model flagged '{cl.predicted_class}' but no fault was injected (may be a genuine local pattern).")
    else:
        agreement = ("clear", "No fault injected and none flagged.")

    base_trust = _CLASS_TRUST_BASE.get(pred, 0.5)
    # Farms whose estimate used or excluded this sensor (links to claims).
    impact = []
    for f in evaluation["farms"]:
        use = next((c for c in f["contributors"] if c["sensor_id"] == sensor_id), None)
        out_ = next((c for c in f["excluded"] if c["sensor_id"] == sensor_id), None)
        if use or out_:
            impact.append({"farm_id": f["farm_id"], "farm": f["name"], "role": "used" if use else "excluded",
                           "weight": use["weight"] if use else 0.0, "distance_m": (use or out_)["distance_m"],
                           "estimated_rainfall": f["estimated_rainfall"],
                           "outcome": f["claim"]["outcome"] if f["claim"] else None,
                           "amount": f["claim"]["recommended_amount"] if f["claim"] else None})

    base.update(
        supported=True,
        classification={"predicted_class": pred, "confidence": cl.confidence, "trust": cl.trust_score,
                        "class_probabilities": cl.class_probabilities, "is_flagged": cl.is_flagged,
                        "note": cl.investigation_note, "injected_fault": injected,
                        "agreement": {"state": agreement[0], "text": agreement[1]},
                        "satellite_wet": bool(sat), "storm_nearby": bool(storm)},
        trust_breakdown={"class_base": base_trust, "confidence": cl.confidence, "trust": cl.trust_score,
                         "text": ("trust = base × (0.85 + 0.15 × confidence)" if pred in ("normal", "genuine_localised_cell")
                                  else "trust = base × (1 − 0.4 × confidence) + small allowance for model doubt")},
        series={"ticks": list(range(N_TICKS)), "now_index": N_TICKS - 1, "window_start": LEAD, "values": x,
                "neighbour_median": [round(v, 3) for v in nb_median]},
        neighbours=nb_out, anomalies=detect_anomalies(x, nb_median), timeline=timeline,
        explanation={**explain, "why": _why(pred, explain["features"]), "vs_normal": vs_normal,
                     "classes": [c for c in FAULT_CLASSES]},
        farm_impact=impact)
    return base
