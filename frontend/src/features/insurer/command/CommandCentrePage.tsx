/**
 * Insurer Command Centre ().
 *
 * The map is the SAME land image farmers trace their farms on (public/example-farmland.jpg), so the
 * insurer sees exactly the plots farmers marked, which land is occupied, and the rain's effect on
 * each one. There is no separate district map and no scattered demo farms: only farms that farmers
 * actually registered on this land appear.
 *
 * 2D and 3D show the same farms; 3D only tilts the camera and raises each plot by its own rainfall.
 * Every control change calls POST /api/command/evaluate (sensors → ML trust → Gaussian Process →
 * claim engine). Weather and sensors are simulated.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import maplibregl, { GeoJSONSource, Map } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useAuth } from "../../../hooks/useAuth";
import {
  CCFarm, CCPreset, CCResult, CCSensor, CCSeries, CCSummary, FaultType, evaluateCommand, getFarmSeries, getPresets, getSensorForensics, SensorForensics,
} from "../../../api/command";
import { EXAMPLE_FARMLAND_COORDS, EXAMPLE_FARMLAND_URL } from "../../map/exampleFarmland";
import ControlsPanel, { Controls } from "./ControlsPanel";
import AgentPanel from "./AgentPanel";
import SensorPanel from "./SensorPanel";
import { AgentRun, runAgents } from "../../../api/agents";
import FarmPanel from "./FarmPanel";
import {
  RISK_COLOUR, RISK_LABEL, circleFeatures, evidenceLinks, farmBounds, farmFeatures, inr, landFeature,
  rippleFeatures, sensorPoints, sensorTowers, stormFeature,
} from "./layers";

// The land patch, from the image's own geo-reference (same constants the registration map uses).
const LNGS = EXAMPLE_FARMLAND_COORDS.map((c) => c[0]);
const LATS = EXAMPLE_FARMLAND_COORDS.map((c) => c[1]);
const LAND_BOUNDS: [[number, number], [number, number]] = [[Math.min(...LNGS), Math.min(...LATS)], [Math.max(...LNGS), Math.max(...LATS)]];
const PAD_LNG = (LAND_BOUNDS[1][0] - LAND_BOUNDS[0][0]) * 0.6;
const PAD_LAT = (LAND_BOUNDS[1][1] - LAND_BOUNDS[0][1]) * 0.6;
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [LAND_BOUNDS[0][0] - PAD_LNG, LAND_BOUNDS[0][1] - PAD_LAT], [LAND_BOUNDS[1][0] + PAD_LNG, LAND_BOUNDS[1][1] + PAD_LAT],
];

// No external basemap: just a dark background behind the land image.
const BLANK_STYLE: maplibregl.StyleSpecification = {
  version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#06101d" } }],
};

const DEFAULT_CONTROLS: Controls = { district: 2, storm: null, faults: {}, overrides: {}, farmAdjust: {}, sensorCount: 18 };
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const SOURCES = ["land", "farms", "circles", "ripples", "sensors", "towers", "links", "storm"] as const;
const FARM_LAYERS = ["farms-fill", "farms-line", "farms-3d", "farms-band", "circles-fill", "circles-glow", "circles-line", "unc-ring", "ripple-a", "ripple-b"];
type NumMap = globalThis.Map<string, number>;

/** Short stable id for the scenario on screen, so a claim is tied to exactly this event. */
function scenarioId(req: unknown): string {
  const s = JSON.stringify(req);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `sim-${(h >>> 0).toString(36)}`;
}

export default function CommandCentrePage() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const wantedFarm = searchParams.get("farm");
  const wantedApplied = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const [controls, setControlsState] = useState<Controls>(DEFAULT_CONTROLS);
  const [activePreset, setActivePreset] = useState<string | null>("normal");
  const [presets, setPresets] = useState<CCPreset[]>([]);
  const [result, setResult] = useState<CCResult | null>(null);
  const [prevSummary, setPrevSummary] = useState<CCSummary | null>(null);
  const [prevPayout, setPrevPayout] = useState<NumMap>(new window.Map());
  const [evaluating, setEvaluating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<CCSeries | null>(null);
  const [sensorOpen, setSensorOpen] = useState(false);
  const [forensics, setForensics] = useState<SensorForensics | null>(null);
  const [forensicsBusy, setForensicsBusy] = useState(false);
  const [forensicsError, setForensicsError] = useState<string | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [selectedFarmId, setSelectedFarmId] = useState<string | null>(null);
  const [selectedSensorId, setSelectedSensorId] = useState<string | null>(null);
  const [is3D, setIs3D] = useState(true);
  const [placingStorm, setPlacingStorm] = useState(false);
  const [layers, setLayers] = useState({ circles: true, sensors: true, links: true, ripples: true, uncertainty: true });
  const [layersOpen, setLayersOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [fCrop, setFCrop] = useState("");
  const [fRisk, setFRisk] = useState("");
  const [fOutcome, setFOutcome] = useState("");
  const [fMinRain, setFMinRain] = useState("");

  const [tl, setTl] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);

  const placingRef = useRef(false);
  placingRef.current = placingStorm;
  const resultRef = useRef<CCResult | null>(null);
  resultRef.current = result;

  const setControls = useCallback((u: (c: Controls) => Controls) => {
    setControlsState(u);
    setActivePreset(null);
  }, []);

  // ── Presets (resolved by the backend from the land and the registered farms) ──
  useEffect(() => { getPresets().then(setPresets).catch(() => setError("Could not load scenario presets")); }, []);

  function applyPreset(p: CCPreset) {
    setControlsState((c) => ({ ...c, district: p.district_mm_hr, storm: p.storm, faults: p.faults as Record<string, FaultType>, overrides: {}, farmAdjust: {} }));
    setActivePreset(p.id);
    setTl(null); setPlaying(false);
  }

  // ── Timeline (storm life-cycle) ──────────────────────────────────────────
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => setTl((t) => { const n = (t ?? 0) + 1 / 24; return n > 1 ? 0 : n; }), 800);
    return () => window.clearInterval(id);
  }, [playing]);

  function resetAll() {
    setPlaying(false); setTl(null); setSelectedFarmId(null); setSelectedSensorId(null);
    setControlsState(DEFAULT_CONTROLS); setActivePreset("normal");
  }

  // ── Live evaluation (debounced, stale responses ignored) ─────────────────
  const reqId = useRef(0);
  const baseRequest = useMemo(() => ({
    district_mm_hr: controls.district, storm: controls.storm, faults: controls.faults,
    sensor_overrides: controls.overrides, farm_adjust: controls.farmAdjust, sensor_count: controls.sensorCount,
  }), [controls]);
  const request = useMemo(() => {
    const m = tl === null ? 1 : Math.max(0, Math.sin(Math.PI * tl));
    return {
      ...baseRequest,
      district_mm_hr: Math.round(controls.district * m * 10) / 10,
      storm: controls.storm ? { ...controls.storm, peak_mm_hr: Math.round(controls.storm.peak_mm_hr * m * 10) / 10 } : null,
    };
  }, [baseRequest, controls.district, controls.storm, tl]);

  // The four agents investigate whatever storm the sliders/presets are currently showing.
  function investigate() {
    setAgentOpen(true); setAgentBusy(true); setAgentError(null);
    runAgents(request)
      .then(setAgentRun)
      .catch((e) => setAgentError(e instanceof Error ? e.message : "Investigation failed"))
      .finally(() => setAgentBusy(false));
  }

  // Sensor Forensics: investigate the clicked sensor under the current sliders (debounced).
  const forensicsReq = useRef(0);
  useEffect(() => {
    if (!sensorOpen || !selectedSensorId) return;
    const my = ++forensicsReq.current;
    setForensicsBusy(true);
    const t = window.setTimeout(() => {
      getSensorForensics({ ...request, sensor_id: selectedSensorId })
        .then((d) => { if (my === forensicsReq.current) { setForensics(d); setForensicsError(null); } })
        .catch((e) => { if (my === forensicsReq.current) setForensicsError(e instanceof Error ? e.message : "Investigation failed"); })
        .finally(() => { if (my === forensicsReq.current) setForensicsBusy(false); });
    }, 350);
    return () => window.clearTimeout(t);
  }, [sensorOpen, selectedSensorId, request]);

  useEffect(() => {
    const my = ++reqId.current;
    setEvaluating(true);
    const t = window.setTimeout(() => {
      evaluateCommand(request)
        .then((r) => {
          if (my !== reqId.current) return;
          const before = resultRef.current;
          setPrevPayout(new window.Map(before ? before.farms.map((f) => [f.farm_id, f.claim?.recommended_amount ?? 0] as [string, number]) : []));
          setPrevSummary(before?.summary ?? null);
          setResult(r); setError(null);
        })
        .catch((e) => { if (my === reqId.current) setError(e instanceof Error ? e.message : "Evaluation failed"); })
        .finally(() => { if (my === reqId.current) setEvaluating(false); });
    }, 250);
    return () => window.clearTimeout(t);
  }, [request]);

  // The selected farm's rain over the whole storm life-cycle (uses the unscaled controls).
  useEffect(() => {
    if (!selectedFarmId) { setSeries(null); return; }
    let live = true;
    const t = window.setTimeout(() => {
      getFarmSeries({ ...baseRequest, farm_id: selectedFarmId, steps: 24 }).then((s) => { if (live) setSeries(s); }).catch(() => { if (live) setSeries(null); });
    }, 500);
    return () => { live = false; window.clearTimeout(t); };
  }, [selectedFarmId, baseRequest]);

  // ── Map init: the shared land image on a dark background ─────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current, style: BLANK_STYLE, bounds: LAND_BOUNDS, fitBoundsOptions: { padding: 30 },
      maxBounds: MAX_BOUNDS, minZoom: 14, maxZoom: 20, pitch: 55, bearing: -12, maxPitch: 75, attributionControl: false,
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "bottom-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: "Example farmland imagery © Esri, Maxar, Earthstar Geographics" }));

    const init = () => {
      // The SAME image farmers trace on.
      map.addSource("example-farmland", { type: "image", url: EXAMPLE_FARMLAND_URL, coordinates: EXAMPLE_FARMLAND_COORDS });
      map.addLayer({ id: "example-farmland", type: "raster", source: "example-farmland", paint: { "raster-fade-duration": 0 } });
      for (const s of SOURCES) map.addSource(s, { type: "geojson", data: EMPTY });

      map.addLayer({ id: "land-outline", type: "line", source: "land", paint: { "line-color": "#67e8f9", "line-width": 1.5, "line-dasharray": [4, 3], "line-opacity": 0.6 } });
      map.addLayer({ id: "storm-fill", type: "fill", source: "storm", paint: { "fill-color": "#38bdf8", "fill-opacity": 0.07 } });
      map.addLayer({ id: "storm-line", type: "line", source: "storm", paint: { "line-color": "#38bdf8", "line-width": 1.5, "line-dasharray": [3, 3] } });

      map.addLayer({ id: "circles-fill", type: "fill", source: "circles", paint: { "fill-color": "#22d3ee", "fill-opacity": 0.07 } });
      map.addLayer({ id: "circles-glow", type: "line", source: "circles", paint: { "line-color": "#22d3ee", "line-width": 5, "line-blur": 4, "line-opacity": 0.25 } });
      map.addLayer({ id: "circles-line", type: "line", source: "circles", paint: { "line-color": "#67e8f9", "line-width": 1.2, "line-opacity": 0.8 } });
      // Uncertainty halo: thicker and warmer (green → amber → red) the less certain that farm's estimate is.
      map.addLayer({ id: "unc-ring", type: "line", source: "circles", paint: {
        "line-width": ["get", "unc_px"], "line-blur": 1.5, "line-opacity": 0.55,
        "line-color": ["interpolate", ["linear"], ["get", "rel"], 0, "#34d399", 0.5, "#fbbf24", 1, "#f87171"] } });

      // Each farm is styled by its OWN rainfall: colour by risk, opacity and height by estimate.
      map.addLayer({ id: "farms-fill", type: "fill", source: "farms", paint: {
        "fill-color": ["get", "colour"], "fill-opacity": ["interpolate", ["linear"], ["get", "est"], 0, 0.28, 60, 0.62] } });
      map.addLayer({ id: "farms-line", type: "line", source: "farms", paint: { "line-color": ["get", "colour"], "line-width": 2.5 } });
      map.addLayer({
        id: "farms-3d", type: "fill-extrusion", source: "farms", layout: { visibility: "none" },
        paint: { "fill-extrusion-color": ["get", "colour"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.85 },
      });

      // Uncertainty band (3D): translucent column spanning the low-to-high estimate above each block.
      map.addLayer({
        id: "farms-band", type: "fill-extrusion", source: "farms", layout: { visibility: "none" },
        paint: { "fill-extrusion-color": "#e0f2fe", "fill-extrusion-base": ["get", "lowH"], "fill-extrusion-height": ["get", "upH"], "fill-extrusion-opacity": 0.35 },
      });

      const ripple = (id: string) => map.addLayer({
        id, type: "circle", source: "ripples",
        paint: {
          "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#7dd3fc", "circle-stroke-width": 2,
          "circle-radius": ["interpolate", ["exponential", 2], ["zoom"], 0, ["*", ["get", "r0"], 0.5], 22, ["*", ["get", "r22"], 0.5]],
          "circle-stroke-opacity": ["*", ["get", "op"], 0.5], "circle-pitch-alignment": "map",
        },
      });
      ripple("ripple-a"); ripple("ripple-b");

      // Selection: glowing outline, plus a taller "risen" block in 3D.
      const none = ["==", ["get", "farm_id"], ""] as maplibregl.FilterSpecification;
      map.addLayer({ id: "selected-3d", type: "fill-extrusion", source: "farms", filter: none, layout: { visibility: "none" },
        paint: { "fill-extrusion-color": "#22d3ee", "fill-extrusion-height": 26, "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.6 } });
      map.addLayer({ id: "selected-glow", type: "line", source: "farms", filter: none, paint: { "line-color": "#22d3ee", "line-width": 12, "line-blur": 7, "line-opacity": 0.8 } });
      map.addLayer({ id: "selected-line", type: "line", source: "farms", filter: none, paint: { "line-color": "#ffffff", "line-width": 3 } });

      map.addLayer({
        id: "links", type: "line", source: "links",
        paint: { "line-color": ["match", ["get", "kind"], "used", "#22d3ee", "#ef4444"], "line-width": ["match", ["get", "kind"], "used", 2.5, 1.5], "line-dasharray": [2, 2], "line-opacity": 0.9 },
      });
      map.addLayer({
        id: "towers", type: "fill-extrusion", source: "towers", layout: { visibility: "none" },
        paint: { "fill-extrusion-color": ["get", "colour"], "fill-extrusion-height": ["get", "height"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.9 },
      });
      map.addLayer({
        id: "sensor-ring", type: "circle", source: "sensors",
        filter: ["any", ["==", ["get", "type"], "water_level"], ["!=", ["get", "status"], "healthy"]],
        paint: { "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": ["get", "colour"], "circle-stroke-width": 2, "circle-radius": 10, "circle-stroke-opacity": 0.6 },
      });
      map.addLayer({
        id: "sensors-circle", type: "circle", source: "sensors",
        paint: {
          "circle-color": ["get", "colour"], "circle-radius": ["match", ["get", "type"], "water_level", 7, 6],
          "circle-stroke-color": ["match", ["get", "type"], "water_level", "#38bdf8", "#ffffff"], "circle-stroke-width": 2,
        },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      const onFarm = (e: maplibregl.MapLayerMouseEvent) => {
        if (placingRef.current) return;
        const id = e.features?.[0]?.properties?.farm_id as string | undefined;
        if (id) { setSelectedFarmId(id); setSelectedSensorId(null); }
      };
      for (const l of ["farms-fill", "farms-3d"]) {
        map.on("click", l, onFarm);
        map.on("mousemove", l, (e) => {
          map.getCanvas().style.cursor = "pointer";
          const p = e.features?.[0]?.properties;
          if (!p) return;
          const f = resultRef.current?.farms.find((x) => x.farm_id === p.farm_id);
          popup.setLngLat(e.lngLat).setHTML(
            `<div style="font-size:12px"><b>${p.name}</b><br/>${f?.estimated_rainfall ?? "n/a"} mm/hr · ${f ? inr(f.claim?.recommended_amount ?? 0) : ""}</div>`).addTo(map);
        });
        map.on("mouseleave", l, () => { map.getCanvas().style.cursor = ""; popup.remove(); });
      }
      map.on("click", "sensors-circle", (e) => {
        if (placingRef.current) return;
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) { setSelectedSensorId(id); setSensorOpen(true); }
      });
      map.on("mousemove", "sensors-circle", (e) => {
        map.getCanvas().style.cursor = "pointer";
        const p = e.features?.[0]?.properties;
        if (!p) return;
        popup.setLngLat(e.lngLat).setHTML(`<div style="font-size:12px"><b>${p.id}</b> · ${p.status}<br/>${p.value} ${p.unit} · ${p.cls}</div>`).addTo(map);
      });
      map.on("mouseleave", "sensors-circle", () => { map.getCanvas().style.cursor = ""; popup.remove(); });

      // Place the storm centre.
      map.on("click", (e) => {
        if (!placingRef.current) return;
        setControls((c) => c.storm ? { ...c, storm: { ...c.storm, lat: +e.lngLat.lat.toFixed(6), lng: +e.lngLat.lng.toFixed(6) } } : c);
        setPlacingStorm(false);
      });
      setMapReady(true);
    };
    if (map.isStyleLoaded()) init(); else map.once("style.load", init);

    return () => { setMapReady(false); map.remove(); mapRef.current = null; };
  }, [setControls]);

  // ── Derived selections ───────────────────────────────────────────────────
  const farms = result?.farms ?? [];
  const sensors = result?.sensors ?? [];
  const selectedFarm: CCFarm | null = farms.find((f) => f.farm_id === selectedFarmId) ?? null;
  const selectedSensor: CCSensor | null = sensors.find((s) => s.id === selectedSensorId) ?? null;

  const visibleIds = useMemo(() => {
    const min = parseFloat(fMinRain);
    const ids = farms.filter((f) =>
      (!fCrop || f.crop === fCrop) && (!fRisk || f.risk === fRisk) &&
      (!fOutcome || f.claim?.outcome === fOutcome) && (isNaN(min) || (f.estimated_rainfall ?? 0) >= min)).map((f) => f.farm_id);
    return ids.length === farms.length ? null : ids;
  }, [farms, fCrop, fRisk, fOutcome, fMinRain]);

  const crops = useMemo(() => Array.from(new Set(farms.map((f) => f.crop).filter(Boolean))) as string[], [farms]);

  // Open directly on a farm when linked with ?farm=<id> (from Policies or the farmer page).
  useEffect(() => {
    if (!wantedFarm || wantedApplied.current || !result) return;
    if (farms.some((f) => f.farm_id === wantedFarm)) { wantedApplied.current = true; setSelectedFarmId(wantedFarm); }
  }, [wantedFarm, result, farms]);

  // ── Push data into the map ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !result) return;
    const set = (id: string, data: GeoJSON.FeatureCollection) => (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
    set("land", landFeature(result.land));
    set("farms", farmFeatures(result.farms, prevPayout));
    set("circles", circleFeatures(result.farms));
    set("ripples", rippleFeatures(result.farms));
    set("sensors", sensorPoints(result.sensors));
    set("towers", sensorTowers(result.sensors));
    set("storm", stormFeature(result.controls.storm));
  }, [result, prevPayout, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    (map.getSource("links") as GeoJSONSource | undefined)?.setData(layers.links ? evidenceLinks(selectedFarm, sensors) : EMPTY);
  }, [selectedFarm, sensors, layers.links, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const f = ["==", ["get", "farm_id"], selectedFarmId ?? ""] as maplibregl.FilterSpecification;
    for (const l of ["selected-3d", "selected-glow", "selected-line"]) map.setFilter(l, f);
  }, [selectedFarmId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const f = visibleIds ? (["in", ["get", "farm_id"], ["literal", visibleIds]] as maplibregl.FilterSpecification) : null;
    for (const l of FARM_LAYERS) map.setFilter(l, f);
  }, [visibleIds, mapReady]);

  // Layer toggles + 2D/3D (same farms in both; 3D only tilts the camera and raises plots).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const vis = (ids: string[], on: boolean) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, "visibility", on ? "visible" : "none"));
    vis(["circles-fill", "circles-glow", "circles-line"], layers.circles);
    vis(["unc-ring"], layers.uncertainty);
    vis(["farms-band"], layers.uncertainty && is3D);
    vis(["ripple-a", "ripple-b"], layers.ripples);
    vis(["sensors-circle", "sensor-ring"], layers.sensors);
    vis(["towers"], layers.sensors && is3D);
    vis(["farms-fill"], !is3D);
    vis(["farms-3d", "selected-3d"], is3D);
    map.easeTo({ pitch: is3D ? 55 : 0, bearing: is3D ? -12 : 0, duration: 800 });
  }, [is3D, layers, mapReady]);

  // Frame the selected farm, offset so it sits clear of the floating info panel.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedFarm) return;
    const wide = window.innerWidth >= 1024;
    map.fitBounds(farmBounds(selectedFarm), {
      padding: { left: wide ? 400 : 60, top: 130, right: 60, bottom: 90 }, maxZoom: 19.4,
      pitch: is3D ? 55 : 0, bearing: is3D ? -12 : 0, duration: 1200, essential: true,
    });
  }, [selectedFarmId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Rain ripples (per-farm size/strength) and pulsing rings on water gauges and unhealthy sensors.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let raf = 0; let last = 0;
    const tick = (t: number) => {
      if (t - last > 70 && map.getLayer("sensor-ring")) {
        last = t;
        const ph = (t % 1600) / 1600;
        map.setPaintProperty("sensor-ring", "circle-radius", 8 + 12 * ph);
        map.setPaintProperty("sensor-ring", "circle-stroke-opacity", 0.7 * (1 - ph));
        const rp = (id: string, phase: number) => {
          if (!map.getLayer(id)) return;
          map.setPaintProperty(id, "circle-radius", ["interpolate", ["exponential", 2], ["zoom"], 0, ["*", ["get", "r0"], phase], 22, ["*", ["get", "r22"], phase]]);
          map.setPaintProperty(id, "circle-stroke-opacity", ["*", ["get", "op"], 1 - phase]);
        };
        rp("ripple-a", ph);
        rp("ripple-b", (ph + 0.5) % 1);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mapReady]);

  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return [];
    return farms.filter((f) => [f.farm_id, f.name, f.farmer_label, String(f.farmer_id ?? "")].some((v) => v.toLowerCase().includes(q))).slice(0, 6);
  }, [search, farms]);

  const eventId = useMemo(() => scenarioId(request), [request]);
  const sum = result?.summary;
  const dLiab = sum && prevSummary ? sum.total_liability - prevSummary.total_liability : 0;

  const setAdjust = useCallback((farmId: string, v: number) => {
    setControls((c) => {
      const fa = { ...c.farmAdjust };
      if (v === 0) delete fa[farmId]; else fa[farmId] = v;
      return { ...c, farmAdjust: fa };
    });
  }, [setControls]);

  return (
    <div className="flex flex-col h-[calc(100vh-80px)] bg-surface/90">
      <div className="flex items-center justify-between px-4 py-2 border-b border-line bg-surface/80 backdrop-blur">
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/insurer" className="text-sm text-accent hover:underline">← Dashboard</Link>
          <h1 className="text-ink font-semibold text-sm">Command Centre</h1>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 border border-amber-200">Simulated weather & sensors</span>
          {evaluating && <span className="text-[11px] text-accent animate-pulse">recalculating…</span>}
        </div>
        <div className="flex items-center gap-3">
          {user?.role !== "auditor" && (
            <button onClick={investigate} disabled={agentBusy || !result}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50">
              {agentBusy ? "Investigating…" : "🤖 Run agent investigation"}
            </button>
          )}
        {result && <span className="text-[11px] text-ink-faint hidden md:block">{result.farms.length} farms · {result.sensors.length} sensors · {result.elapsed_ms} ms</span>}
        </div>
      </div>

      <div className="flex flex-1 min-h-0 flex-col lg:flex-row">
        <div className="relative flex-1 min-h-[320px]">
          <div ref={containerRef} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />

          {/* Search + filters */}
          <div className="absolute top-3 left-3 right-[190px] z-10 max-w-[680px] space-y-1.5">
            <div className="rounded-xl border border-line bg-surface/80 backdrop-blur-md p-2 flex flex-wrap gap-1.5 items-center">
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search farmer ID, name or farm ID…"
                className="flex-1 min-w-[160px] bg-sunken border border-line rounded-xl px-2.5 py-1.5 text-xs text-ink placeholder-gray-500" />
              {crops.length > 0 && (
                <select value={fCrop} onChange={(e) => setFCrop(e.target.value)} className="bg-sunken border border-line rounded-xl px-2 py-1.5 text-xs text-ink">
                  <option value="">All crops</option>{crops.map((c) => <option key={c}>{c}</option>)}
                </select>
              )}
              <select value={fRisk} onChange={(e) => setFRisk(e.target.value)} className="bg-sunken border border-line rounded-xl px-2 py-1.5 text-xs text-ink">
                <option value="">All risk</option>{Object.keys(RISK_LABEL).map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}
              </select>
              <select value={fOutcome} onChange={(e) => setFOutcome(e.target.value)} className="bg-sunken border border-line rounded-xl px-2 py-1.5 text-xs text-ink">
                <option value="">Any claim</option><option value="PAY">Pay</option><option value="ADVANCE">Advance</option><option value="HOLD">Hold</option><option value="NONE">No payout</option>
              </select>
              <input value={fMinRain} onChange={(e) => setFMinRain(e.target.value)} placeholder="Min mm/hr" type="number"
                className="w-24 bg-sunken border border-line rounded-xl px-2 py-1.5 text-xs text-ink placeholder-gray-500" />
            </div>
            {matches.length > 0 && (
              <ul className="rounded-xl border border-line bg-surface/90 backdrop-blur-md overflow-hidden">
                {matches.map((f) => (
                  <li key={f.farm_id}>
                    <button onClick={() => { setSelectedFarmId(f.farm_id); setSearch(""); }} className="w-full text-left px-3 py-1.5 text-xs text-ink-soft hover:bg-sunken">
                      {f.name} <span className="text-ink-faint">· {f.farmer_label} · {f.farm_id.slice(0, 8)}…</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* View controls */}
          <div className="absolute top-3 right-3 z-30 flex flex-col items-end gap-1.5">
            <div className="flex gap-1.5">
              <button onClick={() => setIs3D(false)} className={`text-xs px-3 py-1.5 rounded-full border backdrop-blur-md ${!is3D ? "bg-accent text-white border-accent font-semibold" : "bg-surface/80 text-ink-soft border-line"}`}>2D</button>
              <button onClick={() => setIs3D(true)} className={`text-xs px-3 py-1.5 rounded-full border backdrop-blur-md ${is3D ? "bg-accent text-white border-accent font-semibold" : "bg-surface/80 text-ink-soft border-line"}`}>3D</button>
              <button onClick={() => setLayersOpen((o) => !o)} className="text-xs px-3 py-1.5 rounded-xl border bg-surface/80 text-ink-soft border-line backdrop-blur-md">Layers</button>
            </div>
            {layersOpen && (
              <div className="rounded-xl border border-line bg-surface/90 backdrop-blur-md p-3 space-y-1.5 text-xs text-ink-soft">
                {([["circles", "Rainfall coverage circles"], ["ripples", "Rain ripples on each plot"], ["uncertainty", "Uncertainty (halo + 3D band)"], ["sensors", "Sensors"], ["links", "Evidence links (selected farm)"]] as const).map(([k, label]) => (
                  <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={layers[k]} onChange={() => setLayers((l) => ({ ...l, [k]: !l[k] }))} />{label}</label>
                ))}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="absolute bottom-9 left-3 z-10 rounded-xl border border-line bg-surface/80 backdrop-blur-md px-3 py-2 text-[11px] text-ink-soft space-y-1">
            <div className="flex gap-2 flex-wrap">
              {(["low", "moderate", "high", "extreme"] as const).map((r) => (
                <span key={r} className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: RISK_COLOUR[r] }} />{RISK_LABEL[r]}</span>
              ))}
            </div>
            <div className="flex gap-2 flex-wrap text-ink-muted">
              <span><i className="inline-block w-2 h-2 rounded-full bg-accent mr-1" />healthy sensor</span>
              <span><i className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />suspicious</span>
              <span><i className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1" />faulty</span>
              <span className="text-accent">◯ coverage zone</span>
            </div>
            <div className="flex items-center gap-2 text-ink-muted">
              <span>Uncertainty halo:</span>
              <i className="inline-block h-1.5 w-16 rounded-full" style={{ background: "linear-gradient(90deg,#34d399,#fbbf24,#f87171)" }} />
              <span>thin/green = sure → thick/red = unsure</span>
            </div>
            <p className="text-ink-faint">Unmarked ground is land no farmer has registered yet.</p>
          </div>

          {sensorOpen && selectedSensorId && (
            <SensorPanel data={forensics && forensics.sensor.id === selectedSensorId ? forensics : null} loading={forensicsBusy} error={forensicsError}
              onClose={() => setSensorOpen(false)} onSelectSensor={(id) => { setSelectedSensorId(id); }}
              onSelectFarm={(id) => setSelectedFarmId(id)} />
          )}
          {agentOpen && <AgentPanel run={agentRun} running={agentBusy} error={agentError} onClose={() => setAgentOpen(false)} />}
          {placingStorm && <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-lg bg-amber-500/90 text-ink text-xs font-semibold">Click the map to place the storm centre</div>}
          {error && <div className="absolute bottom-24 right-3 z-10 max-w-xs rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">{error}</div>}
          {result && farms.length === 0 && (
            <div className="absolute top-24 left-1/2 -translate-x-1/2 z-10 max-w-sm rounded-xl border border-line bg-surface/85 backdrop-blur-md px-4 py-3 text-xs text-ink-soft text-center">
              No farms are registered on this land yet. Farmers mark theirs at <b>My Farms → Add Farm</b>; they will appear here with their rain impact.
            </div>
          )}

          {selectedFarm && (
            <FarmPanel farm={selectedFarm} prevPayout={prevPayout.get(selectedFarm.farm_id)} role={user?.role} series={series}
              tl={tl} eventId={eventId} onAdjust={setAdjust} onClose={() => setSelectedFarmId(null)} />
          )}
        </div>

        {/* Right rail: portfolio KPIs + simulation controls */}
        <aside className="lg:w-[340px] lg:border-l border-line bg-surface/90 overflow-y-auto p-4 space-y-4">
          {sum ? (
            <section className="grid grid-cols-2 gap-2">
              <Kpi label="Occupied land" value={`${sum.occupied_ha} ha`} sub={`${sum.occupied_pct}% of ${sum.land_area_ha} ha · ${sum.farms} farm(s)`} wide />
              <Kpi label="Affected farms" value={`${sum.affected_farms}`} sub={`of ${sum.farms}`} />
              <Kpi label="Eligible claims" value={`${sum.eligible_claims}`} sub={sum.farms_without_policy ? `${sum.farms_without_policy} without policy` : undefined} />
              <Kpi label="Payout liability" value={inr(sum.total_liability)} wide
                sub={prevSummary && Math.abs(dLiab) >= 1 ? `${dLiab > 0 ? "▲" : "▼"} ${inr(Math.abs(dLiab))} vs previous` : undefined} subTone={dLiab > 0 ? "up" : "down"} />
              <Kpi label="Avg per affected" value={inr(sum.avg_payout_per_affected)} />
              <Kpi label="Need investigation" value={`${sum.claims_needing_investigation}`} />
              <Kpi label="False payouts prevented" value={inr(sum.false_payouts_prevented_amount)} sub={`${sum.false_payouts_prevented_count} farm(s)`} wide />
              <Kpi label="Faulty sensors" value={`${sum.flagged_sensors}`} sub={`${sum.suspicious_sensors} suspicious`} />
              <Kpi label="Flood score" value={sum.district_flood_score.toFixed(2)} />
            </section>
          ) : <p className="text-sm text-ink-muted">{error ?? "Loading the land…"}</p>}

          <ControlsPanel land={result?.land ?? null} controls={controls} setControls={setControls} presets={presets} activePreset={activePreset} onPreset={applyPreset}
            sensors={sensors} selectedSensor={selectedSensor} placingStorm={placingStorm} setPlacingStorm={setPlacingStorm}
            tl={tl} playing={playing} onPlay={() => { setTl((t) => t ?? 0); setPlaying(true); }} onPause={() => setPlaying(false)}
            onReset={resetAll} onScrub={(v) => { setPlaying(false); setTl(v); }} />

          {result && <p className="text-[10px] text-ink-faint leading-snug">{result.notes.join(" ")}</p>}
        </aside>
      </div>
    </div>
  );
}

function Kpi({ label, value, sub, wide, subTone }: { label: string; value: string; sub?: string; wide?: boolean; subTone?: "up" | "down" }) {
  return (
    <div className={`rounded-xl border border-line bg-sunken p-2.5 ${wide ? "col-span-2" : ""}`}>
      <p className="text-[10px] uppercase tracking-wider text-ink-muted">{label}</p>
      <p className="text-lg font-bold text-ink leading-tight">{value}</p>
      {sub && <p className={`text-[11px] ${subTone === "up" ? "text-red-700" : subTone === "down" ? "text-green-700" : "text-ink-faint"}`}>{sub}</p>}
    </div>
  );
}
