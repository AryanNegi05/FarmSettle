import { apiFetch } from "./client";
import type { CCRequest } from "./command";

export interface AgentTraceStep {
  n: number; at: string; agent: string; kind: "tool" | "handoff" | "llm" | "note" | "error";
  name: string; detail: string; ms: number | null;
}
export interface AgentSummary { name: string; summary: string; concerns: string[]; source: "llm" | "fallback" | "error" }
export interface AgentFarmCheck {
  farm_id: string; farm: string; policy_id: string; outcome: "PAY" | "ADVANCE" | "HOLD" | "NONE"; amount: number;
  status: "ready_for_approval" | "needs_investigation" | "blocked" | "no_action";
  checks: Record<string, boolean>; flags: string[];
}
export interface AgentRecommendation {
  farm_id: string; farm: string; farmer: string; policy_number: string; outcome: string; amount: number;
  evidence: "verified" | "uncertain" | "insufficient"; explanation: string;
}
export interface AgentRun {
  id: string; created_at: string; event_id: string; saved?: boolean;
  approval_status: "awaiting_human" | "blocked" | "no_claims";
  agents: AgentSummary[]; trace: AgentTraceStep[]; errors: string[];
  recommendations: AgentRecommendation[];
  compliance: { farms: AgentFarmCheck[]; total_amount: number; needs_human: number; budget: number };
  llm: { configured: boolean; model: string; used: boolean };
  elapsed_ms: number; queued_claim_ids: string[];
}
export interface QueuedClaim { claim_id: string; farm: string; created: boolean; status: string; amount: number }

export const runAgents = (b: CCRequest) => apiFetch<AgentRun>("/agents/run", { method: "POST", body: b });
export const queueAgentClaims = (runId: string) =>
  apiFetch<{ queued: QueuedClaim[] }>(`/agents/runs/${runId}/queue-claims`, { method: "POST" });
