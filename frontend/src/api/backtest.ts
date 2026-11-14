import { apiFetch } from "./client";

export interface Phase {
  name: string; start: string; end: string; strike1: number; strike2: number; exit: number;
  notional1: number; notional2: number; limit: number;
}
export interface PhaseResult extends Phase {
  observed_mm: number | null; window_start: string | null; window_end: string | null;
  payout_per_ha: number; partial_data: boolean;
}
export interface PortfolioRow {
  district: string; peak_two_day_mm: number; payout_per_ha: number; payout: number;
  outcome: "PAY" | "NONE"; phases_paid: number; peak_7day_mm: number; flags: string[];
}
export interface BasisRisk {
  flags: string[]; peak_7day_mm: number;
  near_misses: { phase: string; observed_mm: number; strike1: number; pct_of_strike1: number }[];
  payout_per_ha_by_window_days: Record<string, number>;
}
export interface PortfolioReport {
  scheme: string; source: string; hectares: number; phases: Phase[]; districts: number;
  districts_paid: number; total_insured: number; total_payout: number; data_note: string;
  basis_risk_summary: { near_miss: number; heavy_week_low_payout: number; note: string };
  results: PortfolioRow[];
}
export interface DistrictDetail {
  district: string; scheme: string; source: string; hectares: number;
  daily: { date: string; mm: number }[]; two_day: { start: string; end: string; mm: number }[];
  basis_risk: BasisRisk; phases: PhaseResult[]; payout_per_ha: number; payout: number; peak_two_day_mm: number;
}
export interface SchemeExample {
  scheme: string;
  terms: { strike1: number; strike2: number; exit: number; notional1: number; notional2: number; limit: number };
  cases: { rua: string; hectares: number; observed: number; published_per_ha: number; published_total: number;
    engine_per_ha: number; engine_total: number; matches: boolean }[];
}

export const getPortfolio = (hectares: number) => apiFetch<PortfolioReport>(`/backtest/portfolio?hectares=${hectares}`);
export const getDistrictReplay = (district: string, hectares: number) =>
  apiFetch<DistrictDetail>(`/backtest/districts/${encodeURIComponent(district)}?hectares=${hectares}`);
export const getSchemeExample = () => apiFetch<SchemeExample>("/backtest/scheme-example");
