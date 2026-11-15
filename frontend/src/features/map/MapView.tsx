/**
 * Shared MapLibre map component used by both the insurer Operations Map and
 * the farmer My Farm Map. Renders:
 *   - Satellite basemap (ESRI World Imagery, clearly labelled)
 *   - Simulated demo district boundary
 *   - Farm boundary polygons (role-aware: farmer sees own, insurer sees all in-district)
 *   - Rainfall-gauge markers
 *   - Water-level gauge markers
 *   - River / water-body overlays
 *
 * Layer visibility is toggled via the LayerControls panel. Clicking a farm
 * polygon opens the FarmDetailPanel with a rich detail record.
 *
 * Labels on simulated overlays distinguish them from real basemap imagery.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl, { Map, GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  getDistrict, getSensors, getWater, getFarmsGeo, getFarmDetail,
  FeatureCollection, FarmMapDetail, GeoFeature,
} from "../../api/geo";
import type { SimulationSnapshot } from "../../api/simulation";

// ─── Constants ─────────────────────────────────────────────────────────────

// ESRI World Imagery — public tile service, no API key required.
const SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    esri: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      attribution: "Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community",
      maxzoom: 18,
    },
    esri_labels: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 18,
    },
  },
  layers: [
    { id: "satellite", type: "raster", source: "esri" },
    { id: "labels", type: "raster", source: "esri_labels", paint: { "raster-opacity": 0.7 } },
  ],
};

// Demo district centre (Vidarbha / Nagpur basin). Used as the initial view when
// no farm centroid is available.
const DISTRICT_CENTRE: [number, number] = [79.088, 21.145]; // [lng, lat]
const DISTRICT_ZOOM = 11;

export interface LayerVisibility {
  farms: boolean;
  district: boolean;
  sensors_rainfall: boolean;
  sensors_water: boolean;
  water: boolean;
  rainfall_overlay: boolean;
  flood_overlay: boolean;
  /** sensor trust overlay (coloured by trust score, flagged sensors highlighted). */
  sensor_trust: boolean;
  /** farm risk overlay (coloured by risk category). */
  risk_overlay: boolean;
}

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  farms: true,
  district: true,
  sensors_rainfall: true,
  sensors_water: true,
  water: true,
  rainfall_overlay: true,
  flood_overlay: true,
  sensor_trust: true,
  risk_overlay: true,
};

interface MapViewProps {
  centreOnFarm?: { lat: number; lng: number; zoom?: number } | null;
  initialSelectedFarmId?: string | number | null;
  height?: string;
  /** Start in the tilted 3D terrain view. */
  default3D?: boolean;
  layerVisibility?: Partial<LayerVisibility>;
  /** Live weather snapshot — when provided, rainfall + flood overlays are rendered. */
  weatherSnapshot?: SimulationSnapshot | null;
  /** sensor trust GeoJSON (annotated FeatureCollection). When present,
   *  sensors are recoloured by trust score and flagged sensors are highlighted. */
  sensorTrust?: GeoJSON.FeatureCollection | null;
  /** called when a sensor trust marker is clicked. */
  onSensorClick?: (sensorId: string) => void;
  /** farm risk GeoJSON. When present, farms are coloured by risk category. */
  riskGeojson?: GeoJSON.FeatureCollection | null;
  /** called when a risk polygon is clicked. */
  onFarmRiskClick?: (farmId: string) => void;
}

export default function MapView({
  centreOnFarm,
  initialSelectedFarmId,
  height = "calc(100vh - 112px)",
  default3D = false,
  layerVisibility: layerVisibilityProp,
  weatherSnapshot,
  sensorTrust,
  onSensorClick,
  riskGeojson,
  onFarmRiskClick,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [layers, setLayers] = useState<LayerVisibility>({
    ...DEFAULT_LAYER_VISIBILITY,
    ...layerVisibilityProp,
  });
  const [selectedFarm, setSelectedFarm] = useState<FarmMapDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [searchId, setSearchId] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [is3D, setIs3D] = useState(default3D);
  const farmImages = useRef<Record<string, string>>({});
  const bound3DClicks = useRef(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  // ── Load all geographic data once the map is ready ─────────────────────

  const loadData = useCallback(async (map: Map) => {
    try {
      const [district, sensors, water, farms] = await Promise.all([
        getDistrict(), getSensors(), getWater(), getFarmsGeo(),
      ]);

      // ── Add sources ──────────────────────────────────────────────────────

      farmImages.current = {};
      for (const f of farms.features) {
        const p = f.properties as { farm_id?: string | number; map_image_url?: string | null };
        if (p.farm_id != null && p.map_image_url) farmImages.current[String(p.farm_id)] = p.map_image_url;
      }

      map.addSource("district", { type: "geojson", data: district });
      map.addSource("farms", { type: "geojson", data: farms });
      map.addSource("sensors", { type: "geojson", data: sensors });
      map.addSource("water", { type: "geojson", data: water });

      // ── District boundary ────────────────────────────────────────────────

      map.addLayer({
        id: "district-fill",
        type: "fill",
        source: "district",
        paint: { "fill-color": "#3b82f6", "fill-opacity": 0.05 },
      });
      map.addLayer({
        id: "district-line",
        type: "line",
        source: "district",
        paint: { "line-color": "#3b82f6", "line-width": 2, "line-dasharray": [4, 3] },
      });

      // ── Water bodies ─────────────────────────────────────────────────────

      map.addLayer({
        id: "water-fill",
        type: "fill",
        source: "water",
        filter: ["==", ["get", "kind"], "water_body"],
        paint: { "fill-color": "#38bdf8", "fill-opacity": 0.35 },
      });
      map.addLayer({
        id: "river-line",
        type: "line",
        source: "water",
        filter: ["==", ["get", "kind"], "river"],
        paint: { "line-color": "#38bdf8", "line-width": 2.5, "line-opacity": 0.8 },
      });

      // ── Farm polygons ────────────────────────────────────────────────────

      map.addLayer({
        id: "farms-fill",
        type: "fill",
        source: "farms",
        paint: {
          "fill-color": [
            "case",
            ["==", ["get", "policy_status"], "active"], "#22c55e",
            ["==", ["get", "is_own"], true], "#22c55e",
            "#94a3b8",
          ],
          "fill-opacity": 0.3,
        },
      });
      map.addLayer({
        id: "farms-line",
        type: "line",
        source: "farms",
        paint: {
          "line-color": [
            "case",
            ["==", ["get", "is_own"], true], "#22c55e",
            ["==", ["get", "policy_status"], "active"], "#22c55e",
            "#64748b",
          ],
          "line-width": 1.8,
        },
      });
      map.addLayer({
        id: "farms-fill-hover",
        type: "fill",
        source: "farms",
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0 },
      });

      // ── Sensors ───────────────────────────────────────────────────────────

      map.addLayer({
        id: "sensors-rainfall",
        type: "circle",
        source: "sensors",
        filter: ["==", ["get", "sensor_type"], "rainfall"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#a78bfa",
          "circle-stroke-color": "#7c3aed",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.9,
        },
      });
      map.addLayer({
        id: "sensors-water-level",
        type: "circle",
        source: "sensors",
        filter: ["==", ["get", "sensor_type"], "water_level"],
        paint: {
          "circle-radius": 7,
          "circle-color": "#38bdf8",
          "circle-stroke-color": "#0ea5e9",
          "circle-stroke-width": 1.5,
          "circle-opacity": 0.9,
        },
      });

      // ── Farm click handler ────────────────────────────────────────────────

      map.on("click", "farms-fill", (e) => {
        const feature = e.features?.[0];
        const farmId = feature?.properties?.farm_id as number | undefined;
        if (!farmId) return;
        openFarmDetail(farmId);
      });

      map.on("mouseenter", "farms-fill", () => { map.getCanvas().style.cursor = "pointer"; });
      map.on("mouseleave", "farms-fill", () => { map.getCanvas().style.cursor = ""; });

      // Sensor tooltips
      const sensorPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      for (const layerId of ["sensors-rainfall", "sensors-water-level"]) {
        map.on("mouseenter", layerId, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          map.getCanvas().style.cursor = "help";
          const p = f.properties as { name: string; sensor_type: string; status: string };
          sensorPopup
            .setLngLat((e as any).lngLat)
            .setHTML(
              `<div class="text-xs font-medium">${p.name}</div>` +
              `<div class="text-xs text-ink-muted capitalize">${p.sensor_type.replace("_", " ")}</div>` +
              `<div class="text-xs text-ink-faint">Status: ${p.status ?? "normal"}</div>` +
              `<div class="text-xs text-ink-faint italic">Simulated sensor</div>`
            )
            .addTo(map);
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
          sensorPopup.remove();
        });
      }

      // ── Weather overlay sources (populated by weatherSnapshot effect) ──────

      map.addSource("rainfall-overlay", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("flood-overlay", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      // Rainfall intensity — heatmap-style circles sized by mm/hr.
      map.addLayer({
        id: "rainfall-circles",
        type: "circle",
        source: "rainfall-overlay",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "rainfall_mm_hr"],
            0, 8, 20, 18, 60, 30, 120, 44,
          ],
          "circle-color": [
            "interpolate", ["linear"], ["get", "rainfall_mm_hr"],
            0,  "#bfdbfe",
            10, "#60a5fa",
            30, "#2563eb",
            60, "#7c3aed",
            100,"#dc2626",
          ],
          "circle-opacity": [
            "interpolate", ["linear"], ["get", "rainfall_mm_hr"],
            0, 0.0, 1, 0.15, 10, 0.5, 120, 0.75,
          ],
          "circle-blur": 1.0,
        },
      });

      // Flood polygon — red fill, clearly labelled simulated.
      map.addLayer({
        id: "flood-fill",
        type: "fill",
        source: "flood-overlay",
        paint: { "fill-color": "#ef4444", "fill-opacity": 0.28 },
      });
      map.addLayer({
        id: "flood-line",
        type: "line",
        source: "flood-overlay",
        paint: { "line-color": "#ef4444", "line-width": 2, "line-dasharray": [3, 2] },
      });

      setMapReady(true);
    } catch (err) {
      console.error("Failed to load map data:", err);
    }
  }, []);

  // ── Initialise map ────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const centre = centreOnFarm
      ? [centreOnFarm.lng, centreOnFarm.lat] as [number, number]
      : DISTRICT_CENTRE;
    const zoom = centreOnFarm ? (centreOnFarm.zoom ?? 14) : DISTRICT_ZOOM;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: centre,
      zoom,
      attributionControl: { compact: true },
    });

    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => loadData(map));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-open initial farm ─────────────────────────────────────────────────

  useEffect(() => {
    if (mapReady && initialSelectedFarmId) {
      openFarmDetail(initialSelectedFarmId);
    }
  }, [mapReady, initialSelectedFarmId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 3D terrain + extruded overlays ────────────────────────────────────────
  // Toggled from the "3D" button. Adds a free AWS Terrarium DEM for terrain,
  // extrudes farm / flood / risk polygons and tilts the camera.

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const FLOOD_3D = "flood-3d";
    const FARMS_3D = "farms-3d";

    if (is3D) {
      try {
        if (!map.getSource("terrain-dem")) {
          map.addSource("terrain-dem", {
            type: "raster-dem",
            tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
            tileSize: 256,
            maxzoom: 14,
            encoding: "terrarium",
          });
        }
        map.setTerrain({ source: "terrain-dem", exaggeration: 1.6 });

        if (!map.getLayer(FARMS_3D) && map.getSource("farms")) {
          map.addLayer({
            id: FARMS_3D,
            type: "fill-extrusion",
            source: "farms",
            paint: {
              "fill-extrusion-color": [
                "case",
                ["==", ["get", "is_own"], true], "#22c55e",
                ["==", ["get", "policy_status"], "active"], "#16a34a",
                "#64748b",
              ],
              "fill-extrusion-height": ["case", ["==", ["get", "policy_status"], "active"], 34, 16],
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.75,
            },
          });
        }
        if (!map.getLayer(FLOOD_3D) && map.getSource("flood-overlay")) {
          map.addLayer({
            id: FLOOD_3D,
            type: "fill-extrusion",
            source: "flood-overlay",
            paint: {
              "fill-extrusion-color": "#2563eb",
              "fill-extrusion-height": 35,
              "fill-extrusion-base": 0,
              "fill-extrusion-opacity": 0.55,
            },
          });
        }
        if (!bound3DClicks.current) {
          bound3DClicks.current = true;
          map.on("click", FARMS_3D, (e) => {
            const id = e.features?.[0]?.properties?.farm_id as number | undefined;
            if (id) openFarmDetail(id);
          });
          map.on("mouseenter", FARMS_3D, () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", FARMS_3D, () => { map.getCanvas().style.cursor = ""; });
        }
        // Flat fills sit under the extrusions in 3D — hide to avoid z-fighting.
        for (const id of ["farms-fill", "flood-fill"]) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
        }
        map.easeTo({ pitch: 62, bearing: -20, duration: 1200 });
      } catch (err) {
        console.error("3D mode failed:", err);
        setIs3D(false);
      }
    } else {
      try {
        map.setTerrain(null);
        for (const id of [FARMS_3D, FLOOD_3D]) {
          if (map.getLayer(id)) map.removeLayer(id);
        }
        if (map.getLayer("farms-fill")) {
          map.setLayoutProperty("farms-fill", "visibility", layers.farms ? "visible" : "none");
        }
        if (map.getLayer("flood-fill")) {
          map.setLayoutProperty("flood-fill", "visibility", layers.flood_overlay ? "visible" : "none");
        }
        map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
      } catch (err) {
        console.error("Leaving 3D mode failed:", err);
      }
    }
  }, [is3D, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Layer visibility sync ─────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const toggle = (ids: string[], visible: boolean) => {
      for (const id of ids) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
    };

    // When the trust overlay is active, the base static sensor circles
    // are hidden so we don't show two sets of markers at the same location.
    const hasTrust = !!sensorTrust;

    toggle(["district-fill", "district-line"], layers.district);
    toggle(["farms-fill", "farms-line", "farms-fill-hover"], layers.farms);
    toggle(["sensors-rainfall"], layers.sensors_rainfall && !hasTrust);
    toggle(["sensors-water-level"], layers.sensors_water && !hasTrust);
    toggle(["water-fill", "river-line"], layers.water);
    toggle(["rainfall-circles"], layers.rainfall_overlay);
    toggle(["flood-fill", "flood-line"], layers.flood_overlay);
    toggle(["sensor-trust-fill", "sensor-trust-flagged-halo"], hasTrust && layers.sensor_trust);
    toggle(["farm-risk-fill", "farm-risk-line"], layers.risk_overlay && !!riskGeojson);
  }, [layers, mapReady, sensorTrust, riskGeojson]);

  // ── Weather overlay update ─────────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const rainfallSrc = map.getSource("rainfall-overlay") as GeoJSONSource | undefined;
    const floodSrc    = map.getSource("flood-overlay")    as GeoJSONSource | undefined;

    if (weatherSnapshot) {
      rainfallSrc?.setData(weatherSnapshot.rainfall_geojson as any);
      const floodData: GeoJSON.FeatureCollection = weatherSnapshot.flood_geojson
        ? { type: "FeatureCollection", features: [weatherSnapshot.flood_geojson as any] }
        : { type: "FeatureCollection", features: [] };
      floodSrc?.setData(floodData as any);
    } else {
      const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
      rainfallSrc?.setData(empty as any);
      floodSrc?.setData(empty as any);
    }
  }, [weatherSnapshot, mapReady]);

  // ── Sensor trust overlay ────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Lazily create the trust source + layers the first time trust data arrives.
    if (!map.getSource("sensor-trust")) {
      map.addSource("sensor-trust", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      // Halo behind flagged sensors — drawn first so it sits beneath the fill.
      map.addLayer({
        id: "sensor-trust-flagged-halo",
        type: "circle",
        source: "sensor-trust",
        filter: ["==", ["get", "is_flagged"], true],
        paint: {
          "circle-radius": 16,
          "circle-color": "#ef4444",
          "circle-opacity": 0.25,
          "circle-stroke-color": "#ef4444",
          "circle-stroke-width": 1,
          "circle-stroke-opacity": 0.5,
        },
      });
      // Main trust marker — coloured by trust score, ringed red when flagged.
      map.addLayer({
        id: "sensor-trust-fill",
        type: "circle",
        source: "sensor-trust",
        paint: {
          "circle-radius": 9,
          "circle-color": [
            "interpolate", ["linear"], ["get", "trust_score"],
            0.0, "#ef4444",
            0.4, "#f59e0b",
            0.7, "#22c55e",
            1.0, "#16a34a",
          ],
          "circle-stroke-color": [
            "case", ["==", ["get", "is_flagged"], true], "#ef4444", "#0f1729",
          ],
          "circle-stroke-width": ["case", ["==", ["get", "is_flagged"], true], 2.5, 1],
          "circle-opacity": 0.92,
        },
      });

      // Hover popup with trust detail.
      const trustPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });
      map.on("mouseenter", "sensor-trust-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const p = f.properties as {
          id: string; name: string; sensor_type: string;
          trust_score: number; predicted_class: string; is_flagged: boolean; confidence: number;
        };
        const clsLabel = p.predicted_class === "genuine_localised_cell" ? "Genuine localised cell" : p.predicted_class;
        const flagHtml = p.is_flagged
          ? `<div class="text-xs text-red-700 font-semibold">⚠ Flagged — investigate</div>`
          : `<div class="text-xs text-green-700">No fault detected</div>`;
        trustPopup
          .setLngLat((e as any).lngLat)
          .setHTML(
            `<div class="text-xs font-medium font-mono">${p.id}</div>` +
            `<div class="text-xs text-ink-muted capitalize">${p.sensor_type.replace("_", " ")}</div>` +
            `<div class="text-xs text-ink-soft">Class: <span class="capitalize">${clsLabel}</span></div>` +
            `<div class="text-xs text-ink-soft">Trust: ${p.trust_score.toFixed(2)} · conf ${Math.round((p.confidence ?? 0) * 100)}%</div>` +
            flagHtml +
            `<div class="text-xs text-ink-faint italic">Simulated · click for detail</div>`
          )
          .addTo(map);
      });
      map.on("mouseleave", "sensor-trust-fill", () => {
        map.getCanvas().style.cursor = "";
        trustPopup.remove();
      });

      // Click → open the investigation panel.
      map.on("click", "sensor-trust-fill", (e) => {
        const f = e.features?.[0];
        const id = f?.properties?.id as string | undefined;
        if (id && onSensorClick) onSensorClick(id);
      });
    }

    // Push the latest trust data into the source.
    const src = map.getSource("sensor-trust") as GeoJSONSource | undefined;
    if (src) {
      const data: GeoJSON.FeatureCollection = sensorTrust ?? { type: "FeatureCollection", features: [] };
      src.setData(data as any);
    }
  }, [sensorTrust, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Farm risk overlay ────────────────────────────────────────────

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    if (!map.getSource("farm-risk")) {
      map.addSource("farm-risk", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "farm-risk-fill",
        type: "fill",
        source: "farm-risk",
        paint: {
          "fill-color": ["coalesce", ["get", "colour"], "#64748b"],
          "fill-opacity": 0.45,
        },
      });
      map.addLayer({
        id: "farm-risk-line",
        type: "line",
        source: "farm-risk",
        paint: {
          "line-color": ["coalesce", ["get", "colour"], "#64748b"],
          "line-width": 2,
        },
      });

      const riskPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
      map.on("mouseenter", "farm-risk-fill", (e) => {
        const f = e.features?.[0];
        if (!f) return;
        map.getCanvas().style.cursor = "pointer";
        const p = f.properties as any;
        riskPopup
          .setLngLat((e as any).lngLat)
          .setHTML(
            `<div class="text-xs font-semibold text-ink font-mono">${p.farm_id}</div>` +
            `<div class="text-xs text-ink-soft">Risk: <span class="capitalize font-bold" style="color:${p.colour}">${p.risk_category}</span></div>` +
            (p.estimated_rainfall_mm != null ? `<div class="text-xs text-ink-soft">Est. Rain: ${Number(p.estimated_rainfall_mm).toFixed(1)} ± ${Number(p.uncertainty_mm ?? 0).toFixed(1)} mm/hr</div>` : "") +
            `<div class="text-xs text-ink-faint italic">Simulated GP estimate</div>`
          )
          .addTo(map);
      });
      map.on("mouseleave", "farm-risk-fill", () => {
        map.getCanvas().style.cursor = "";
        riskPopup.remove();
      });

      map.on("click", "farm-risk-fill", (e) => {
        const f = e.features?.[0];
        const farmId = f?.properties?.farm_id as string | undefined;
        if (farmId && onFarmRiskClick) onFarmRiskClick(farmId);
      });
    }

    const src = map.getSource("farm-risk") as GeoJSONSource | undefined;
    if (src) {
      const data: GeoJSON.FeatureCollection = riskGeojson ?? { type: "FeatureCollection", features: [] };
      src.setData(data as any);
    }
  }, [riskGeojson, mapReady]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Farm detail helpers ───────────────────────────────────────────────────

  const openFarmDetail = useCallback((farmId: string | number) => {
    setDetailLoading(true);
    setSelectedFarm(null);
    setSelectedImage(farmImages.current[String(farmId)] ?? null);
    getFarmDetail(farmId)
      .then(setSelectedFarm)
      .catch(console.error)
      .finally(() => setDetailLoading(false));
  }, []);

  function handleFarmSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchError(null);
    const id = parseInt(searchId, 10);
    if (!id || isNaN(id)) { setSearchError("Enter a valid numeric Farm ID."); return; }
    const map = mapRef.current;
    const farms = map?.getSource("farms") as GeoJSONSource | undefined;
    // Pan to the farm on the map if it's in the loaded layer
    const data = (farms as any)?._data as FeatureCollection | undefined;
    const feat = data?.features?.find(f => f.properties?.farm_id === id);
    if (feat && map) {
      // Calculate centroid of the polygon to fly to
      const coords = (feat.geometry as any).coordinates?.[0] as [number, number][] | undefined;
      if (coords?.length) {
        const lng = coords.reduce((s, c) => s + c[0], 0) / coords.length;
        const lat = coords.reduce((s, c) => s + c[1], 0) / coords.length;
        map.flyTo({ center: [lng, lat], zoom: 15, speed: 1.2 });
      }
    } else if (!feat) {
      setSearchError("Farm ID not found on this map.");
      return;
    }
    openFarmDetail(id);
  }

  // ── Layer toggle ──────────────────────────────────────────────────────────

  function toggleLayer(key: keyof LayerVisibility) {
    setLayers(prev => ({ ...prev, [key]: !prev[key] }));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full" style={{ height }}>
      {/* Map container */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Satellite imagery note */}
      <div className="absolute top-2 left-2 z-10 bg-ink/40 text-xs text-ink-soft px-2 py-1 rounded pointer-events-none">
        Basemap: ESRI World Imagery — imagery may be several weeks old. Coloured overlays are simulated.
      </div>

      {/* 2D / 3D toggle */}
      <button
        onClick={() => setIs3D(v => !v)}
        className={`absolute bottom-8 right-24 z-10 text-xs font-semibold px-3 py-1.5 rounded-lg shadow border transition ${
          is3D ? "bg-accent text-white border-accent" : "bg-surface/90 text-white border-line-strong hover:bg-sunken"
        }`}
      >
        {is3D ? "3D ✓" : "3D View"}
      </button>

      {/* Layer controls */}
      <LayerControls layers={layers} onToggle={toggleLayer} />

      {/* Farm ID search */}
      <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1">
        <form onSubmit={handleFarmSearch} className="flex gap-1.5">
          <input
            className="bg-surface/90 border border-line-strong rounded-xl px-3 py-1.5 text-ink text-sm placeholder-gray-500 focus:outline-none focus:border-accent w-36"
            placeholder="Farm ID…"
            value={searchId}
            onChange={e => { setSearchId(e.target.value); setSearchError(null); }}
          />
          <button
            type="submit"
            className="bg-accent text-white text-xs font-semibold px-3 py-1.5 rounded-full hover:opacity-90 transition"
          >
            Go
          </button>
        </form>
        {searchError && (
          <span className="bg-red-50 text-red-700 text-xs px-2 py-1 rounded">{searchError}</span>
        )}
      </div>

      {/* Legend */}
      <MapLegend />

      {/* Farm detail panel */}
      {(detailLoading || selectedFarm) && (
        <FarmDetailPanel
          farm={selectedFarm}
          imageUrl={selectedImage}
          loading={detailLoading}
          onClose={() => setSelectedFarm(null)}
        />
      )}
    </div>
  );
}

// ─── Layer controls ──────────────────────────────────────────────────────────

interface LayerControlsProps {
  layers: LayerVisibility;
  onToggle: (key: keyof LayerVisibility) => void;
}

const LAYER_LABELS: { key: keyof LayerVisibility; label: string; colour: string }[] = [
  { key: "farms",            label: "Farm boundaries",        colour: "bg-accent" },
  { key: "district",         label: "District boundary",      colour: "bg-accent" },
  { key: "sensors_rainfall", label: "Rainfall gauges",        colour: "bg-purple-400" },
  { key: "sensors_water",    label: "Water-level gauges",     colour: "bg-sky-400" },
  { key: "water",            label: "Rivers & water bodies",  colour: "bg-accent" },
  { key: "rainfall_overlay", label: "Rainfall intensity (sim)", colour: "bg-indigo-400" },
  { key: "flood_overlay",    label: "Flood area (sim)",        colour: "bg-red-500" },
  { key: "sensor_trust",     label: "Sensor trust",  colour: "bg-emerald-400" },
  { key: "risk_overlay",     label: "Farm risk",     colour: "bg-amber-400" },
];

function LayerControls({ layers, onToggle }: LayerControlsProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute bottom-8 right-2 z-10">
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-surface/90 border border-line-strong text-ink text-xs font-semibold px-3 py-1.5 rounded-xl shadow hover:bg-sunken transition"
      >
        Layers {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-1 bg-surface/95 border border-line-strong rounded-2xl p-3 space-y-2 w-52 shadow-xl">
          <p className="text-xs text-ink-muted font-semibold uppercase tracking-wide mb-1">Map Layers</p>
          {LAYER_LABELS.map(({ key, label, colour }) => (
            <label key={key} className="flex items-center gap-2 cursor-pointer group">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => onToggle(key)}
                className="sr-only"
              />
              <span className={`w-3 h-3 rounded-sm flex-shrink-0 ${layers[key] ? colour : "bg-sunken"} transition`} />
              <span className={`text-xs ${layers[key] ? "text-ink" : "text-ink-faint"} transition`}>{label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Map legend ──────────────────────────────────────────────────────────────

function MapLegend() {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute bottom-8 left-2 z-10">
      <button
        onClick={() => setOpen(o => !o)}
        className="bg-surface/90 border border-line-strong text-ink text-xs font-semibold px-3 py-1.5 rounded-xl shadow hover:bg-sunken transition"
      >
        Legend {open ? "▲" : "▼"}
      </button>
      {open && (
        <div className="mt-1 bg-surface/95 border border-line-strong rounded-2xl p-3 space-y-1.5 w-52 shadow-xl">
          <p className="text-xs text-ink-muted font-semibold uppercase tracking-wide mb-1">Legend</p>
          <LegendItem colour="bg-green-500/40 border-green-500" label="Active policy farm" />
          <LegendItem colour="bg-gray-500/40 border-line-strong" label="No active policy" />
          <LegendItem colour="bg-blue-500/20 border-blue-500 border-dashed" label="Demo district boundary (simulated)" />
          <LegendItem colour="bg-purple-400 rounded-full w-3 h-3" label="Rainfall gauge (simulated)" dot />
          <LegendItem colour="bg-sky-400 rounded-full w-3 h-3" label="Water-level gauge (simulated)" dot />
          <LegendItem colour="bg-accent/40 border-accent" label="River / water body (simulated)" />
          <LegendItem colour="bg-indigo-400/40 border-indigo-400" label="Rainfall intensity overlay (simulated)" />
          <LegendItem colour="bg-red-500/40 border-red-500 border-dashed" label="Flood-affected area (simulated)" />
          <LegendItem colour="bg-emerald-400 rounded-full w-3 h-3" label="Trusted sensor (green = high trust)" dot />
          <LegendItem colour="bg-red-500 rounded-full w-3 h-3 border-2 border-red-400" label="Flagged sensor — investigate" dot />
          <p className="text-xs text-ink-faint italic pt-1 border-t border-line-strong mt-1">
            Coloured overlays are simulated demo data, not verified geographic information.
          </p>
        </div>
      )}
    </div>
  );
}

function LegendItem({ colour, label, dot }: { colour: string; label: string; dot?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      {dot
        ? <span className={`${colour} flex-shrink-0`} />
        : <span className={`w-4 h-3 border flex-shrink-0 ${colour}`} />
      }
      <span className="text-xs text-ink-soft">{label}</span>
    </div>
  );
}

// ─── Farm detail panel ───────────────────────────────────────────────────────

interface FarmDetailPanelProps {
  farm: FarmMapDetail | null;
  loading: boolean;
  imageUrl?: string | null;
  onClose: () => void;
}

function FarmDetailPanel({ farm, loading, onClose, imageUrl }: FarmDetailPanelProps) {
  return (
    <div className="absolute top-12 right-2 z-20 w-72 bg-surface/95 border border-line-strong rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line-strong bg-sunken/60">
        <span className="text-sm font-semibold text-ink">
          {loading ? "Loading farm…" : (farm?.name ?? "Farm Details")}
        </span>
        <button onClick={onClose} className="text-ink-muted hover:text-ink transition text-lg leading-none">×</button>
      </div>

      {loading && (
        <div className="p-6 text-center text-ink-muted text-sm">Loading…</div>
      )}

      {!loading && farm && (
        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto text-sm">
          {imageUrl && (
            <img src={imageUrl} alt="Farmer-traced boundary" className="w-full rounded-lg border border-line-strong" />
          )}
          {/* Identity */}
          <Row label="Farm ID" value={`#${farm.farm_id}`} />
          <Row label="Farmer" value={farm.farmer_label} />
          {farm.district && <Row label="District" value={`${farm.district}${farm.state ? `, ${farm.state}` : ""}`} />}
          {farm.area_hectares && <Row label="Area" value={`${farm.area_hectares} ha`} />}
          {farm.primary_crop && (
            <Row label="Primary crop" value={
              <span className="capitalize">{farm.primary_crop}
                {farm.crops[0]?.season ? ` (${farm.crops[0].season})` : ""}
              </span>
            } />
          )}

          {/* Policy */}
          <div className="border-t border-line-strong pt-2">
            <Row label="Policy" value={
              farm.policy
                ? <span className="font-mono text-xs">{farm.policy.policy_number}</span>
                : <span className="text-ink-faint">None</span>
            } />
            <Row label="Status" value={
              <PolicyStatusBadge status={farm.policy_status} />
            } />
            {farm.sum_insured && (
              <Row label="Sum insured" value={`₹${farm.sum_insured.toLocaleString("en-IN")}`} />
            )}
            {farm.policy && (
              <Row label="Coverage" value={
                <span className="text-xs">{farm.policy.coverage_start} → {farm.policy.coverage_end}</span>
              } />
            )}
          </div>

          {/* Risk assessment */}
          <div className="border-t border-line-strong pt-2 space-y-1.5">
            {farm.estimated_rainfall_mm !== null && farm.estimated_rainfall_mm !== undefined ? (
              <Row
                label="Estimated rainfall"
                value={<span className="font-mono text-ink text-xs">{farm.estimated_rainfall_mm.toFixed(1)} mm/hr</span>}
              />
            ) : (null)}
            {farm.risk_category ? (
              <Row
                label="Risk category"
                value={<span className="capitalize font-semibold text-xs text-accent">{farm.risk_category}</span>}
              />
            ) : (null)}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-muted flex-shrink-0">{label}</span>
      <span className="text-ink text-right">{value}</span>
    </div>
  );
}

function PolicyStatusBadge({ status }: { status: string }) {
  const colour =
    status === "active"    ? "bg-green-50 text-green-700 border-green-200" :
    status === "expired"   ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
    status === "cancelled" ? "bg-red-50 text-red-700 border-red-200" :
                             "bg-sunken text-ink-muted border-line-strong";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border capitalize ${colour}`}>{status}</span>
  );
}
