import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { CCFarm, CCRequest } from "../../../api/command";
import { Assessment, ClaimRequest, assessRequest, decideRequest, previewAssessment } from "../../../api/claimRequests";
import { inr } from "./layers";

const OUTCOME: Record<string, { label: string; cls: string }> = {
  PAY: { label: "Pay", cls: "bg-green-500/15 text-green-700 border-green-200" },
  ADVANCE: { label: "Partial advance", cls: "bg-amber-500/15 text-amber-700 border-amber-200" },
  HOLD: { label: "Hold for review", cls: "bg-orange-500/15 text-orange-700 border-orange-200" },
  NONE: { label: "No payout", cls: "bg-slate-500/15 text-ink-soft border-line-strong" },
};
const ACTION_WORD = { approve: "APPROVE", reject: "REJECT", hold: "put on HOLD" } as const;

interface Props {
  farm: CCFarm;
  /** The open claim request for this farm, if the farmer applied. Without one this is a read-only preview. */
  request: ClaimRequest | null;
  /** The rainfall scenario currently on screen (the insurer's simulation). */
  scenario: CCRequest;
  canDecide: boolean;
  onClose: () => void;
  onDecided: () => void;
}

/** Right-hand panel: AI + formula assessment of one farm under the current rainfall, and the insurer's decision. */
export default function AssessPanel({ farm, request, scenario, canDecide, onClose, onDecided }: Props) {
  const [a, setA] = useState<Assessment | null>(null);
  const [usedKey, setUsedKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [deciding, setDeciding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; claimId?: string } | null>(null);

  const key = useMemo(() => JSON.stringify(scenario), [scenario]);
  const stale = a !== null && usedKey !== key;
  const done = request !== null && (request.status === "approved" || request.status === "rejected");

  // Reset only when another farm is opened, so a decision message survives the request leaving the open queue.
  useEffect(() => { setA(null); setError(null); setMsg(null); setReason(""); }, [farm.farm_id]);

  async function run() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const r = request ? await assessRequest(request.id, scenario) : await previewAssessment(farm.farm_id, scenario);
      setA(r); setUsedKey(key);
      if (request) onDecided();                       // the request is now "assessed"
    } catch (e) { setError(e instanceof Error ? e.message : "Assessment failed"); }
    finally { setBusy(false); }
  }

  async function decide(action: "approve" | "reject" | "hold") {
    if (!request) return;
    if (reason.trim().length < 3) { setMsg({ ok: false, text: "Type a reason first (at least 3 characters)." }); return; }
    const amt = a?.claim?.recommended_amount ?? 0;
    if (!window.confirm(`${ACTION_WORD[action][0] + ACTION_WORD[action].slice(1).toLowerCase()} the claim request for ${farm.name}${action === "approve" ? ` (${inr(amt)})` : ""}?\n\nReason: ${reason.trim()}`)) return;
    setDeciding(true); setMsg(null);
    try {
      const r = await decideRequest(request.id, action, reason.trim());
      const claim = "claim" in r ? r.claim : null;
      setMsg({ ok: true, text: action === "hold" ? "Request put on hold. It stays in the queue." : `Claim ${claim?.status.toLowerCase() ?? action + "d"}.`, claimId: claim?.id });
      setReason(""); onDecided();
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Decision failed" }); }
    finally { setDeciding(false); }
  }

  const c = a?.claim ?? null;
  const o = c ? OUTCOME[c.outcome] : null;
  const p = farm.policy;
  const sev = p && p.sum_insured > 0 && c ? c.entitlement / p.sum_insured : null;

  return (
    <div className="flex flex-col rounded-2xl border border-line bg-surface shadow-card text-sm text-ink-soft overflow-hidden">
      <div className="flex items-start justify-between px-4 py-3 border-b border-line">
        <div>
          <p className="font-semibold text-ink">🤖 Claim assessment · {farm.name}</p>
          <p className="text-[11px] text-ink-muted">Rainfall + formula set the amount; the AI explains it; you decide.</p>
        </div>
        <button onClick={onClose} className="text-ink-muted hover:text-ink text-lg leading-none">×</button>
      </div>

      <div className="p-3 space-y-3 text-xs">
        {request ? (
          <div className="rounded-xl bg-sunken border border-line p-2.5 space-y-0.5">
            <p className="text-ink font-semibold">Farmer's claim request · {request.status.replace("_", " ")}</p>
            <p className="text-ink-muted">{new Date(request.created_at).toLocaleString()}</p>
            {request.note && <p className="text-ink-soft">“{request.note}”</p>}
            {request.decision_reason && <p className="text-ink-muted">Decision: “{request.decision_reason}”</p>}
          </div>
        ) : (
          <p className="rounded-xl bg-sunken border border-line p-2.5 text-ink-muted">No claim request from this farmer. This is a preview under the current rainfall; nothing is saved.</p>
        )}

        {!p && <p className="text-amber-700">This farm has no insurance policy, so no amount can be calculated.</p>}

        {p && !done && (
          <button onClick={run} disabled={busy}
            className="w-full text-sm font-semibold px-3 py-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50">
            {busy ? "Assessing…" : a ? "Re-assess with current rainfall" : "Assess with rainfall + formula + AI"}
          </button>
        )}
        {error && <p className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{error}</p>}
        {stale && <p className="text-amber-700">The rainfall changed since this assessment. Re-assess before deciding.</p>}

        {a?.problem && <p className="text-amber-700">{a.problem}</p>}

        {c && o && (
          <>
            <div className="rounded-xl border border-line p-3 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className={`px-2 py-0.5 rounded-full border text-[11px] ${o.cls}`}>{o.label}</span>
                <span className="text-xl font-bold text-ink">{inr(c.recommended_amount)}</span>
              </div>
              <p className="text-ink-muted">
                Rain at farm <b className="text-ink">{a?.estimated_rainfall} mm/hr</b>
                {a?.uncertainty != null && <> (±{a.uncertainty})</>} vs trigger {p?.trigger} · full payout {p?.full ?? "default"}
              </p>
              {sev !== null && p && (
                <p className="text-ink-muted">
                  Formula: {inr(p.sum_insured)} × {Math.round(sev * 100)}% severity = {inr(c.entitlement)}
                  {c.already_paid > 0 && <> · {inr(c.already_paid)} already committed</>}
                  {c.entitlement !== c.recommended_amount && <> → {inr(c.recommended_amount)} after uncertainty, trust and caps</>}.
                </p>
              )}
                          </div>

            {a?.cap_exhausted && (
              <div className="rounded-xl border border-amber-200 bg-amber-500/10 p-3 space-y-1">
                <p className="text-amber-800 font-semibold">Nothing left to pay on this policy</p>
                <p className="text-ink-muted">Its {inr(p?.sum_insured ?? 0)} cap is already used by earlier claims, so even a severe flood pays ₹0. This is the policy cap working, not a rainfall problem.</p>
                {a.evidence?.policy.earlier_claims.map((e, i) => <p key={i} className="text-ink-faint">• {e.status.toLowerCase()} {inr(e.amount)} · {e.date}</p>)}
              </div>
            )}

            {a?.ai && (
              <div className="rounded-xl border border-purple-200 bg-purple-500/5 p-3 space-y-1">
                <p className="text-purple-700 font-semibold">
                  AI explanation <span className="font-normal text-ink-faint">· {a.ai.source === "llm" ? `written by ${a.ai.model}` : a.llm?.configured ? "model unavailable, templated text" : "no LLM key, templated text"}</span>
                </p>
                <p className="text-ink-soft leading-snug">{a.ai.summary}</p>
                {a.ai.concerns.map((x, i) => <p key={i} className="text-amber-700">⚑ {x}</p>)}
                <p className="text-ink-faint">Suggested action: <b className="text-ink">{a.recommendation}</b>. The AI never sets the amount.</p>
              </div>
            )}

            {a?.evidence && (
              <div className="rounded-xl border border-line p-3 space-y-1.5">
                <p className="text-ink font-semibold">Sensor evidence · confidence {a.sensor_confidence == null ? "n/a" : `${Math.round(a.sensor_confidence * 100)}%`}</p>
                {a.evidence.sensors_used.map((s) => (
                  <div key={s.sensor_id} className="text-ink-muted">
                    <div className="flex justify-between"><span>{s.sensor_id} · {s.distance_m} m</span><span>trust {s.trust.toFixed(2)} · weight {Math.round(s.weight * 100)}%</span></div>
                    {s.recorded && <p className="text-ink-faint">recorded (mm/hr): {s.recorded.readings_mm_hr.join(" → ")} · peak {s.recorded.peak}</p>}
                  </div>
                ))}
                {a.evidence.sensors_excluded.map((s) => <p key={s.sensor_id} className="text-red-700">✕ {s.sensor_id} ({s.reading} mm/hr): {s.reason}</p>)}
              </div>
            )}
          </>
        )}

        {request && !done && a && c && canDecide && (
          <div className="rounded-xl border border-line p-3 space-y-2">
            <p className="text-ink font-semibold">Your decision</p>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
              className="w-full bg-sunken border border-line rounded-xl px-2.5 py-1.5 text-xs text-ink placeholder-gray-500" />
            <div className="grid grid-cols-3 gap-1.5">
              <button disabled={deciding || stale || c.recommended_amount <= 0} onClick={() => decide("approve")} className="text-xs font-semibold px-2 py-1.5 rounded-full bg-accent text-white disabled:opacity-40">Approve</button>
              <button disabled={deciding || stale} onClick={() => decide("reject")} className="text-xs font-semibold px-2 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-40">Reject</button>
              <button disabled={deciding} onClick={() => decide("hold")} className="text-xs font-semibold px-2 py-1.5 rounded-xl bg-sunken text-ink border border-line disabled:opacity-40">Hold</button>
            </div>
            <p className="text-[10px] text-ink-faint">Approve or reject creates the claim record now. Hold keeps the request open so you can re-assess later. Payment is simulated from Claims Review.</p>
          </div>
        )}
        {request && !canDecide && <p className="text-ink-faint">Read-only: only an insurer or admin can decide.</p>}
        {msg && (
          <p className={msg.ok ? "text-green-700" : "text-red-700"}>
            {msg.text} {msg.ok && msg.claimId && <Link to="/insurer/claims" className="underline text-accent">Open Claims Review →</Link>}
          </p>
        )}
      </div>
    </div>
  );
}
