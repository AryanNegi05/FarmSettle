# Stage 13: Farm-Level 3D Insurance Monitoring & Rainfall Simulation

Status: 🟡 First working version built (`/insurer/command`); several spec items still open (see "Built / not built")

Upgrade the existing ParaTrust map and insurer dashboard. **Do not rebuild the app or replace the backend.** Improve farm-level visualisation, sensor distribution, rainfall simulation and interactive insurance decision-making on top of what exists (MapLibre map, Stage 4 simulation, Stage 5 LightGBM trust scoring, Stage 6 GP/Kriging + ERA5 risk).

## 0. Design rule: 3D is the same farm as the 2D map

The 3D view must show **exactly the same farm as the 2D map**, only with depth added.

- Same basemap imagery as 2D (the Esri satellite layer and the bundled example farmland image), draped over terrain. No separate stylised or synthetic 3D farm models.
- Same farm polygons as 2D: the farmer-traced `boundary_geojson` / `coordinates` from Firestore, extruded; never regenerated or simplified for 3D.
- Same colours, layers, filters, search and selection behaviour. The 2D/3D toggle only changes pitch, terrain and extrusion; a farm selected in one mode stays selected in the other.
- Same data source (`/api/geo/farms` and the layers below) so nothing can drift between modes.
- Already in place: the 2D/3D toggle on the Operations Map with terrain and extruded farms. This stage builds on it rather than replacing it.

## 1. Core product experience

An insurer can:
- view every registered farmer and their farm;
- inspect each farm's exact boundary;
- see a circular rainfall coverage zone around each farm;
- monitor readings from randomly distributed IoT sensors;
- see how rainfall evidence changes each farm's risk;
- simulate rainfall and watch payouts update instantly;
- inspect a farmer's policy, risk estimate and potential claim amount.

The map becomes the main interface for turning environmental evidence into financial decisions.

## 2. Farmer and farm visualisation

Show, for each farm: farmer ID/name, farm ID, boundary polygon, crop, acreage, policy ID, rainfall trigger, estimated rainfall, flood probability, expected payout, claim status.

- Farms are elevated land parcels with subtle extrusion and shadow.
- Boundary colour by risk: green low, yellow moderate, orange high, red severe.
- Selecting a farm gives a glowing outline and a floating info panel (rainfall, risk, policy, payout).
- Keep the map uncluttered: detail only on select/hover.
- Farm population: the existing demo district farms **plus** farmer-registered farms from Firestore, merged into one GeoJSON layer. Real registered farms (traced boundaries) take priority over simulated squares.

## 3. Farm-specific rainfall coverage circles

One circle per farm:
- centred on the farm polygon's geographic centre;
- radius = distance to the farthest boundary point + a small configurable buffer (e.g. 10-15 %), so circles fit the farm instead of using a fixed radius;
- similar-sized farms get visually similar circles; avoid oversized circles;
- translucent fill and a subtle glowing border so the farm stays visible.

A circle is a rainfall **monitoring and evidence zone**. It must not imply rainfall is uniform inside it.

When an authorised user edits a farm boundary (already supported: `PUT /api/farmers/farms/{id}`):
1. update the polygon; 2. recompute centre; 3. recompute radius; 4. regenerate the circle; 5. update sensor associations; 6. recompute rainfall estimate and risk; 7. refresh policy and claim simulation.

Implementation notes: compute centre/radius server-side with `shapely` (already a dependency) in `services/geo.py`, return as a GeoJSON circle polygon in the farm feature properties or a dedicated `/api/geo/farm-zones` layer.

## 4. Random IoT sensor network

- Start from the existing 18 sensors; make the count adjustable.
- Positions generated randomly inside the district boundary with a **seeded** generator (reproducible), spread across areas rather than clustered.
- Per sensor: ID, lat/lng, type (rainfall or water level), current reading, health status, trust score, last-updated timestamp.

Visuals:
- rainfall gauge: small vertical 3D tower, mm/hr, cyan/blue when healthy;
- water-level gauge: blue marker with animated concentric rings;
- faulty: red pulsing; suspicious: amber; healthy: green/cyan.

Sensor-to-farm association uses distance, trust score, coverage-zone intersection and supporting weather evidence. A sensor inside a circle is not automatically reliable. The selected farm highlights its contributing sensors and readings, and lists sensors **excluded or down-weighted, with the reason**.

## 5. Interactive rainfall simulation

Insurer panel with sliders and presets:
- controls: district-wide intensity, localised storm intensity, storm location, storm radius, individual sensor readings, water-level readings, fault injection;
- presets: Normal, Moderate, Severe Flood, Localised Cloudburst, Faulty Rain Gauge, Broad District-Wide;
- play, pause, reset, timeline.

On every change, without a page reload: update rainfall field → sensor readings → trust scores → rainfall estimation → farm rainfall → flood probability → payouts → map colours/overlays → financial summary.

Build on the existing simulation engine and snapshot API (`/api/simulation`); extend rather than replace.

## 6. ML and spatial intelligence

- **LightGBM** (existing, Stage 5) classifies: healthy, abnormal spike, stuck, drift, dead, genuine localised event. A high reading is not automatically a fault: compare neighbours, temporal pattern and supporting weather evidence. Show predicted class and confidence.
- **Gaussian Process / Kriging** (existing, Stage 6) estimates rainfall at each farm location using sensor readings, trust, distance, ERA5 background and measurement uncertainty. Show estimate, uncertainty range, flood probability, contributing sensor count; show uncertainty visually. Never use just the nearest sensor.

## 7. Dynamic payout simulation

Every farm has a policy. When rainfall changes, a **deterministic Python claim engine** (never an LLM) recomputes payouts from the policy's configured parameters, e.g.:

```
severity = clip((rainfall - trigger_start) / (trigger_full - trigger_start), 0, 1)
payout   = insured_sum * severity
```

Per farm show: previous payout, updated payout, % change, trigger crossed, claim eligible, needs investigation, hold for human review.

Portfolio summary: affected farms, potentially eligible claims, total payout liability, average payout per affected farmer, claims needing investigation, potential false payouts prevented.

All amounts are simulations; no real transactions.

## 8. Insurer interaction

- Click a farm to select, smooth zoom, highlight polygon + circle + contributing sensors, floating panel; switch farms without reload.
- Search by farmer ID, farmer name, farm ID. Filters: crop, rainfall, risk, claim status.
- Panel fields come from real database/calculation outputs (no hardcoded examples): farmer, farm ID, crop, area, rainfall estimate, policy trigger, flood probability, estimated payout, sensor evidence count and confidence, claim recommendation.
- Decision controls: approve, reject, request investigation, hold. Consequential decisions need human confirmation.

## 9. Visual design

Dark satellite map, navy UI, cyan/blue rainfall, subtle elevation, glowing boundaries, translucent circles, animated sensors, smooth camera moves, glass panels, KPI cards. Avoid excess neon and clutter. Must stay readable and performant with 100 farms plus sensor layers on a normal laptop. Include 2D/3D toggle and layer controls.

## 10. Technical constraints

Keep: React + TypeScript, existing auth/RBAC, farmer/farm/policy data in Firestore, existing GeoJSON and 18 sensors, simulation engine, LightGBM, GP/Kriging, ERA5, and existing API contracts where possible. No mock data in place of working backend functionality. New APIs must be clean and documented. MapLibre GL JS is already the renderer, so no migration is needed. Simulation is seeded and reproducible.

## 11. Suggested build order

1. Unified farm layer (registered + demo farms) with risk colouring and the shared 2D/3D selection state.
2. Fitted coverage circles (shapely) + regeneration on boundary edit.
3. Seeded sensor network generator + sensor 3D/ring visuals.
4. Sensor-to-farm association with included/excluded reasons.
5. Simulation panel (sliders, presets, timeline) wired to the existing engine.
6. Claim engine endpoint + live payout and portfolio KPIs.
7. Farm panel, search/filters, decision controls.
8. Polish and performance pass.

## 12. Demo sequence

1. Insurer opens the district map and sees all farms.
2. Each farm has its fitted rainfall circle.
3. Randomly distributed rainfall and water-level sensors are visible.
4. Insurer selects a farm; it rises, glows, and its sensors highlight (same farm as in 2D).
5. Insurer raises rainfall with the slider; readings and estimates update.
6. LightGBM flags faulty/suspicious sensors.
7. Spatial estimation gives farm-level rainfall and uncertainty.
8. The policy engine recomputes payout; colour and payout update immediately.
9. Portfolio exposure changes; insurer investigates and makes a human-approved decision.

End-to-end chain: **Farm Geography → Rainfall Coverage → Sensor Evidence → ML Validation → Farm-Level Risk → Policy Trigger → Financial Payout → Insurer Decision.**

Prioritise a working, interactive demo over decorative 3D. Every visual element must carry real insurance or environmental meaning.


---

## Built / not built (current state)

### Design decision: one shared land
Every farmer registers on the same bundled farmland image, so the "district" the insurer monitors **is that land** (about 856 m x 850 m, 72.8 ha; geo-reference in `backend/app/services/land.py` and `frontend/src/features/map/exampleFarmland.ts`, which must stay in sync). The insurer map shows that same image, with no separate Esri district map and no scattered demo farms. Only farms farmers actually traced on the land appear, so the insurer sees which land is occupied and the rain's effect on each plot. Nothing is tied to a fixed place: sensors are spread (seeded) over the land; storm positions and sizes come from the land and the farms' own centroid; storm radius is in metres.

### Built
- **Page:** `/insurer/command` (`frontend/src/features/insurer/command/`). 2D/3D toggle on one map: same imagery, same traced polygons, same colours; 3D only tilts the camera and raises each plot by its own rainfall.
- **Backend:** `POST /api/command/evaluate`, `POST /api/command/farm-series`, `GET /api/command/presets`. Stateless and seeded (about 10-20 ms per evaluation once warm).
  - Pipeline: controls → rainfall field → sensor readings (+ injected faults) → LightGBM classification and trust → trust-weighted Gaussian Process estimate per farm (land-scaled coordinates) with uncertainty → deterministic claim engine per policy → portfolio summary.
  - Farms: registered farms on the land (traced boundary, farmer name, crop, real policy). Farms traced elsewhere are excluded. 30 s cache, cleared when a farm is created or edited.
- **Per-farmer views** (selected farm panel):
  - Rain effect on the plot: colour, opacity, 3D height and animated ripples all come from that farm's own estimate; rainfall gauge with uncertainty range against the policy trigger and full-payout level.
  - Payout curve of that farmer's own policy with a marker at the current estimate.
  - Local rain adjustment (-50 to +150 mm/hr) for this farm only, applied as a small local cell centred on it.
  - Rain-over-time chart for this farm across the storm life-cycle (estimate, actual, payout, trigger).
  - Basis risk: the simulated "actually falling here" rainfall is shown next to the sensors' estimate, so a local cell the gauges miss is visible.
  - Farms with no policy show "no policy" and a link to create one.
- **Coverage circles** (`app/services/zones.py`): centroid + farthest boundary point + 15 % margin, minimum 40 m; recomputed when a boundary is edited.
- **Sensors:** seeded and well spread across the land (Halton sequence with a seeded rotation; changing the count keeps earlier gauges where they are), colour by health, pulsing rings, towers in 3D, evidence lines to the selected farm's contributing sensors, and excluded/down-weighted sensors listed with reasons.
- **Simulation panel:** six presets resolved from the land and farms, district slider, localised storm (intensity, radius in metres, click-to-place), sensor count, fault injection, per-sensor override, play/pause/reset and the storm timeline.
- **Portfolio KPIs:** occupied land (ha and % of the patch), affected farms, eligible claims, payout liability with change vs previous, average per affected farm, claims needing investigation, false payouts prevented, faulty/suspicious sensors, flood score.
- **Insurer interaction:** click/hover a farm, search by farmer ID, name or farm ID, filters (crop, risk, claim outcome, minimum rainfall), layer toggles, "Send to Claims Review" (confirmation first; a person decides there).
- **Tests:** `test_command_centre.py` (19), `test_zones.py` (7), plus the claim and payment tests: 50 pass.

### Model fixes made on the way (Stage 5 LightGBM)
- Training series were labelled faulty for every tick even when the fault lasts one tick; labels now describe the tick.
- Training now includes heavy-rain series and "storm-edge" series (healthy gauges that legitimately disagree with neighbours near a storm). The "storm evidence" radius passed to the model is 3 sigma.
- Result: no false flags in calm, moderate, severe, broad or cloudburst scenarios; the faulty-gauge preset flags exactly the injected faults (an injected spike may be labelled "drift"). Training-set metrics only; older Stage 5 tests were not re-run.

### Not built yet / known gaps
- Only one real farm exists, and it has no policy, so real payouts show once farmers register more farms and the insurer creates policies. (Browser checks used recorded evaluator output with five extra test farms, not saved data.)
- At 856 m, rain is nearly uniform in reality; the localised storm is a demo of spatial variation and basis risk, not a physical model.
- Uncertainty is shown as a range bar and numbers, not a map band.
- Rainfall is compared with policy triggers in mm/hr (prototype assumption); ERA5 background rainfall is not fed into this evaluator; flood probability is an indicative blend, not a hydrological model.
- Each evaluation response is large (farm rings and circles); fine on localhost.
- Not exercised: the page with a real insurer login, the Claims Review hand-off from the farm panel, and sensor towers in 3D at close range.
