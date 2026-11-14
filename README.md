# ParaTrust

Agentic climate insurance intelligence & financial risk platform (B2B2C). All payments are **simulated**. Full plan: [docs/ROADMAP.md](docs/ROADMAP.md).

## Structure

```
backend/    FastAPI service (Firebase Auth + Firestore, Cloudinary for images)
  app/api         HTTP routes (auth, farmers, policies, geo, sensors, simulation, risk)
  app/core        config, Firebase auth, role dependencies
  app/schemas     Pydantic schemas
  app/services    firestore, cloudinary, geo, simulation, fault_detection (LightGBM),
                  risk (GP/Kriging), era5_loader
frontend/   React + TypeScript + Vite + MapLibre GL
  src/features    auth, farmer, insurer, auditor, map, simulation, sensors, risk
docs/       roadmap and per-stage notes (docs/stages/)
```

## Run

Credentials and first-time setup: see [SETUP.md](SETUP.md) and [GET_FIREBASE_KEY.md](GET_FIREBASE_KEY.md).
`backend/.env` (gitignored) must hold the Firebase service-account values and `CLOUDINARY_URL`.

**Backend** (from `backend/`):
```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --reload-dir app --port 8000
```
`--reload-dir app` matters: without it, installing packages into the venv triggers reload storms.

**Frontend** (from `frontend/`):
```bash
npm install && npm run dev
```

| URL | Purpose |
|-----|---------|
| http://localhost:5173 | Landing page |
| http://localhost:5173/login | Sign in |
| http://localhost:5173/register | Farmer registration |
| http://localhost:8000/docs | FastAPI interactive docs |

Roles: farmer, insurer, auditor, admin. Demo insurer/auditor/admin accounts are provisioned on first login (see `DEMO_ROLES` in `frontend/src/api/auth.ts`).

## Stages

| Stage | Name | Status |
|-------|------|--------|
| 1 | Website foundation & user login | ✅ Complete |
| 2 | Farmer & policy management | ✅ Complete |
| 3 | Satellite map & geographic monitoring | ✅ Complete |
| 4 | Weather & flood simulation | ✅ Complete |
| 5 | Sensor fault detection & trust scoring (LightGBM) | ✅ Complete |
| 6 | Farm-level risk assessment (GP/Kriging, ERA5) | ✅ Complete |
| 7 | Four AI agents (LangGraph) | ⬜ Not started |
| 8 | Claim calculation (deterministic engine, approvals) | ✅ Backend complete |
| 9 | Insurer claims review & simulated payments | 🟡 Core flow built (`/insurer/claims`) |
| 10–12 | Farmer tracking, audit, integration & demo | ⬜ Not started |
| 13 | Farm-level 3D monitoring & rainfall simulation | 🟡 First version built (`/insurer/command`) — [spec & status](docs/stages/13-farm-level-3d-monitoring.md) |

Stage notes: [docs/stages/](docs/stages/)

## What was added after Stage 6

**Farm registration with manual boundary tracing** (`/farmer/farms/new`)
- 2D satellite map opening on a bundled example farmland image (`frontend/public/example-farmland.jpg`, geo-referenced) so many field plots are always visible; live Esri tiles sit underneath and a place search (Nominatim) can move the map elsewhere.
- The farmer **manually** traces the boundary: Start Drawing → click corners → Finish Boundary, with undo, clear, redraw and draggable corners. Self-crossing or tiny/huge shapes are rejected.
- Area in hectares is computed from the traced polygon; a review step shows name, location, boundary and area before **Confirm & Save Farm**. The system never auto-detects farms or verifies ownership.

**Persistence**
- Saving stores, in Firestore `farms/{farm_id}`: `farm_id`, `farmer_id` (Firebase uid), `coordinates` (`{lat,lng}` points), `latitude/longitude`, `area_hectares`, `boundary_geojson`, and `image_url` (Cloudinary link; also kept as `map_image_url`).
- A snapshot of the traced map is uploaded to **Cloudinary through the backend** (`POST /api/farmers/farms/{id}/image`); the Cloudinary secret never reaches the browser. If the upload fails the farm is still saved.
- **My Farms** shows each saved farm with its picture and area, and an **Edit boundary** button (`/farmer/farms/:id/edit`, `PUT /api/farmers/farms/{id}`) that reloads the saved polygon for adjusting or redrawing and refreshes the picture.
- A farmer account now creates, at sign-up/login: `users/{uid}`, `farmer_profiles/{uid}` and `farmers/{uid}` (which also tracks `farm_ids`). The backend also auto-creates a missing profile on first farm save.

**Insurer side**
- The Operations Map opens in **3D** (terrain + extruded farm polygons, taller for active policies). Clicking a farm opens its detail panel with the farmer-traced picture.
- The farmer registry/detail pages use string farmer ids from the backend.

**Debugging aids**
- Saving logs each step with timings in the browser console (filter `farm-save`); the backend logs Cloudinary upload timing.

## Known setup notes
- **Firestore hang on some macOS/Python 3.14 setups:** gRPC's default DNS resolver can fail ("Could not contact DNS servers"). `app/__init__.py` sets `GRPC_DNS_RESOLVER=native` before gRPC loads; keep it.
- Firestore rules are currently fully open (development only) — lock them down before any real deployment.
- Registration happens in the browser (Firebase Auth + Firestore); the backend does not see it.

## Next phase
Stage 13 — farm-level 3D insurance monitoring, per-farm rainfall coverage circles, seeded random sensor network, interactive rainfall simulation and live payout updates. See [docs/stages/13-farm-level-3d-monitoring.md](docs/stages/13-farm-level-3d-monitoring.md).

Full plan: [docs/ROADMAP.md](docs/ROADMAP.md) · Stage notes: [docs/stages/](docs/stages/)
