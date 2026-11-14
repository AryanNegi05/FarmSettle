# Stage 09: insurer-dashboard-payments

Status: 🟡 Core flow complete (calculate → approve → simulated payment → reconcile); dashboard KPIs partly covered

## Built
- `backend/app/services/payments.py` (**simulation only, no real payment rails**):
  - `validate_payable`: claim must be `APPROVED`, amount > 0, farmer must have a registered, verified bank account; already-PAID claims are rejected.
  - `build_payment_record`: simulated transaction (`SIM-…` reference, bank account shown masked only).
  - `reconcile` and `portfolio_stats`: cross-check claims vs payments, and dashboard counters.
- Duplicate-payment protection: payment document id = claim id (farm + event + policy), created with Firestore `create()`, so a second payment for the same settlement cannot exist. Calling pay again on a PAID claim returns the original payment.
- API (`backend/app/api/claims.py`): `POST /api/claims/{id}/pay`, `GET /api/claims/stats/summary`, `GET /api/claims/payments/all`, `GET /api/claims/reconciliation/report` (plus the Stage 8 endpoints). Paying goes APPROVED → PAYMENT_PENDING → PAID with history entries, only after the simulated transaction record exists.
- Frontend: `/insurer/claims` (`ClaimsPage.tsx`), reachable from the insurer dashboard:
  - KPI cards (awaiting approval, under investigation, approved unpaid, paid, approved exposure) and a reconciliation badge.
  - Claim cards with rainfall, trigger, sensor trust, recommended amount, reasons and history.
  - Approve / hold / investigate / reject with a required reason; "Send simulated payment" on approved claims.
  - "New claim calculation" form (policy, event id, rainfall, uncertainty, sensor trust) with Preview and Create (duplicates return the existing claim).
- Tests: `backend/tests/test_payments.py` (8) + `test_claims_engine.py` (16) pass.

## Verified
- Full flow run against the real Firestore with temporary records (since deleted): created claim → replay returned the original → pay before approval blocked → approve → pay → pay again did not create a second payment → approve after PAID blocked → reconciliation balanced.
- Frontend type-checks; the claims page renders (data screens not yet exercised with a real insurer login).

## Not done yet
- Claims are not created automatically from a simulation/risk run (the insurer enters rainfall by hand).
- Claim review page does not yet show the satellite map or the agent trace (agents are Stage 7).
- Farmer-facing notifications and tracking (Stage 10).
- Reconciliation and stats read all claims on each call (fine for a demo, needs pagination at scale).
