import { apiFetch } from "./client";
import type { CCRequest } from "./command";

export type Level = "none" | "low" | "moderate" | "high";
export type Verdict = "under_risk" | "over_risk" | "mixed" | "aligned" | "no_cover" | "uninsured" | "insufficient";

export interface BasisFlag {
  id: string; direction: "under" | "over"; level: Exclude<Level, "none">; basis: "reported" | "model"; title: string; text: string;
}

export interface BasisAssessment {
  farm_id: string; name: string; farmer: string | null; crop: string | null; area_ha: number | null; centre: [number, number] | null;
  policy: { id: string; number: string; sum_insured: number; trigger: number | null; full: number | null; payout_limit: number | null } | null;
  rain: { estimate: number | null; sigma: number; lower: number | null; upper: number | null; sensor_confidence: number | null };
  trigger: { threshold: number | null; full: number | null; margin_pct: number | null; p_cross: number | null; crossed: boolean };
  payout: { outcome: string | null; amount: number; ratio: number; entitlement_ratio: number };
  loss: { report_id: string; pct: number; source: string; cause: string; observed_on: string; note: string; n_reports: number } | null;
  damage_proxy: number | null; risk: string | null; flood_probability: number | null;
  flags: BasisFlag[]; under: { level: Level; basis: "reported" | "model" | null }; over: { level: Level; basis: "reported" | "model" | null };
  verdict: Verdict; evidence: "reported" | "model_only"; priority: number;
}

export interface BasisSummary {
  farms: number; insured: number; uninsured: number; under_flagged: number; over_flagged: number; aligned: number;
  exposure_under: number; payout_over: number; farms_with_reports: number; report_backed_flags: number;
  mean_payout_minus_loss: number | null; mean_abs_gap: number | null;
}

export interface BasisResult {
  assessments: BasisAssessment[]; summary: BasisSummary; notes: string[];
  config: Record<string, number>; controls: CCRequest & Record<string, unknown>;
}

export interface LossReport {
  id: string; farm_id: string; loss_pct: number; cause: string; observed_on: string; note: string; source: string; created_at: string;
}

export const assessBasisRisk = (b: CCRequest) => apiFetch<BasisResult>("/basis-risk/assess", { method: "POST", body: b });
export const listLossReports = (farmId: string) => apiFetch<LossReport[]>(`/basis-risk/reports?farm_id=${encodeURIComponent(farmId)}`);
export const addLossReport = (b: { farm_id: string; loss_pct: number; cause: string; observed_on?: string; note?: string }) =>
  apiFetch<LossReport>("/basis-risk/reports", { method: "POST", body: b });

