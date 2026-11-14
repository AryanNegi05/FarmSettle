import { apiFetch } from "./client";

export type SensorStatus = "healthy" | "suspicious" | "faulty";
export type FaultType = "spike" | "stuck" | "dead" | "drift";

export interface CCSensor {
  id: string; type: "rainfall" | "water_level"; lat: number; lng: number; value: number; unit: string;
  status: SensorStatus; classification: string; confidence: number; trust: number; note: string;
  injected_fault: string | null;
}

export interface CCContributor { sensor_id: string; distance_m: number; reading: number; trust: number; weight: number }
export interface CCExcluded { sensor_id: string; distance_m: number; reading: number; trust: number; reason: string }

export interface CCFarm {
  farm_id: string; name: string; farmer_id: string | null; farmer_profile_id: string | null;
  farmer_label: string; crop: string | null; area_ha: number; ring: number[][]; centre: [number, number];
  circle_radius_m: number; circle: number[][]; image_url: string | null;
  estimated_rainfall: number | null; uncertainty: number | null; lower: number | null; upper: number | null;
  true_rainfall: number; adjust: number;
  risk: "low" | "moderate" | "high" | "extreme" | "insufficient_evidence"; flood_probability: number | null;
  policy: { id: string; number: string; status: string; sum_insured: number; trigger: number | null;
            full: number | null; payout_limit: number | null } | null;
  claim: { outcome: "PAY" | "ADVANCE" | "HOLD" | "NONE"; recommended_amount: number; entitlement: number;
           trigger_crossed: boolean; eligible: boolean; needs_investigation: boolean;
           requires_human_review: boolean; reasons: string[] } | null;
  sensor_confidence: number | null; contributors: CCContributor[]; excluded: CCExcluded[];
}

export interface CCSummary {
  farms: number; farms_without_policy: number; land_area_ha: number; occupied_ha: number; occupied_pct: number; affected_farms: number; eligible_claims: number; total_liability: number;
  avg_payout_per_affected: number; claims_needing_investigation: number;
  false_payouts_prevented_count: number; false_payouts_prevented_amount: number;
  naive_nearest_sensor_liability: number; flagged_sensors: number; suspicious_sensors: number;
  district_flood_score: number;
}

export interface CCStorm { peak_mm_hr: number; radius_m: number; lat: number; lng: number }

export interface CCLand { ring: number[][]; centre: [number, number]; width_m: number; height_m: number; bounds: [number, number, number, number] }

export interface CCResult {
  land: CCLand;
  controls: { district_mm_hr: number; storm: CCStorm | null; faults: Record<string, string>;
              sensor_overrides: Record<string, number>; farm_adjust: Record<string, number>; sensor_count: number; seed: number | null };
  sensors: CCSensor[]; farms: CCFarm[]; summary: CCSummary; notes: string[]; elapsed_ms: number;
}

export interface CCPreset {
  id: string; label: string; district_mm_hr: number; storm: CCStorm | null; faults: Record<string, string>;
}

export interface CCRequest {
  district_mm_hr: number; storm: CCStorm | null; faults: Record<string, string>;
  sensor_overrides: Record<string, number>; farm_adjust: Record<string, number>; sensor_count: number;
}

export interface CCSeriesPoint { t: number; estimated: number | null; truth: number | null; payout: number }
export interface CCSeries { farm_id: string; points: CCSeriesPoint[] }

export const getPresets = () => apiFetch<CCPreset[]>("/command/presets");
export const evaluateCommand = (b: CCRequest) =>
  apiFetch<CCResult>("/command/evaluate", { method: "POST", body: b });
export const getFarmSeries = (b: CCRequest & { farm_id: string; steps?: number }) =>
  apiFetch<CCSeries>("/command/farm-series", { method: "POST", body: b });

// ─── Sensor Forensics ────────────────────────────────────────────────────────
export type AnomalyType = "spike" | "stuck" | "drift" | "dead" | "neighbour_gap";
export interface ForensicsAnomaly { tick: number; end: number; type: AnomalyType; severity: "high" | "medium" | "low"; detail: string }
export interface ForensicsFeature {
  feature: string; label: string; unit: string; about: string; value: number; contribution: number; fixed_default: boolean;
}
export interface ForensicsExplanation {
  class: string; bias: number; features: ForensicsFeature[]; why: string; classes: string[];
  vs_normal: { class: string; bias: number; features: ForensicsFeature[] } | null;
}
export interface ForensicsNeighbour {
  id: string; distance_m: number; now: number; diff_now: number; mean_abs_diff_window: number; lead_correlation: number | null;
  class: string; trust: number; status: SensorStatus; series: number[];
}
export interface SensorForensics {
  sensor: { id: string; type: "rainfall" | "water_level"; lat: number; lng: number; value: number; unit: string; status: SensorStatus };
  simulated: boolean; notes: string[]; supported: boolean; message?: string;
  neighbours: (ForensicsNeighbour | { id: string; distance_m: number; value: number })[];
  classification?: {
    predicted_class: string; confidence: number; trust: number; class_probabilities: Record<string, number>;
    is_flagged: boolean; note: string; injected_fault: string | null; satellite_wet: boolean; storm_nearby: boolean;
    agreement: { state: "match" | "partial" | "missed" | "false_alarm" | "clear"; text: string };
  };
  trust_breakdown?: { class_base: number; confidence: number; trust: number; text: string };
  series?: { ticks: number[]; now_index: number; window_start: number; values: number[]; neighbour_median: number[] };
  anomalies?: ForensicsAnomaly[];
  timeline?: { tick: number; class: string; confidence: number }[];
  explanation?: ForensicsExplanation;
  farm_impact?: { farm_id: string; farm: string; role: "used" | "excluded"; weight: number; distance_m: number;
                  estimated_rainfall: number | null; outcome: string | null; amount: number | null }[];
}
export const getSensorForensics = (b: CCRequest & { sensor_id: string }) =>
  apiFetch<SensorForensics>("/command/sensor-forensics", { method: "POST", body: b });
