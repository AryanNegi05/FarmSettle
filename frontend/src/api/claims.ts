import { apiFetch } from "./client";

export interface ClaimCalculation {
  policy_id: string; farm_id: string; event_id: string; event_date: string;
  estimated_rainfall_mm: number; rainfall_sigma_mm: number; sensor_trust: number | null;
  sum_insured: number; trigger_start_mm: number | null; trigger_full_mm: number | null;
  eligible: boolean; outcome: "PAY" | "ADVANCE" | "HOLD" | "NONE";
  severity: number; entitlement: number; payable_amount: number; recommended_amount: number;
  cap_applied: boolean; trigger_crossed: boolean; requires_human_approval: boolean;
  needs_investigation: boolean; reasons: string[]; idempotency_key: string; engine_version: string;
}

export interface HistoryEntry { at: string; by: string; from: string | null; to: string; reason: string }

export interface Claim {
  id: string; policy_id: string; farm_id: string; farmer_profile_id?: string; event_id: string;
  status: string; outcome: string; recommended_amount: number; calculation: ClaimCalculation;
  decision_reason: string | null; history: HistoryEntry[]; created_at: string;
  transaction_ref?: string; paid_at?: string;
}

export interface Payment {
  id: string; claim_id: string; amount: number; currency: string; status: string;
  simulated: boolean; transaction_ref: string; created_at: string;
  destination: { bank_name?: string; account?: string; holder?: string };
}

export interface ClaimStats {
  total_claims: number; under_investigation: number; awaiting_approval: number; on_hold: number;
  approved: number; paid: number; rejected: number; amount_awaiting_approval: number;
  amount_approved_unpaid: number; amount_paid: number; approved_exposure: number;
}

export interface Reconciliation {
  paid_claims: number; payments: number; total_paid: number;
  total_paid_claims_amount: number; balanced: boolean; issues: string[];
}

export interface ClaimInput {
  policy_id: string; event_id: string; event_date?: string; estimated_rainfall_mm: number;
  rainfall_sigma_mm?: number; sensor_trust?: number; water_level?: number; dry_run: boolean;
}

export const calculateClaim = (b: ClaimInput) =>
  apiFetch<{ calculation: ClaimCalculation; claim: Claim | null; created: boolean }>(
    "/claims/calculate", { method: "POST", body: b });
export const listClaims = (status?: string) =>
  apiFetch<Claim[]>(`/claims${status ? `?status=${status}` : ""}`);
export const getClaimStats = () => apiFetch<ClaimStats>("/claims/stats/summary");
export const getReconciliation = () => apiFetch<Reconciliation>("/claims/reconciliation/report");
export const decideClaim = (id: string, action: "approve" | "hold" | "reject" | "investigate", reason: string) =>
  apiFetch<Claim>(`/claims/${id}/decision`, { method: "POST", body: { action, reason } });
export const payClaim = (id: string) =>
  apiFetch<{ claim: Claim; payment: Payment; created: boolean }>(`/claims/${id}/pay`, { method: "POST" });
export const getClaim = (id: string) => apiFetch<Claim>(`/claims/${id}`);
