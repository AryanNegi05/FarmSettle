import type { CCFarm, CCLand, CCResult, CCSensor } from "../../../api/command";

export const RISK_COLOUR: Record<string, string> = {
  low: "#22c55e", moderate: "#eab308", high: "#f97316", extreme: "#ef4444", insufficient_evidence: "#94a3b8",
};
export const RISK_LABEL: Record<string, string> = {
  low: "Low", moderate: "Moderate", high: "High", extreme: "Severe", insufficient_evidence: "No evidence",
};
export const SENSOR_COLOUR: Record<string, string> = { healthy: "#22d3ee", suspicious: "#f59e0b", faulty: "#ef4444" };

type FC = GeoJSON.FeatureCollection;
const fc = (features: GeoJSON.Feature[]): FC => ({ type: "FeatureCollection", features });

/** Extrusion height (m) for a rainfall value; shared by the farm block and its uncertainty band. */
const rainHeight = (v: number) => 3 + Math.min(Math.max(v, 0), 120) * 0.3;

/** Farm polygons. Height and opacity come from THAT farm's own rainfall, so each plot looks different.
 *  lowH/upH bound the 80 % uncertainty range, drawn as a translucent band above the block in 3D. */
export function farmFeatures(farms: CCFarm[], prevPayout: Map<string, number>): FC {
  return fc(farms.map((f) => {
    const est = f.estimated_rainfall ?? 0;
    return {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [f.ring] },
      properties: {
        farm_id: f.farm_id, name: f.name, crop: f.crop ?? "", risk: f.risk, colour: RISK_COLOUR[f.risk],
        height: rainHeight(est), est,
        lowH: f.lower === null ? 0 : rainHeight(f.lower), upH: f.upper === null ? 0 : rainHeight(f.upper),
        payout: f.claim?.recommended_amount ?? 0,
        prev: prevPayout.get(f.farm_id) ?? 0, outcome: f.claim?.outcome ?? "NONE",
      },
    };
  }));
}

export function circleFeatures(farms: CCFarm[]): FC {
  return fc(farms.map((f) => ({
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [f.circle] },
    // rel = how uncertain the estimate is relative to its size; drives the halo's thickness and colour.
    properties: {
      farm_id: f.farm_id, radius_m: f.circle_radius_m,
      rel: Math.min(1.5, (f.uncertainty ?? 0) / Math.max(f.estimated_rainfall ?? 0, 5)),
      unc_px: 2 + 12 * Math.min(1, (f.uncertainty ?? 0) / Math.max(f.estimated_rainfall ?? 0, 5)),
    },
  })));
}

/** Rain ripples at each farm's centre: size and strength scale with that farm's rainfall. */
export function rippleFeatures(farms: CCFarm[]): FC {
  return fc(farms.map((f) => {
    const est = f.estimated_rainfall ?? 0;
    const lat = f.centre[1];
    const metres = f.circle_radius_m * Math.min(1.3, Math.max(0.3, est / 40));
    const r0 = metres / (156543.03 * Math.cos((lat * Math.PI) / 180));   // pixels at zoom 0
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: f.centre },
      properties: { farm_id: f.farm_id, r0, r22: r0 * 4194304, op: est < 1 ? 0 : Math.min(0.9, 0.25 + est / 60) },
    };
  }));
}

export function sensorPoints(sensors: CCSensor[]): FC {
  return fc(sensors.map((s) => ({
    type: "Feature",
    geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    properties: { id: s.id, type: s.type, status: s.status, colour: SENSOR_COLOUR[s.status], value: s.value, unit: s.unit, cls: s.classification, trust: s.trust },
  })));
}

/** Small square footprint per rainfall gauge, extruded into a "tower" in 3D. Sized for a ~850 m land patch. */
export function sensorTowers(sensors: CCSensor[]): FC {
  const half = 0.00005; // ~5 m
  return fc(sensors.filter((s) => s.type === "rainfall").map((s) => ({
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [[[s.lng - half, s.lat - half], [s.lng + half, s.lat - half], [s.lng + half, s.lat + half],
                     [s.lng - half, s.lat + half], [s.lng - half, s.lat - half]]],
    },
    properties: { id: s.id, colour: SENSOR_COLOUR[s.status], height: 20 + Math.min(s.value, 150) * 0.5 },
  })));
}

/** Lines from the selected farm to the sensors that contribute (solid) or were excluded (dashed). */
export function evidenceLinks(farm: CCFarm | null, sensors: CCSensor[]): FC {
  if (!farm) return fc([]);
  const by = new Map(sensors.map((s) => [s.id, s]));
  const line = (sid: string, kind: "used" | "excluded"): GeoJSON.Feature | null => {
    const s = by.get(sid);
    if (!s) return null;
    return { type: "Feature", geometry: { type: "LineString", coordinates: [farm.centre, [s.lng, s.lat]] }, properties: { kind, sensor_id: sid } };
  };
  return fc([
    ...farm.contributors.map((c) => line(c.sensor_id, "used")),
    ...farm.excluded.map((e) => line(e.sensor_id, "excluded")),
  ].filter((x): x is GeoJSON.Feature => x !== null));
}

/** Dashed circle at 2 sigma showing where the simulated storm cell is centred. */
export function stormFeature(storm: CCResult["controls"]["storm"]): FC {
  if (!storm) return fc([]);
  const pts: number[][] = [];
  const mLat = 1 / 110574;
  const mLng = 1 / (111320 * Math.cos((storm.lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (2 * Math.PI * i) / 64;
    pts.push([storm.lng + storm.radius_m * 2 * Math.cos(a) * mLng, storm.lat + storm.radius_m * 2 * Math.sin(a) * mLat]);
  }
  return fc([{ type: "Feature", geometry: { type: "Polygon", coordinates: [pts] }, properties: {} }]);
}

export function landFeature(land: CCLand | undefined): FC {
  if (!land) return fc([]);
  return fc([{ type: "Feature", geometry: { type: "Polygon", coordinates: [land.ring] }, properties: {} }]);
}

export function farmBounds(f: CCFarm): [[number, number], [number, number]] {
  const xs = f.ring.map((p) => p[0]);
  const ys = f.ring.map((p) => p[1]);
  return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
