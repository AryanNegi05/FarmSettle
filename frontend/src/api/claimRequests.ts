import { apiFetch } from "./client";
import type { CCRequest } from "./command";

export type RequestStatus = "pending" | "assessed" | "on_hold" | "approved" | "rejected";

export interface ClaimRequest {
  id: string; farm_id: string; farm_name: string; farmer_label?: string; policy_id: string; note: string | null;
  status: RequestStatus; created_at: string; claim_id: string | null; decision_reason: string | null; decided_at: string | null;
  assessment: { assessed_at: string; outcome: string; amount: number; estimated_rainfall_mm: number } | null;
}

export interface SensorWindow { readings_mm_hr: number[]; latest: number; peak: number; mean: number }

export interface Assessment {
  farm_id: string;
  problem: string | null;
  cap_exhausted?: boolean;
  recommendation: "approve" | "reject" | "hold";
  claim: { outcome: "PAY" | "ADVANCE" | "HOLD" | "NONE"; recommended_amount: number; entitlement: number; already_paid: number;
           trigger_crossed: boolean; eligible: boolean; reasons: string[] } | null;
  estimated_rainfall: number | null; uncertainty: number | null; sensor_confidence: number | null;
  ai: { summary: string; concerns: string[]; source: "llm" | "template"; model?: string } | null;
  llm?: { configured: boolean; model: string };
  evidence: {
    policy: { earlier_claims: { status: string; amount: number; date: string }[] };
    sensors_used: { sensor_id: string; distance_m: number; reading: number; trust: number; weight: number; recorded?: SensorWindow }[];
    sensors_excluded: { sensor_id: string; reading: number; reason: string }[];
  } | null;
}

// Farmer
export const applyForClaim = (b: { farm_id: string; note?: string }) =>
  apiFetch<ClaimRequest>("/my/claim-requests", { method: "POST", body: b });
export const getMyClaimRequests = () => apiFetch<ClaimRequest[]>("/my/claim-requests");

// Insurer
export const listClaimRequests = () => apiFetch<ClaimRequest[]>("/claim-requests");
export const assessRequest = (id: string, scenario: CCRequest) =>
  apiFetch<Assessment>(`/claim-requests/${encodeURIComponent(id)}/assess`, { method: "POST", body: scenario });
export const previewAssessment = (farmId: string, scenario: CCRequest) =>
  apiFetch<Assessment>("/claim-requests/preview", { method: "POST", body: { ...scenario, farm_id: farmId } });
export const decideRequest = (id: string, action: "approve" | "reject" | "hold", reason: string) =>
  apiFetch<ClaimRequest | { request: ClaimRequest; claim: { id: string; status: string; recommended_amount: number } }>(
    `/claim-requests/${encodeURIComponent(id)}/decide`, { method: "POST", body: { action, reason } });
