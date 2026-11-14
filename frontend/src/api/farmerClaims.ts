import { apiFetch } from "./client";

export interface ClaimStatusView {
  code: string; label: string; tone: "info" | "warn" | "good" | "bad"; next: string;
  tracker: string[]; step: number; stopped: boolean;
}

export interface FarmerClaimItem {
  id: string; farm_name: string | null; policy_number: string | null; amount: number; outcome: string;
  status: ClaimStatusView; created_at: string; rain_mm: number | null; trigger_mm: number | null;
  paid_at: string | null; simulated: boolean; disputed: boolean; supplementary: boolean;
}

/** `label`/`value`/`note` are English fallbacks; `key`/`vkey`/`note_key` + `vars` render in the farmer's language. */
export interface ExplainRow { label: string; value: string; key?: string; vkey?: string; vars?: Record<string, unknown> }
export interface ExplainSection { id: string; title: string; rows: ExplainRow[]; note: string; note_key?: string }

export interface DisputeItem {
  id: number; category: string; category_id: string; reason: string; status: "open" | "upheld" | "dismissed"; created_at: string;
  resolved_at: string | null; response: string | null;
  outcome: { additional_amount?: number; new_amount?: number; supplementary_claim_id?: string } | null;
}
export interface DisputeView {
  can_challenge: boolean; blocked_reason: string | null; blocked_code: "open" | "max" | "undecided" | null; categories: { id: string; label: string }[];
  items: DisputeItem[]; open: boolean; supplementary_of: string | null;
}

export interface FarmerClaimDetail {
  id: string; farm_name: string | null; policy_number: string | null; amount: number; outcome: string;
  status: ClaimStatusView; simulated: boolean; headline: string;
  gauge: { rain: number; rain_low: number; rain_high: number; trigger: number | null; full: number | null; severity: number };
  formula: string; sections: ExplainSection[]; checks: { id: string; label: string; ok: boolean }[]; reasons: string[];
  ai_summary: string | null;
  decision: { by_human: boolean; reason: string | null; at: string | null };
  timeline: { at: string; code: string; label: string; note: string | null }[];
  dispute: DisputeView;
  payment: { amount: number; reference: string; at: string; to: string | null; bank: string | null; simulated: boolean } | null;
  created_at: string;
  translations?: Record<string, string>; translation_lang?: string;
}

export const getMyClaims = () => apiFetch<FarmerClaimItem[]>("/my/claims");
export const getMyClaim = (id: string, lang = "en") =>
  apiFetch<FarmerClaimDetail>(`/my/claims/${encodeURIComponent(id)}?lang=${lang}`);
export const challengeClaim = (id: string, category: string, reason: string, lang = "en") =>
  apiFetch<FarmerClaimDetail>(`/my/claims/${encodeURIComponent(id)}/challenge?lang=${lang}`, { method: "POST", body: { category, reason } });
