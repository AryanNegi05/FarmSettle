# Stage 14: Basis Risk Monitor and Sensor Forensics Workbench

Status: built on top of the Command Centre simulation, ML, risk and claims. Weather and sensors are SIMULATED.

## Basis Risk Monitor (`/insurer/basis-risk`)
Farm-level indicators of where the rain index and policy trigger may not match what farmers experience.
**Indicators, not proof**: a flag never says crops were or were not damaged, or that a payout is wrong.

- Backend: `backend/app/services/basis_risk.py` (pure, tested), `backend/app/api/basis_risk.py`.
  `POST /api/basis-risk/assess` runs the Command Centre evaluation for the chosen scenario and assesses every farm.
- Inputs per farm: Gaussian-process rain estimate and uncertainty, policy trigger/full level and sum insured, the claim engine's
  outcome and amount, LightGBM-derived sensor trust, the farm risk category and flood probability, and the latest loss report.
- Under-compensation indicators: `UC_REPORTED_LOSS`, `UC_NEAR_MISS` (with the probability the trigger was really crossed),
  `UC_DAMAGE_PROXY`, `UC_DELAYED` (held or advance-only), `UC_NO_COVER`.
- Over-compensation indicators: `OC_REPORTED_LOW`, `OC_MARGINAL_TRIGGER`, `OC_LOW_TRUST` (below 75%; the engine itself holds below 60%),
  `OC_LOW_DAMAGE_PROXY`.
- Every flag has a level (low/moderate/high) and a basis: **reported** (compared with a recorded loss) or **model** (model signals only).
  Thresholds are explicit in `BasisConfig` and returned with the response.
- "Modelled damage potential" is a proxy (max of farm-risk score and flood probability), not an agronomic loss model.
- Loss reports (`loss_reports` collection): the insurer records a field observation (`POST /api/basis-risk/reports`); the farmer-side report was replaced by claim requests. They only feed the indicators; they
  never create, change or pay a claim.
- UI: scenario presets and rain slider (same simulation as the Command Centre), KPI row, payout-vs-loss scatter (solid = report-backed,
  hollow = model proxy), filters and sorting, a per-farm table (location, crop, rain vs trigger bar with uncertainty, coverage, payout,
  loss, indicators), and a detail panel with the payout curve, flags, and the loss-report form.

## Sensor Forensics Workbench (Command Centre, click any sensor)
- Backend: `backend/app/services/sensor_forensics.py`; `POST /api/command/sensor-forensics`.
- The headline class, confidence and trust equal what the map shows (tested). `command_centre.evaluate` was refactored into
  `make_field`, `sensor_context` and `_sensor_window` so both use the same pieces.
- History: the latest 6 readings are exactly those the map classified; the 24 before them are a simulated lead-up.
- LightGBM is run at every reading with the same features the live classifier uses, giving a class timeline.
- Neighbour comparison: nearest 4 gauges by distance (series, difference now, correlation, their class and trust).
- Rule-based anomaly markers (transparent, independent of the model): spike, stuck, drift, dead, neighbour discrepancy.
- Feature-level explanation: LightGBM's own per-feature contributions (SHAP-style, log-odds; additive, tested), toward the predicted
  class and toward "normal", with a plain-language sentence.
- Honest by design: the panel shows where the model and the simulation's injected fault disagree (a missed or mislabelled fault).
  Known model limitations it exposes: `tick_ratio` is fixed at 0.5 in live use (greyed out in the explanation), a stuck gauge can be
  missed by the model while the rules catch it, and a large spike can be labelled "drift".
- Farm links: which farms use or exclude the sensor, with their outcome and amount.

## Not done
- No real loss data or agronomic damage model; reports are manual.
- No crop-specific trigger or damage thresholds.
- Per-farm trigger recommendations (a suggested better trigger) are not generated.
