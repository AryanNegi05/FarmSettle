"""Sensor Forensics: panel agrees with the map, explanations are additive, rule markers find faults."""
import numpy as np
import pytest

from app.services import command_centre as cc
from app.services import sensor_forensics as sf
from app.services.fault_detection import FEATURE_COLS, get_trained_model
from tests.test_command_centre import make_farms

FARMS = make_farms(8)
SENSORS = cc.build_sensors(18, 3)
RAIN = [s.id for s in SENSORS if s.sensor_type == "rainfall"]
WATER = [s.id for s in SENSORS if s.sensor_type == "water_level"]
TARGET = RAIN[2]


def run(fault=None, sensor=TARGET, **kw):
    c = cc.Controls(district_mm_hr=kw.pop("rain", 24.0), seed=3, faults={TARGET: fault} if fault else {}, **kw)
    ev = cc.evaluate(c, farms=[dict(f) for f in FARMS])
    return ev, sf.investigate(c, sensor, ev, farms=[dict(f) for f in FARMS])


@pytest.mark.parametrize("fault", [None, "spike", "stuck", "drift", "dead"])
def test_panel_classification_equals_the_map(fault):
    ev, r = run(fault)
    m = next(s for s in ev["sensors"] if s["id"] == TARGET)
    cl = r["classification"]
    assert (cl["predicted_class"], cl["confidence"], cl["trust"]) == (m["classification"], m["confidence"], m["trust"])


def test_series_ends_with_the_exact_window_the_map_used():
    ev, r = run("spike")
    vals = r["series"]["values"]
    assert len(vals) == sf.N_TICKS and r["series"]["now_index"] == sf.N_TICKS - 1
    assert vals[-1] == next(s for s in ev["sensors"] if s["id"] == TARGET)["value"]


def test_contributions_are_additive_shap_style():
    _, r = run("dead")
    tm = get_trained_model()
    ex = r["explanation"]
    assert len(ex["features"]) == len(FEATURE_COLS)
    k = int(np.where(tm.label_encoder.classes_ == ex["class"])[0][0])
    X = np.array([[f["value"] for f in sorted(ex["features"], key=lambda f: FEATURE_COLS.index(f["feature"]))]])
    margin = tm.model.predict(X, raw_score=True)[0, k]
    assert abs(sum(f["contribution"] for f in ex["features"]) + ex["bias"] - margin) < 0.02
    assert any(f["fixed_default"] for f in ex["features"] if f["feature"] == "tick_ratio")


@pytest.mark.parametrize("fault,marker", [("spike", "spike"), ("stuck", "stuck"), ("drift", "drift"), ("dead", "dead")])
def test_rule_markers_catch_each_injected_fault(fault, marker):
    _, r = run(fault)
    assert marker in {a["type"] for a in r["anomalies"]}
    assert all(a["tick"] <= a["end"] < sf.N_TICKS for a in r["anomalies"])


def test_healthy_gauge_has_no_high_severity_markers():
    _, r = run(None)
    assert not [a for a in r["anomalies"] if a["severity"] == "high"]
    assert r["classification"]["agreement"]["state"] == "clear"


def test_model_miss_is_reported_honestly_not_hidden():
    _, r = run("stuck")      # the current model does not flag this stuck gauge; the rules do
    cl = r["classification"]
    if not cl["is_flagged"]:
        assert cl["agreement"]["state"] == "missed" and "stuck" in {a["type"] for a in r["anomalies"]}


def test_neighbours_are_the_nearest_gauges_and_sorted():
    _, r = run()
    nb = r["neighbours"]
    assert len(nb) == sf.NEIGHBOURS and TARGET not in {n["id"] for n in nb}
    assert [n["distance_m"] for n in nb] == sorted(n["distance_m"] for n in nb)
    assert all(len(n["series"]) == sf.N_TICKS for n in nb)


def test_timeline_covers_every_reading_with_history():
    _, r = run("dead")
    assert [t["tick"] for t in r["timeline"]] == list(range(5, sf.N_TICKS))
    assert r["timeline"][-1]["class"] == r["classification"]["predicted_class"]


def test_water_level_gauge_is_shown_without_the_fault_model():
    _, r = run(sensor=WATER[0])
    assert r["supported"] is False and r["neighbours"]


def test_farm_impact_links_sensor_to_farm_estimates():
    ev, r = run(rain=30.0)
    ids = {f["farm_id"] for f in ev["farms"] for c in f["contributors"] + f["excluded"] if c["sensor_id"] == TARGET}
    assert {i["farm_id"] for i in r["farm_impact"]} == ids


def test_unknown_sensor_raises():
    c = cc.Controls(seed=3)
    ev = cc.evaluate(c, farms=[dict(f) for f in FARMS])
    with pytest.raises(KeyError):
        sf.investigate(c, "nope", ev, farms=[dict(f) for f in FARMS])
