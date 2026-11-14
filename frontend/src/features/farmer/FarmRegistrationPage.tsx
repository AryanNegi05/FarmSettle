/**
 * Register Your Farm — location search, manual boundary tracing on a 2D
 * satellite map, area calculation and a review step before saving.
 *
 * The boundary is ALWAYS traced by the user. Nothing here detects a farm
 * automatically or verifies land ownership.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import maplibregl, { Map, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import PageLayout from "../shared/PageLayout";
import { createFarm, addCrop, getFarm, updateFarm, uploadFarmImage } from "../../api/stage2";

type LngLat = [number, number];

// ─── Constants ───────────────────────────────────────────────────────────────

const CROP_TYPES = ["wheat", "rice", "maize", "cotton", "sugarcane", "other"];
const SEASONS = ["kharif", "rabi", "zaid"];

/** Fixed patch of real farmland (south-east of the demo district) that is shown
 *  by default so users land on a patchwork of field plots, not a city. */
const FARMLAND_CENTRE: [number, number] = [79.1496, 21.0281]; // [lng, lat]
const FARMLAND_ZOOM = 16.3;

const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
      attribution: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    },
  },
  layers: [{ id: "satellite", type: "raster", source: "esri" }],
};

/** Bundled example farmland image (public/example-farmland.jpg). It always loads,
 *  even if the live tile server is blocked, and is geo-referenced so traced
 *  areas are real-world accurate. Corners: TL, TR, BR, BL as [lng, lat]. */
const EXAMPLE_IMAGE_COORDS: [LngLat, LngLat, LngLat, LngLat] = [
  [79.1455078125, 21.03195543704973],
  [79.15374755859375, 21.03195543704973],
  [79.15374755859375, 21.024264421016003],
  [79.1455078125, 21.024264421016003],
];

type Stage = "locate" | "drawing" | "adjust" | "review";

// ─── Geometry helpers ────────────────────────────────────────────────────────

/** Project to local metres (equirectangular around the polygon centroid). */
function toMetres(pts: LngLat[]): [number, number][] {
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  return pts.map(([lng, lat]) => [lng * kx, lat * ky]);
}

function areaHectares(pts: LngLat[]): number {
  if (pts.length < 3) return 0;
  const m = toMetres(pts);
  let a = 0;
  for (let i = 0; i < m.length; i++) {
    const [x1, y1] = m[i];
    const [x2, y2] = m[(i + 1) % m.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a / 2) / 10000;
}

function centroid(pts: LngLat[]): LngLat {
  return [
    pts.reduce((s, p) => s + p[0], 0) / pts.length,
    pts.reduce((s, p) => s + p[1], 0) / pts.length,
  ];
}

function segmentsCross(a: [number, number], b: [number, number], c: [number, number], d: [number, number]) {
  const o = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function selfIntersects(pts: LngLat[]): boolean {
  const m = toMetres(pts);
  const n = m.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(m[i], m[(i + 1) % n], m[j], m[(j + 1) % n])) return true;
    }
  }
  return false;
}

function validate(pts: LngLat[]): string | null {
  if (pts.length < 3) return `Add at least 3 corner points (you have ${pts.length}).`;
  if (selfIntersects(pts)) return "The boundary lines cross each other. Move a corner or undo to fix it.";
  const ha = areaHectares(pts);
  if (ha < 0.01) return "The traced area is too small (under 0.01 ha). Trace the whole field.";
  if (ha > 500) return "The traced area is unusually large (over 500 ha). Please check your corners.";
  return null;
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function FarmRegistrationPage() {
  const navigate = useNavigate();
  const { farmId } = useParams<{ farmId: string }>();
  const isEdit = !!farmId;
  const [loadingFarm, setLoadingFarm] = useState(isEdit);

  // Form
  const [farmName, setFarmName] = useState("");
  const [village, setVillage] = useState("");
  const [district, setDistrict] = useState("Nagpur");
  const [stateName, setStateName] = useState("Maharashtra");
  const [cropType, setCropType] = useState("wheat");
  const [cropSeason, setCropSeason] = useState("kharif");

  // Search
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState<string | null>(null);

  // Drawing
  const [stage, setStage] = useState<Stage>("locate");
  const [points, setPoints] = useState<LngLat[]>([]);
  const [closed, setClosed] = useState(false);
  const [boundaryError, setBoundaryError] = useState<string | null>(null);

  // Submit
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map refs (state mirrored into refs so map handlers never go stale)
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const stageRef = useRef<Stage>(stage);
  const pointsRef = useRef<LngLat[]>(points);
  const closedRef = useRef(closed);
  stageRef.current = stage;
  pointsRef.current = points;
  closedRef.current = closed;

  const hectares = useMemo(() => (closed ? areaHectares(points) : 0), [closed, points]);

  // ── Map init ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: FARMLAND_CENTRE,
      zoom: FARMLAND_ZOOM,
      minZoom: 12,
      maxZoom: 19.5,
      preserveDrawingBuffer: true, // lets us capture a snapshot of the traced map
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      const empty = { type: "FeatureCollection", features: [] } as GeoJSON.FeatureCollection;
      map.addSource("example-farmland", { type: "image", url: "/example-farmland.jpg", coordinates: EXAMPLE_IMAGE_COORDS });
      map.addLayer({ id: "example-farmland", type: "raster", source: "example-farmland", paint: { "raster-fade-duration": 0 } });
      map.addSource("boundary", { type: "geojson", data: empty });
      map.addSource("vertices", { type: "geojson", data: empty });
      map.addLayer({ id: "boundary-fill", type: "fill", source: "boundary", filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": "#22c55e", "fill-opacity": 0.3 } });
      map.addLayer({ id: "boundary-line", type: "line", source: "boundary",
        paint: { "line-color": "#22c55e", "line-width": 3 }, layout: { "line-join": "round" } });
      map.addLayer({ id: "vertex-halo", type: "circle", source: "vertices",
        paint: { "circle-radius": 11, "circle-color": "#ffffff", "circle-opacity": 0.35 } });
      map.addLayer({ id: "vertex-dot", type: "circle", source: "vertices",
        paint: {
          "circle-radius": 6,
          "circle-color": ["case", ["==", ["get", "first"], true], "#f59e0b", "#22c55e"],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        } });
      setMapReady(true);
    });

    // Add a corner while drawing.
    map.on("click", (e) => {
      if (stageRef.current !== "drawing") return;
      const hit = map.queryRenderedFeatures(e.point, { layers: ["vertex-dot"] });
      if (hit.length) return; // clicking an existing corner doesn't add a new one
      setBoundaryError(null);
      setPoints((p) => [...p, [e.lngLat.lng, e.lngLat.lat]]);
    });

    // Drag corners (mouse + touch) when adjusting.
    let dragIndex: number | null = null;
    const startDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (stageRef.current !== "adjust" && stageRef.current !== "drawing") return;
      const f = (e as maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }).features?.[0];
      if (!f) return;
      e.preventDefault();
      dragIndex = f.properties?.index as number;
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
    };
    const moveDrag = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (dragIndex === null) return;
      const idx = dragIndex;
      setPoints((p) => p.map((pt, i) => (i === idx ? [e.lngLat.lng, e.lngLat.lat] : pt)));
    };
    const endDrag = () => {
      if (dragIndex === null) return;
      dragIndex = null;
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
    };
    map.on("mousedown", "vertex-dot", startDrag);
    map.on("touchstart", "vertex-dot", startDrag);
    map.on("mousemove", moveDrag);
    map.on("touchmove", moveDrag);
    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);
    map.on("mouseenter", "vertex-dot", () => { if (dragIndex === null) map.getCanvas().style.cursor = "grab"; });
    map.on("mouseleave", "vertex-dot", () => { if (dragIndex === null) map.getCanvas().style.cursor = ""; });

    return () => {
      setMapReady(false);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // ── Push drawing state into the map ────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const lineOrPoly: GeoJSON.Feature[] = [];
    if (points.length >= 2) {
      const ring = closed ? [...points, points[0]] : points;
      if (closed || points.length >= 3) {
        // Live preview: shade the area while the user keeps adding corners.
        lineOrPoly.push({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...points, points[0]]] } });
      }
      lineOrPoly.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } });
    }
    const boundarySrc = map.getSource("boundary") as GeoJSONSource | undefined;
    const vertexSrc = map.getSource("vertices") as GeoJSONSource | undefined;
    if (!boundarySrc || !vertexSrc) return; // map was recreated and its layers are not added yet
    boundarySrc.setData({ type: "FeatureCollection", features: lineOrPoly });
    vertexSrc.setData({
      type: "FeatureCollection",
      features: points.map((p, i) => ({
        type: "Feature",
        properties: { index: i, first: i === 0 },
        geometry: { type: "Point", coordinates: p },
      })),
    });
  }, [points, closed, mapReady]);

  // Crosshair cursor while drawing.
  useEffect(() => {
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = stage === "drawing" ? "crosshair" : "";
  }, [stage, mapReady]);

  // Keep the map sized when the layout changes between steps.
  useEffect(() => { mapRef.current?.resize(); }, [stage]);

  // Live validation while adjusting a closed polygon.
  useEffect(() => {
    if (closed) setBoundaryError(validate(points));
  }, [points, closed]);

  // ── Edit mode: load the saved farm and its boundary ───────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!isEdit || !farmId || !map || !mapReady) return;
    let cancelled = false;
    getFarm(farmId)
      .then((farm) => {
        if (cancelled) return;
        setFarmName(farm.name);
        let ring: LngLat[] = [];
        try {
          const parsed = farm.boundary_geojson ? JSON.parse(farm.boundary_geojson) : null;
          const geom = parsed?.geometry ?? parsed;
          const props = parsed?.properties ?? {};
          if (props.village) setVillage(props.village);
          if (props.district) setDistrict(props.district);
          if (props.state) setStateName(props.state);
          if (geom?.type === "Polygon") ring = (geom.coordinates[0] as LngLat[]).slice(0, -1);
        } catch { /* legacy farm without a traced boundary */ }
        if (ring.length >= 3) {
          setPoints(ring);
          setClosed(true);
          setStage("adjust");
          const lngs = ring.map((p) => p[0]);
          const lats = ring.map((p) => p[1]);
          map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 80, duration: 0, maxZoom: 18.5 });
        } else if (farm.latitude != null && farm.longitude != null) {
          map.jumpTo({ center: [farm.longitude, farm.latitude], zoom: 17 });
        }
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load this farm"))
      .finally(() => !cancelled && setLoadingFarm(false));
    return () => { cancelled = true; };
  }, [isEdit, farmId, mapReady]);

  // ── Actions ────────────────────────────────────────────────────────────────

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim() || [village, district, stateName].filter(Boolean).join(", ");
    if (!q) { setSearchMsg("Type a village, town or district to search."); return; }
    setSearching(true);
    setSearchMsg(null);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`,
      );
      const data = (await res.json()) as { lat: string; lon: string; display_name: string }[];
      if (!data.length) {
        setSearchMsg("No match found. Try a nearby town, or pan the map by hand.");
      } else {
        mapRef.current?.flyTo({ center: [parseFloat(data[0].lon), parseFloat(data[0].lat)], zoom: 16, duration: 1500 });
        setSearchMsg(`Showing: ${data[0].display_name}. Zoom in and find your fields.`);
      }
    } catch {
      setSearchMsg("Search is unavailable right now. You can still pan and zoom the map manually.");
    } finally {
      setSearching(false);
    }
  }

  function startDrawing() {
    setPoints([]);
    setClosed(false);
    setBoundaryError(null);
    setStage("drawing");
  }

  function undoPoint() {
    if (closed) { setClosed(false); }
    setPoints((p) => p.slice(0, -1));
    setBoundaryError(null);
  }

  function clearAll() {
    setPoints([]);
    setClosed(false);
    setBoundaryError(null);
    setStage("drawing");
  }

  function finishBoundary() {
    const err = validate(points);
    if (err) { setBoundaryError(err); return; }
    setBoundaryError(null);
    setClosed(true);
    setStage("adjust");
  }

  function goToReview() {
    if (!farmName.trim()) { setError("Please enter a farm name before reviewing."); return; }
    const err = validate(points);
    if (err) { setBoundaryError(err); return; }
    setError(null);
    setStage("review");
    const lngs = points.map((p) => p[0]);
    const lats = points.map((p) => p[1]);
    mapRef.current?.fitBounds(
      [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
      { padding: 70, duration: 800, maxZoom: 18 },
    );
  }

  /** Frame the traced boundary and grab the map canvas as a JPEG data URL. */
  async function captureSnapshot(): Promise<string | null> {
    const map = mapRef.current;
    if (!map) return null;
    try {
      const lngs = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);
      map.fitBounds([[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
        { padding: 60, duration: 0, maxZoom: 18.5 });
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 4000);
        map.once("idle", () => { clearTimeout(t); resolve(); });
        map.triggerRepaint();
      });
      return map.getCanvas().toDataURL("image/jpeg", 0.85);
    } catch {
      return null;
    }
  }

  const handleSave = useCallback(async () => {
    setError(null);
    const err = validate(points);
    if (err) { setBoundaryError(err); setStage("adjust"); return; }
    setSaving(true);
    const t0 = performance.now();
    const log = (msg: string, extra?: unknown) =>
      console.log(`[farm-save +${Math.round(performance.now() - t0)}ms] ${msg}`, extra ?? "");
    log(`start (${isEdit ? "edit" : "create"})`, { points: points.length });
    try {
      const [lng, lat] = centroid(points);
      const feature = {
        type: "Feature",
        properties: { village: village.trim(), district: district.trim(), state: stateName.trim(), traced_by: "user" },
        geometry: { type: "Polygon", coordinates: [[...points, points[0]]] },
      };
      const ha = Math.round(areaHectares(points) * 100) / 100;
      const payload = {
        name: farmName.trim(),
        area_hectares: ha,
        latitude: lat,
        longitude: lng,
        boundary_geojson: JSON.stringify(feature),
      };
      let savedId: string | number;
      if (isEdit && farmId) {
        log("PUT /farmers/farms/" + farmId + " …");
        await updateFarm(farmId, payload);
        savedId = farmId;
        log("farm updated");
      } else {
        log("POST /farmers/farms …");
        const farm = await createFarm(payload);
        log("farm created", { id: farm.id });
        await addCrop(farm.id, { crop_type: cropType, season: cropSeason, area_hectares: ha });
        log("crop added");
        savedId = farm.id;
      }
      // Store the map picture on Cloudinary (via our backend). A failed upload
      // must not lose the farm, so it is non-fatal.
      log("capturing map snapshot …");
      const snapshot = await captureSnapshot();
      if (snapshot) {
        log(`snapshot captured (${Math.round(snapshot.length / 1024)} KB), uploading to Cloudinary via backend …`);
        try {
          const out = await uploadFarmImage(savedId, snapshot);
          log("image uploaded OK", { map_image_url: out.map_image_url });
        } catch (imgErr) {
          console.error("[farm-save] image upload FAILED (farm itself was saved)", imgErr);
        }
      } else {
        console.error("[farm-save] snapshot capture returned null — no image uploaded");
      }
      log("done, navigating to My Farms");
      navigate("/farmer/farms");
    } catch (e: unknown) {
      console.error("[farm-save] FAILED", e);
      setError(e instanceof Error ? e.message : "Failed to register farm");
    } finally {
      setSaving(false);
    }
  }, [points, village, district, stateName, farmName, cropType, cropSeason, navigate, isEdit, farmId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── UI ─────────────────────────────────────────────────────────────────────

  const inputCls =
    "w-full bg-navy border border-navy-700 rounded-lg px-3 py-2 text-white text-sm placeholder-gray-500 focus:outline-none focus:border-brand-blue";
  const btn = "text-sm font-semibold px-3 py-2 rounded-lg transition disabled:opacity-40";

  const steps: { id: Stage[]; label: string }[] = [
    { id: ["locate"], label: "1 · Find your land" },
    { id: ["drawing", "adjust"], label: "2 · Trace boundary" },
    { id: ["review"], label: "3 · Review & save" },
  ];

  const instruction: Record<Stage, string> = {
    locate: "Search for your village, or pan and zoom the satellite map until you can see your fields. Then press “Start Drawing”.",
    drawing: points.length === 0
      ? "Click on one corner of your farm on the map."
      : `${points.length} point${points.length > 1 ? "s" : ""} placed. Keep clicking around the edge of your farm. When you're done, press “Finish Boundary”.`,
    adjust: "Boundary complete. Drag any white-ringed corner to fine-tune it, then review.",
    review: "Check the details below. You can still go back and edit the boundary.",
  };

  const location = [village.trim(), district.trim(), stateName.trim()].filter(Boolean).join(", ") || "—";

  return (
    <PageLayout title={isEdit ? "Edit Farm Boundary" : "Register Your Farm"} subtitle={isEdit ? "Adjust your farm's corners, or redraw the boundary" : "Find your land on the satellite map and trace its boundary"} backTo="/farmer/farms">
      {/* Stepper */}
      <ol className="flex flex-wrap gap-2 mb-4 text-xs">
        {steps.map((s) => {
          const active = s.id.includes(stage);
          return (
            <li key={s.label} className={`px-3 py-1 rounded-full border ${active ? "bg-brand-green/20 border-brand-green text-green-300" : "border-navy-700 text-gray-500"}`}>
              {s.label}
            </li>
          );
        })}
      </ol>

      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* ── Side panel ─────────────────────────────────────────────── */}
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-4 space-y-4 order-2 lg:order-1">
          {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">{error}</div>}

          <div className="bg-navy border border-navy-700 rounded-lg px-3 py-2 text-sm text-gray-300">
            {instruction[stage]}
          </div>

          {stage !== "review" && (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-400">Farm name *</label>
                  <input className={inputCls} placeholder="e.g. North Field" value={farmName} onChange={(e) => setFarmName(e.target.value)} />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3 gap-2">
                  <div>
                    <label className="text-xs text-gray-400">Village</label>
                    <input className={inputCls} value={village} onChange={(e) => setVillage(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">District</label>
                    <input className={inputCls} value={district} onChange={(e) => setDistrict(e.target.value)} />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">State</label>
                    <input className={inputCls} value={stateName} onChange={(e) => setStateName(e.target.value)} />
                  </div>
                </div>
                <div className={`grid grid-cols-2 gap-2 ${isEdit ? "hidden" : ""}`}>
                  <div>
                    <label className="text-xs text-gray-400">Crop</label>
                    <select className={inputCls} value={cropType} onChange={(e) => setCropType(e.target.value)}>
                      {CROP_TYPES.map((c) => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400">Season</label>
                    <select className={inputCls} value={cropSeason} onChange={(e) => setCropSeason(e.target.value)}>
                      {SEASONS.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                    </select>
                  </div>
                </div>
              </div>

              <form onSubmit={handleSearch} className="flex gap-2">
                <input className={inputCls} placeholder="Search location…" value={query} onChange={(e) => setQuery(e.target.value)} />
                <button type="submit" disabled={searching} className={`${btn} bg-navy-700 text-white hover:bg-navy-600`}>
                  {searching ? "…" : "Search"}
                </button>
              </form>
              {searchMsg && <p className="text-xs text-gray-400">{searchMsg}</p>}
            </>
          )}

          {/* Drawing controls */}
          {stage === "locate" && (
            <button onClick={startDrawing} className={`${btn} w-full bg-brand-green text-navy`}>Start Drawing</button>
          )}

          {stage === "drawing" && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={undoPoint} disabled={!points.length} className={`${btn} bg-navy-700 text-white hover:bg-navy-600`}>↶ Undo point</button>
                <button onClick={clearAll} disabled={!points.length} className={`${btn} bg-navy-700 text-white hover:bg-navy-600`}>Clear all</button>
              </div>
              <button onClick={finishBoundary} disabled={points.length < 3} className={`${btn} w-full bg-brand-green text-navy`}>
                Finish Boundary
              </button>
              {points.length > 0 && points.length < 3 && (
                <p className="text-xs text-amber-400">Add at least 3 corners to make an area.</p>
              )}
            </div>
          )}

          {stage === "adjust" && (
            <div className="space-y-2">
              <BoundaryStats points={points} hectares={hectares} error={boundaryError} />
              <div className="grid grid-cols-2 gap-2">
                <button onClick={startDrawing} className={`${btn} bg-navy-700 text-white hover:bg-navy-600`}>Redraw</button>
                <button onClick={undoPoint} className={`${btn} bg-navy-700 text-white hover:bg-navy-600`}>↶ Undo point</button>
              </div>
              <button onClick={goToReview} disabled={!!boundaryError} className={`${btn} w-full bg-brand-green text-navy`}>
                Review farm →
              </button>
            </div>
          )}

          {stage === "review" && (
            <div className="space-y-3">
              <dl className="text-sm space-y-2">
                <Row label="Farm name" value={farmName.trim()} />
                <Row label="Location" value={location} />
                {!isEdit && <Row label="Crop" value={`${cropType} · ${cropSeason}`} />}
                <Row label="Boundary points" value={String(points.length)} />
                <Row label="Total area" value={`${hectares.toFixed(2)} ha`} strong />
              </dl>
              <p className="text-xs text-gray-500">
                This boundary was traced by you on satellite imagery. ParaTrust does not detect farms automatically or verify land ownership.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setStage("adjust")} disabled={saving} className={`${btn} bg-navy-700 text-white hover:bg-navy-600`}>Edit Boundary</button>
                <button onClick={handleSave} disabled={saving} className={`${btn} bg-brand-green text-navy`}>
                  {saving ? "Saving…" : isEdit ? "Save Changes" : "Confirm & Save Farm"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Map ─────────────────────────────────────────────────────── */}
        <div className="relative rounded-xl overflow-hidden border border-navy-700 order-1 lg:order-2 h-[55vh] lg:h-[calc(100vh-220px)] min-h-[320px]">
          <div ref={containerRef} style={{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }} />
          {loadingFarm && (
            <div className="absolute inset-0 z-20 bg-navy/70 flex items-center justify-center text-gray-300 text-sm">Loading your farm…</div>
          )}
          <div className="absolute top-2 left-2 z-10 bg-black/60 text-xs text-gray-200 px-2 py-1 rounded pointer-events-none">
            {stage === "drawing" ? "Drawing mode — click to add corners" : stage === "adjust" ? "Drag corners to adjust" : "Example farmland (satellite imagery)"}
          </div>
          {closed && stage !== "locate" && (
            <div className="absolute bottom-8 right-2 z-10 bg-navy-800/90 border border-brand-green text-green-300 text-xs font-semibold px-3 py-1.5 rounded-lg">
              {hectares.toFixed(2)} ha · {points.length} points
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-400">{label}</dt>
      <dd className={`text-right ${strong ? "text-green-300 font-semibold" : "text-white"}`}>{value}</dd>
    </div>
  );
}

function BoundaryStats({ points, hectares, error }: { points: LngLat[]; hectares: number; error: string | null }) {
  if (error) {
    return <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-3 py-2 text-sm">⚠ {error}</div>;
  }
  return (
    <div className="bg-green-900/30 border border-green-700 rounded-lg px-3 py-2 text-sm text-green-200">
      ✓ Boundary selected — <b>{hectares.toFixed(2)} ha</b> across {points.length} points.
    </div>
  );
}
