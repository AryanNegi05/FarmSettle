# Stage 08: claim-calculation

Status: 🟡 Backend complete, insurer approval screen not built yet

## Built
- `backend/app/services/claims.py`: pure deterministic engine (no DB, no network, no LLM), `ENGINE_VERSION = "claims-1.0"`.
  - Graduated entitlement: `severity = clip((rain - trigger_start) / (trigger_full - trigger_start), 0, 1)`, `entitlement = sum_insured × severity`. Policy fields used: `rainfall_trigger_mm`, `rainfall_max_payout_mm` (defaults to 1.5 × trigger if missing/invalid), `payout_limit`, `sum_insured`, coverage dates, status.
  - Caps: sum insured, payout limit and amounts already approved/paid on the policy. A capped claim is flagged.
  - Confidence-aware outcomes (`ClaimConfig`, all thresholds explicit): `PAY` (trigger crossed even at the 80 % lower bound, sensor trust ≥ 0.6), `ADVANCE` (crossing uncertain: bounded 50 % advance, needs investigation), `HOLD` (low trust or inconclusive), `NONE`. Uncertainty never increases the payout.
  - Inputs and engine version are stored with every claim, so a decision can be replayed.
  - Flood level is reported as informational only; it does not add to the rainfall payout.
- Idempotency: claim id = `farm_id__event_id__policy_id`, created with Firestore `create()`, so a replay returns the existing claim and can never create a second one.
- Status machine: CREATED → UNDER_INVESTIGATION → RECOMMENDED → AWAITING_APPROVAL → APPROVED → PAYMENT_PENDING → PAID (+ ON_HOLD, REJECTED, DISPUTED) with enforced transitions; a PAID claim cannot be approved again.
- API (`backend/app/api/claims.py`), insurer/admin to calculate and decide, auditor read-only:
  - `POST /api/claims/calculate` (`dry_run` defaults to true; set false to record the claim)
  - `GET /api/claims`, `GET /api/claims/{id}`
  - `POST /api/claims/{id}/decision` with `approve | hold | reject | investigate` and a required reason; history is appended to the claim.
- Tests: `backend/tests/test_claims_engine.py` (16 passing): graduated payout, caps, prior payments, uncertainty, low trust, eligibility, determinism, idempotency key, status machine.

## Verified
- Engine unit tests pass.
- Idempotent creation verified against the real Firestore (second create did not overwrite; test document removed).

## Not done yet
- Insurer claim-review/approval UI (Stage 9).
- No claim is created automatically from a simulation run or risk assessment yet; callers pass rainfall, uncertainty and sensor trust to `/calculate`.
- Endpoint tests with an authenticated insurer (needs a test login).
- Policy `payout_limit`/cumulative checks assume claims store `recommended_amount`.

See ../ROADMAP.md for the full stage definition.
