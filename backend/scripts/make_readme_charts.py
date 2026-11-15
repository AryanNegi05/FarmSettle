"""Regenerate the README charts (docs/img/*.png) from the real claim engine and command-centre evaluator.

Run from backend/:  python scripts/make_readme_charts.py
Needs matplotlib (dev only; not in requirements.txt). Uses synthetic farms and policies, no Firebase.
Weather and sensors are SIMULATED, exactly as in the app.
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
OUT = ROOT.parent / "docs" / "img"
OUT.mkdir(parents=True, exist_ok=True)

from app.services import claims as engine            # noqa: E402
from app.services import command_centre as cc         # noqa: E402
from app.services import land                         # noqa: E402
from app.services.zones import fitted_circle          # noqa: E402

GREEN, AMBER, RED, BLUE, GREY = "#4f7a62", "#e0a030", "#c0504d", "#3b82c4", "#8a8f98"
plt.rcParams.update({"font.size": 10, "axes.spines.top": False, "axes.spines.right": False, "figure.dpi": 150})


def square(lng, lat, half_m):
    kx, ky = land.metres_per_degree(lat)
    dx, dy = half_m / kx, half_m / ky
    return [[lng - dx, lat - dy], [lng + dx, lat - dy], [lng + dx, lat + dy], [lng - dx, lat + dy], [lng - dx, lat - dy]]


def make_farms(n=8):
    farms = []
    for i, (lng, lat) in enumerate(land.spread_points(n, seed=5, inset=0.15)):
        trig = [15.0, 20.0, 25.0, 30.0][i % 4]
        pol = {"id": f"P{i}", "policy_number": f"POL-{i}", "farm_id": f"F{i}", "status": "active",
               "coverage_start": date.today() - timedelta(days=30), "coverage_end": date.today() + timedelta(days=300),
               "sum_insured": 60000.0 + 5000 * i, "rainfall_trigger_mm": trig, "rainfall_max_payout_mm": trig + 40.0, "payout_limit": None}
        farms.append({"farm_id": f"F{i}", "name": f"Farm {i + 1}", "farmer_id": f"U{i}", "farmer_profile_id": f"U{i}",
                      "farmer_label": f"Farmer {i + 1}", "crop": "cotton", "ring": square(lng, lat, 30 + 4 * i),
                      "area_ha": 0.4 + 0.1 * i, "policy": pol, "image_url": None})
    return farms


def evaluate(farms, preset_id):
    p = next(x for x in cc.resolve_presets([dict(f) for f in farms]) if x["id"] == preset_id)
    c = cc.Controls(district_mm_hr=p["district_mm_hr"], storm=p["storm"], faults=p["faults"])
    return cc.evaluate(c, farms=[dict(f) for f in farms])


# 1. Payout curve -------------------------------------------------------------------------------------------
def payout_curve():
    pol = {"id": "P", "farm_id": "F", "status": "active", "coverage_start": date.today() - timedelta(days=1),
           "coverage_end": date.today() + timedelta(days=30), "sum_insured": 80000.0, "rainfall_trigger_mm": 20.0,
           "rainfall_max_payout_mm": 60.0, "payout_limit": None}
    xs = [x / 2 for x in range(0, 161)]
    ent = [engine.calculate_claim(pol, event_id="c", event_date=date.today(), estimated_rainfall_mm=x).entitlement for x in xs]
    fig, ax = plt.subplots(figsize=(7, 3.6))
    ax.plot(xs, ent, color=GREEN, lw=2.5)
    ax.axvline(20, color=AMBER, ls="--"); ax.axvline(60, color=RED, ls="--")
    ax.text(20.8, 4000, "trigger 20", color=AMBER); ax.text(60.8, 4000, "full payout 60", color=RED)
    est, sig = 40.0, 6.0
    ax.axvspan(est - 1.28 * sig, est + 1.28 * sig, color=BLUE, alpha=0.15, label="likely range at the farm")
    e = engine.calculate_claim(pol, event_id="c", event_date=date.today(), estimated_rainfall_mm=est).entitlement
    ax.plot([est], [e], "o", color=BLUE, ms=8, label=f"estimate {est:.0f} mm/hr → ₹{e:,.0f}")
    ax.set(xlabel="Estimated rainfall at the farm (mm/hr)", ylabel="Entitlement (₹)", title="Graduated payout: the formula sets the amount")
    ax.legend(frameon=False, loc="upper left"); ax.grid(alpha=0.2)
    fig.tight_layout(); fig.savefig(OUT / "payout_curve.png"); plt.close(fig)


# 2. Naive nearest-sensor vs evidence-based liability ----------------------------------------------------------
def liability(farms):
    ids = ["normal", "moderate", "cloudburst", "faulty_gauge", "severe_flood", "broad"]
    names = {"normal": "Normal", "moderate": "Moderate", "cloudburst": "Cloudburst", "faulty_gauge": "Faulty gauge",
             "severe_flood": "Severe flood", "broad": "Broad rain"}
    naive, ours = [], []
    for i in ids:
        s = evaluate(farms, i)["summary"]
        naive.append(s["naive_nearest_sensor_liability"] / 1000); ours.append(s["total_liability"] / 1000)
    fig, ax = plt.subplots(figsize=(7.5, 3.8))
    w = 0.38; x = range(len(ids))
    ax.bar([i - w / 2 for i in x], naive, w, color=GREY, label="Naive: nearest single sensor")
    ax.bar([i + w / 2 for i in x], ours, w, color=GREEN, label="FarmTrust: trust-weighted estimate + claim engine")
    ax.set_xticks(list(x)); ax.set_xticklabels([names[i] for i in ids])
    ax.set(ylabel="Payout liability (₹ thousand)", title="Single-sensor shortcut vs evidence-based payout (8 simulated farms)")
    ax.legend(frameon=False); ax.grid(axis="y", alpha=0.2)
    fig.tight_layout(); fig.savefig(OUT / "liability_by_scenario.png"); plt.close(fig)


# 3. Map of one scenario ---------------------------------------------------------------------------------------
def scenario_map(farms):
    r = evaluate(farms, "faulty_gauge")
    fig, ax = plt.subplots(figsize=(6.4, 5.6))
    ax.add_patch(Polygon(r["land"]["ring"], closed=True, fill=False, ec=GREY, ls="--"))
    colour = {"PAY": GREEN, "ADVANCE": AMBER, "HOLD": "#d9822b", "NONE": "#cfd4da"}
    for f in r["farms"]:
        out = f["claim"]["outcome"] if f["claim"] else "NONE"
        ax.add_patch(Polygon(f["ring"], closed=True, fc=colour[out], ec="black", alpha=0.85))
        ax.annotate(f"{f['name']}\n{f['estimated_rainfall']:.0f} mm/hr\n₹{(f['claim'] or {}).get('recommended_amount', 0):,.0f}",
                    f["centre"], ha="center", va="center", fontsize=6.5)
    sc = {"healthy": GREEN, "suspicious": AMBER, "faulty": RED}
    for s in r["sensors"]:
        if s["type"] == "rainfall":
            ax.plot(s["lng"], s["lat"], "o", color=sc[s["status"]], ms=6, mec="white")
    for k, v in (("healthy sensor", GREEN), ("suspicious", AMBER), ("faulty (excluded)", RED)):
        ax.plot([], [], "o", color=v, label=k)
    for k, v in (("PAY", GREEN), ("ADVANCE", AMBER), ("HOLD", "#d9822b"), ("no payout", "#cfd4da")):
        ax.add_patch(Polygon([[0, 0]], closed=True, fc=v, label=f"farm: {k}"))
    b = r["land"]["bounds"]; ax.set_xlim(b[0], b[2]); ax.set_ylim(b[1], b[3]); ax.set_aspect("equal")
    ax.set_xticks([]); ax.set_yticks([])
    ax.legend(frameon=False, fontsize=7, loc="upper center", bbox_to_anchor=(0.5, -0.01), ncol=4)
    ax.set_title("Command Centre: faulty-gauge scenario, per-farm outcome")
    fig.tight_layout(); fig.savefig(OUT / "scenario_map.png"); plt.close(fig)


# 4. Pipeline diagram ---------------------------------------------------------------------------------------
def pipeline():
    steps = [("Farmer applies\nfor a claim", BLUE), ("Insurer sets\nrainfall scenario", GREY), ("Sensor trust\n(LightGBM)", GREEN),
             ("Farm rainfall\n(Gaussian process)", GREEN), ("Claim engine\nsets the amount", AMBER), ("AI explains\n(no amounts)", "#8e5ea2"),
             ("Insurer approves,\nrejects or holds", RED)]
    fig, ax = plt.subplots(figsize=(11, 2.2)); ax.axis("off")
    for i, (t, c) in enumerate(steps):
        x = i * 1.5
        ax.add_patch(plt.Rectangle((x, 0), 1.25, 1, fc=c, ec="none", alpha=0.9))
        ax.text(x + 0.625, 0.5, t, ha="center", va="center", color="white", fontsize=8, fontweight="bold")
        if i < len(steps) - 1:
            ax.annotate("", xy=(x + 1.5, 0.5), xytext=(x + 1.25, 0.5), arrowprops=dict(arrowstyle="->", color="black"))
    ax.set_xlim(-0.1, 10.5); ax.set_ylim(-0.1, 1.1)
    fig.tight_layout(); fig.savefig(OUT / "claim_pipeline.png"); plt.close(fig)


if __name__ == "__main__":
    farms = make_farms()
    payout_curve(); liability(farms); scenario_map(farms); pipeline()
    print("wrote", *sorted(p.name for p in OUT.glob("*.png")))
