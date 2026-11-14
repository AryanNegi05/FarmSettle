"""Stage 13: command-centre evaluator on the shared land (farms are built in the test; no Firestore)."""
from datetime import date, timedelta

import pytest

from app.services import command_centre as cc
from app.services import land
from app.services.zones import distance_m, fitted_circle


def square(lng, lat, half_m):
    kx, ky = land.metres_per_degree(lat)
    dx, dy = half_m / kx, half_m / ky
    return [[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]


def make_farms(n=8, with_policy=True):
    farms = []
    for i, (lng, lat) in enumerate(land.spread_points(n, seed=5, inset=0.15)):
        policy = None
        if with_policy:
            trig = [15.0, 20.0, 25.0, 30.0][i % 4]
            policy = {"id": f"P{i}", "policy_number": f"POL-{i}", "farm_id": f"F{i}", "status": "active",
                      "coverage_start": date.today() - timedelta(days=30), "coverage_end": date.today() + timedelta(days=300),
                      "sum_insured": 60000.0 + 5000 * i, "rainfall_trigger_mm": trig, "rainfall_max_payout_mm": trig + 40.0,
                      "payout_limit": None}
        farms.append({"farm_id": f"F{i}", "name": f"Farm {i}", "farmer_id": f"U{i}", "farmer_profile_id": f"U{i}",
                      "farmer_label": f"Farmer {i}", "crop": "cotton", "ring": square(lng, lat, 30 + 4 * i),
                      "area_ha": 0.4 + 0.1 * i, "policy": policy, "image_url": None})
    return farms


@pytest.fixture(scope="module")
def farms():
    return make_farms()


def run(farms, **kw):
    return cc.evaluate(cc.Controls(**kw), farms=[dict(f) for f in farms])


def test_sensors_are_spread_inside_the_land_and_reproducible():
    a = cc.build_sensors(18, seed=3)
    b = cc.build_sensors(18, seed=3)
    assert [(s.id, s.latitude, s.longitude) for s in a] == [(s.id, s.latitude, s.longitude) for s in b]
    assert len(a) == 18
    for s in a:
        assert land.contains(s.longitude, s.latitude)
    # different seeds give different layouts
    assert [(s.latitude, s.longitude) for s in cc.build_sensors(18, seed=4)] != [(s.latitude, s.longitude) for s in a]


def test_changing_sensor_count_keeps_earlier_rain_gauges_in_place():
    small = {s.id: (s.latitude, s.longitude) for s in cc.build_sensors(18, seed=1) if s.sensor_type == "rainfall"}
    big = {s.id: (s.latitude, s.longitude) for s in cc.build_sensors(30, seed=1) if s.sensor_type == "rainfall"}
    for sid, pos in small.items():
        assert big[sid] == pos


def test_each_farm_has_a_circle_covering_it(farms):
    r = run(farms, district_mm_hr=10)
    for f in r["farms"]:
        for lng, lat in f["ring"]:
            assert distance_m(f["centre"][0], f["centre"][1], lng, lat) <= f["circle_radius_m"]


def test_deterministic(farms):
    a = run(farms, district_mm_hr=20, faults={"RG-03": "spike"})
    b = run(farms, district_mm_hr=20, faults={"RG-03": "spike"})
    strip = lambda r: {k: v for k, v in r.items() if k != "elapsed_ms"}
    assert strip(a) == strip(b)


def test_healthy_network_is_not_flagged_in_calm_or_heavy_rain(farms):
    for mm in (2.0, 14.0, 38.0):
        assert run(farms, district_mm_hr=mm)["summary"]["flagged_sensors"] == 0, f"false flags at {mm} mm/hr"


def test_dead_sensor_is_detected_and_excluded_from_farm_estimates(farms):
    r = run(farms, district_mm_hr=16, faults={"RG-08": "dead"})
    assert {s["id"]: s for s in r["sensors"]}["RG-08"]["status"] == "faulty"
    for f in r["farms"]:
        assert "RG-08" not in [c["sensor_id"] for c in f["contributors"]]


def test_more_rain_never_lowers_total_liability(farms):
    low = run(farms, district_mm_hr=5)["summary"]["total_liability"]
    mid = run(farms, district_mm_hr=25)["summary"]["total_liability"]
    high = run(farms, district_mm_hr=50)["summary"]["total_liability"]
    assert low <= mid <= high and high > low


def test_payouts_never_exceed_sum_insured(farms):
    for f in run(farms, district_mm_hr=90)["farms"]:
        assert f["claim"]["recommended_amount"] <= f["policy"]["sum_insured"]


def test_farms_without_a_policy_get_no_payout(farms):
    r = run(make_farms(4, with_policy=False), district_mm_hr=60)
    assert all(f["claim"] is None and f["policy"] is None for f in r["farms"])
    assert r["summary"]["farms_without_policy"] == 4 and r["summary"]["total_liability"] == 0


def test_storm_centred_on_a_farm_hits_it_harder_than_a_distant_one(farms):
    ring = farms[0]["ring"]
    clng, clat = fitted_circle(ring)["centre"]
    storm = {"peak_mm_hr": 150.0, "radius_m": 80.0, "lat": clat, "lng": clng}
    r = run(farms, district_mm_hr=2, storm=storm)
    truth = {f["farm_id"]: f["true_rainfall"] for f in r["farms"]}
    assert truth["F0"] > 100
    assert truth["F0"] > max(v for k, v in truth.items() if k != "F0")


def test_local_adjustment_changes_only_that_farm_ground_truth(farms):
    base = {f["farm_id"]: f["true_rainfall"] for f in run(farms, district_mm_hr=10)["farms"]}
    adj = {f["farm_id"]: f["true_rainfall"] for f in run(farms, district_mm_hr=10, farm_adjust={"F2": 60.0})["farms"]}
    assert adj["F2"] > base["F2"] + 50
    far = [k for k in base if k != "F2"]
    # farms further from F2 are barely affected by a 60 mm/hr local cell
    d = {f["farm_id"]: distance_m(*f["centre"], *run(farms[2:3], district_mm_hr=1)["farms"][0]["centre"]) for f in run(farms)["farms"]}
    farthest = max(far, key=lambda k: d[k])
    assert abs(adj[farthest] - base[farthest]) < 5


def test_sensor_estimate_can_differ_from_ground_truth(farms):
    """Basis risk: a tiny local cell between gauges is not fully seen by the sensors."""
    r = run(farms, district_mm_hr=5, farm_adjust={"F1": 120.0})
    f1 = next(f for f in r["farms"] if f["farm_id"] == "F1")
    assert f1["true_rainfall"] > f1["estimated_rainfall"]


def test_sensor_count_is_adjustable(farms):
    assert len(run(farms, sensor_count=30)["sensors"]) == 30
    assert len(run(farms, sensor_count=18)["sensors"]) == 18


def test_summary_and_occupied_land_are_consistent(farms):
    r = run(farms, district_mm_hr=30)
    assert r["summary"]["total_liability"] == round(sum(f["claim"]["recommended_amount"] for f in r["farms"]), 2)
    assert r["summary"]["occupied_ha"] == round(sum(f["area_ha"] for f in farms), 2)
    assert r["summary"]["occupied_pct"] == round(100 * r["summary"]["occupied_ha"] / land.area_ha(), 1)
    assert r["land"]["width_m"] > 500


def test_presets_are_derived_from_land_and_farms_not_fixed_places(farms):
    p = {x["id"]: x for x in cc.resolve_presets(farms=farms)}
    for k in ("severe_flood", "cloudburst"):
        assert land.contains(p[k]["storm"]["lng"], p[k]["storm"]["lat"])
    # the cloudburst sits on the farms' own centroid, so it moves when the farms move
    moved = [dict(f, ring=square(*land.spread_points(1, 99)[0], 30)) for f in farms[:1]]
    p2 = {x["id"]: x for x in cc.resolve_presets(farms=moved)}
    assert p2["cloudburst"]["storm"]["lat"] != p["cloudburst"]["storm"]["lat"]
    assert all(s in {s2.id for s2 in cc.build_sensors(18, None)} for s in p["faulty_gauge"]["faults"])


def test_only_farms_traced_on_the_land_are_collected(monkeypatch):
    inside = {"id": "in", "name": "In", "latitude": 21.028, "longitude": 79.1496,
              "boundary_geojson": '{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[79.1490,21.0280],[79.1495,21.0280],[79.1495,21.0284],[79.1490,21.0280]]]}}',
              "_policy": None, "_crop": None, "_farmer_name": "A"}
    outside = dict(inside, id="out", boundary_geojson=inside["boundary_geojson"].replace("79.149", "80.149"))
    monkeypatch.setattr(cc, "_load_real_farms", lambda: [inside, outside])
    assert [f["farm_id"] for f in cc._collect_farms()] == ["in"]


def test_farm_series_follows_the_storm_life_cycle(farms):
    s = cc.farm_series(cc.Controls(district_mm_hr=45.0), "F0", steps=12, farms=[dict(f) for f in farms])
    pts = s["points"]
    assert len(pts) == 12 and pts[0]["estimated"] < pts[6]["estimated"] > pts[-1]["estimated"]
    assert pts[6]["payout"] >= pts[0]["payout"]


def test_healthy_gauges_on_a_storm_edge_are_not_flagged(farms):
    """A localised cloudburst makes healthy gauges disagree with neighbours; that is weather, not a fault."""
    p = {x["id"]: x for x in cc.resolve_presets(farms=farms)}["cloudburst"]
    r = run(farms, district_mm_hr=p["district_mm_hr"], storm=p["storm"])
    assert r["summary"]["flagged_sensors"] == 0


def test_faulty_gauge_preset_flags_only_the_injected_faults(farms):
    p = {x["id"]: x for x in cc.resolve_presets(farms=farms)}["faulty_gauge"]
    r = run(farms, district_mm_hr=p["district_mm_hr"], faults=p["faults"])
    flagged = {s["id"] for s in r["sensors"] if s["status"] == "faulty"}
    assert flagged == set(p["faults"])
