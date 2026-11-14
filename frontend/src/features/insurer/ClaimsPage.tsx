/**
 * Claims review (Stage 9): see claim recommendations from the deterministic claim
 * engine, approve / hold / reject them with a reason, and run the SIMULATED payment.
 * No real money moves anywhere in this screen.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { listPolicies, PolicyOut } from "../../api/stage2";
import {
  Claim, ClaimCalculation, ClaimStats, Reconciliation,
  calculateClaim, decideClaim, getClaimStats, getReconciliation, listClaims, payClaim, resolveDispute,
} from "../../api/claims";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const STATUS_STYLE: Record<string, string> = {
  AWAITING_APPROVAL: "bg-amber-900/40 text-amber-300 border-amber-700",
  UNDER_INVESTIGATION: "bg-orange-900/40 text-orange-300 border-orange-700",
  APPROVED: "bg-blue-900/40 text-blue-300 border-blue-700",
  PAID: "bg-green-900/40 text-green-300 border-green-700",
  ON_HOLD: "bg-gray-700/60 text-gray-300 border-gray-500",
  REJECTED: "bg-red-900/40 text-red-300 border-red-700",
  DISPUTED: "bg-purple-900/40 text-purple-300 border-purple-700",
};

const FILTERS = ["ALL", "AWAITING_APPROVAL", "UNDER_INVESTIGATION", "DISPUTED", "APPROVED", "PAID", "ON_HOLD", "REJECTED"];

export default function ClaimsPage() {
  const { user } = useAuth();
  const canDecide = user?.role === "insurer" || user?.role === "admin";

  const [claims, setClaims] = useState<Claim[]>([]);
  const [stats, setStats] = useState<ClaimStats | null>(null);
  const [recon, setRecon] = useState<Reconciliation | null>(null);
  const [filter, setFilter] = useState("ALL");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const [c, s, r] = await Promise.all([listClaims(), getClaimStats(), getReconciliation()]);
      setClaims(c); setStats(s); setRecon(r); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load claims");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const shown = filter === "ALL" ? claims : claims.filter((c) => c.status === filter);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link to="/insurer" className="text-sm text-brand-blue hover:underline">← Dashboard</Link>
          <h1 className="text-2xl font-bold text-white mt-1">Claims Review</h1>
          <p className="text-sm text-gray-400">
            Recommendations come from the deterministic claim engine. A person approves; payments are simulated.
          </p>
        </div>
        {recon && (
          <span className={`text-xs px-3 py-1 rounded-full border ${recon.balanced
            ? "bg-green-900/40 text-green-300 border-green-700" : "bg-red-900/40 text-red-300 border-red-700"}`}
            title={recon.issues.join("\n")}>
            {recon.balanced ? "✓ Payments reconcile" : `⚠ ${recon.issues.length} reconciliation issue(s)`}
          </span>
        )}
      </div>

      {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {notice && <div className="bg-green-900/30 border border-green-700 text-green-200 rounded-lg px-4 py-3 text-sm">{notice}</div>}

      {stats && <StatCards s={stats} />}

      {canDecide && <NewClaimPanel onCreated={(m) => { setNotice(m); refresh(); }} onError={setError} />}

      <div className="flex gap-2 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-3 py-1 rounded-full border transition ${filter === f
              ? "bg-brand-blue text-white border-brand-blue" : "border-navy-600 text-gray-400 hover:text-white"}`}>
            {f === "ALL" ? "All" : f.replace(/_/g, " ").toLowerCase()}
          </button>
        ))}
      </div>

      {loading && <p className="text-gray-400">Loading claims…</p>}
      {!loading && shown.length === 0 && (
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-8 text-center text-gray-400 text-sm">
          No claims here yet. Use “New claim calculation” above to create one.
        </div>
      )}
      <div className="space-y-3">
        {shown.map((c) => (
          <ClaimCard key={c.id} claim={c} canDecide={canDecide}
            onChanged={(m) => { setNotice(m); setError(null); refresh(); }} onError={setError} />
        ))}
      </div>
    </div>
  );
}

function DisputePanel({ claim, canDecide, onChanged, onError }: {
  claim: Claim; canDecide: boolean; onChanged: (m: string) => void; onError: (m: string) => void;
}) {
  const d = (claim.disputes ?? []).find((x) => x.status === "open");
  const wasPaid = claim.pre_dispute_status === "PAID";
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  if (!d) return null;

  async function answer(outcome: "uphold" | "dismiss") {
    if (note.trim().length < 3) { onError("Please type your answer to the farmer (at least 3 characters)."); return; }
    setBusy(true);
    try {
      const r = await resolveDispute(claim.id, { outcome, note: note.trim(), amount: amount === "" ? undefined : Number(amount) });
      onChanged(outcome === "dismiss" ? "Challenge dismissed; the earlier decision stands."
        : r.supplementary_claim ? `Challenge upheld: ${inr(r.supplementary_claim.recommended_amount)} queued as an additional claim for approval.`
        : "Challenge upheld: the claim is back in the approval queue.");
      setNote(""); setAmount("");
    } catch (e) { onError(e instanceof Error ? e.message : "Could not resolve the challenge"); }
    finally { setBusy(false); }
  }

  return (
    <div className="rounded-lg border border-purple-700 bg-purple-900/20 p-3 space-y-2">
      <p className="text-sm text-purple-200 font-semibold">Farmer challenge #{d.id}: {d.category.replace(/_/g, " ")}</p>
      <p className="text-sm text-gray-200">“{d.reason}”</p>
      <p className="text-[11px] text-gray-400">Claim was <b>{(claim.pre_dispute_status ?? "").toLowerCase()}</b> before the challenge. {wasPaid ? "Upholding queues an additional payment as a separate claim; the original payment is never repeated." : "Upholding sends it back to the approval queue for a new decision."}</p>
      {canDecide && (
        <div className="flex gap-2 flex-wrap items-center">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your answer to the farmer (required)"
            className="flex-1 min-w-[200px] bg-navy border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500" />
          <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal"
            placeholder={wasPaid ? "Additional ₹ to pay" : "Corrected ₹ (optional)"}
            className="w-44 bg-navy border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500" />
          <button disabled={busy} onClick={() => answer("uphold")} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-green text-navy disabled:opacity-40">Uphold</button>
          <button disabled={busy} onClick={() => answer("dismiss")} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-navy-700 text-white disabled:opacity-40">Dismiss</button>
        </div>
      )}
    </div>
  );
}

function StatCards({ s }: { s: ClaimStats }) {
  const items = [
    ["Awaiting approval", s.awaiting_approval, inr(s.amount_awaiting_approval)],
    ["Under investigation", s.under_investigation, ""],
    ["Challenged by farmer", s.disputed ?? 0, ""],
    ["Approved, unpaid", s.approved, inr(s.amount_approved_unpaid)],
    ["Paid (simulated)", s.paid, inr(s.amount_paid)],
    ["Approved exposure", "", inr(s.approved_exposure)],
  ] as const;
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
      {items.map(([label, n, amt]) => (
        <div key={label} className="bg-navy-800 border border-navy-700 rounded-xl p-3">
          <p className="text-xs text-gray-400">{label}</p>
          <p className="text-xl font-bold text-white">{n !== "" ? n : amt}</p>
          {n !== "" && amt && <p className="text-xs text-gray-500">{amt}</p>}
        </div>
      ))}
    </div>
  );
}

type Action = "approve" | "hold" | "reject" | "investigate" | "resume";
const DONE: Record<Action, string> = {
  approve: "approved", hold: "put on hold", reject: "rejected", investigate: "sent for investigation",
  resume: "returned to the approval queue",
};
// Mirrors the backend status machine so only actions that can succeed are offered.
const ACTIONS: Record<string, Action[]> = {
  AWAITING_APPROVAL: ["approve", "hold", "reject"],
  RECOMMENDED: ["hold", "reject"],
  UNDER_INVESTIGATION: ["resume", "hold", "reject"],
  ON_HOLD: ["approve", "resume", "reject"],
};
const BTN: Record<Action, { label: string; cls: string }> = {
  approve: { label: "Approve", cls: "bg-brand-green text-navy" },
  hold: { label: "Hold", cls: "bg-navy-700 text-white" },
  investigate: { label: "Investigate", cls: "bg-navy-700 text-white" },
  resume: { label: "Investigation done, ready to approve", cls: "bg-navy-700 text-white" },
  reject: { label: "Reject", cls: "bg-red-800 text-white" },
};

function ClaimCard({ claim, canDecide, onChanged, onError }: {
  claim: Claim; canDecide: boolean; onChanged: (m: string) => void; onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const calc = claim.calculation;

  async function act(action: Action) {
    if (reason.trim().length < 3) { onError("Please type a reason (at least 3 characters)."); return; }
    setBusy(true);
    try {
      await decideClaim(claim.id, action, reason.trim());
      setReason("");
      onChanged(`Claim ${DONE[action]}.`);
    } catch (e) { onError(e instanceof Error ? e.message : "Action failed"); }
    finally { setBusy(false); }
  }

  async function pay() {
    setBusy(true);
    try {
      const r = await payClaim(claim.id);
      onChanged(`Simulated payment ${r.payment.transaction_ref}: ${inr(r.payment.amount)} to ${r.payment.destination.account ?? "account"}.`);
    } catch (e) { onError(e instanceof Error ? e.message : "Payment failed"); }
    finally { setBusy(false); }
  }

  const actions = ACTIONS[claim.status] ?? [];
  const decidable = actions.length > 0;

  return (
    <div className="bg-navy-800 border border-navy-700 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-white font-semibold">{inr(claim.recommended_amount)}
            <span className="text-xs text-gray-500 font-normal ml-2">recommended · {claim.outcome}</span></p>
          <p className="text-xs text-gray-400">Farm {claim.farm_id} · Policy {claim.policy_id} · Event {claim.event_id}</p>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_STYLE[claim.status] ?? "border-navy-600 text-gray-300"}`}>
          {claim.status.replace(/_/g, " ")}
        </span>
      </div>

      <p className="text-sm text-gray-300">
        Rainfall <b>{calc.estimated_rainfall_mm} mm</b>
        {calc.rainfall_sigma_mm > 0 && <> ± {calc.rainfall_sigma_mm}</>} · trigger {calc.trigger_start_mm} mm → full {calc.trigger_full_mm} mm
        · sensor trust {calc.sensor_trust ?? "n/a"}
      </p>

      <button onClick={() => setOpen((o) => !o)} className="text-xs text-brand-blue hover:underline">
        {open ? "Hide" : "Show"} reasons & history
      </button>
      {open && <Details calc={calc} claim={claim} />}

      {claim.supplementary && <p className="text-xs text-purple-300">Additional payment after the farmer's challenge was upheld (parent claim {claim.parent_claim_id}).</p>}
      {claim.status === "DISPUTED" && (
        <DisputePanel claim={claim} canDecide={canDecide}
          onChanged={onChanged} onError={onError} />
      )}

      {canDecide && decidable && (
        <div className="flex gap-2 flex-wrap items-center">
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
            className="flex-1 min-w-[200px] bg-navy border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500" />
          {actions.map((a) => (
            <button key={a} disabled={busy || (a === "approve" && claim.recommended_amount <= 0)} onClick={() => act(a)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-40 ${BTN[a].cls}`}>{BTN[a].label}</button>
          ))}
        </div>
      )}

      {canDecide && claim.status === "APPROVED" && (
        <button disabled={busy} onClick={pay}
          className="text-sm font-semibold px-4 py-2 rounded-lg bg-brand-blue text-white disabled:opacity-40">
          {busy ? "Processing…" : `Send simulated payment of ${inr(claim.recommended_amount)}`}
        </button>
      )}
      {claim.status === "PAID" && (
        <p className="text-xs text-green-300">Paid (simulated) · transaction {claim.transaction_ref}</p>
      )}
    </div>
  );
}

function Details({ calc, claim }: { calc: ClaimCalculation; claim: Claim }) {
  return (
    <div className="grid md:grid-cols-2 gap-4 text-xs">
      <div className="space-y-1">
        <p className="text-gray-400 uppercase tracking-wide">Why this recommendation</p>
        <ul className="list-disc pl-4 text-gray-300 space-y-0.5">{calc.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
        <p className="text-gray-500 pt-1">
          Severity {(calc.severity * 100).toFixed(0)}% of {inr(calc.sum_insured)} insured · engine {calc.engine_version}
          {calc.cap_applied && " · cap applied"}
        </p>
      </div>
      <div className="space-y-1">
        <p className="text-gray-400 uppercase tracking-wide">History</p>
        <ul className="space-y-0.5 text-gray-300">
          {claim.history.map((h, i) => (
            <li key={i}>{new Date(h.at).toLocaleString()} · {h.from ?? "—"} → <b>{h.to}</b> · {h.reason}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function NewClaimPanel({ onCreated, onError }: { onCreated: (m: string) => void; onError: (m: string) => void }) {
  const [policies, setPolicies] = useState<PolicyOut[]>([]);
  const [open, setOpen] = useState(false);
  const [policyId, setPolicyId] = useState("");
  const [eventId, setEventId] = useState("");
  const [rain, setRain] = useState("");
  const [sigma, setSigma] = useState("0");
  const [trust, setTrust] = useState("0.9");
  const [preview, setPreview] = useState<ClaimCalculation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && policies.length === 0) listPolicies().then(setPolicies).catch(() => onError("Could not load policies"));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const body = (dry: boolean) => ({
    policy_id: policyId, event_id: eventId.trim(), estimated_rainfall_mm: parseFloat(rain),
    rainfall_sigma_mm: parseFloat(sigma) || 0, sensor_trust: parseFloat(trust), dry_run: dry,
  });
  const valid = policyId && eventId.trim() && !isNaN(parseFloat(rain));

  async function run(dry: boolean) {
    setBusy(true);
    try {
      const r = await calculateClaim(body(dry));
      setPreview(r.calculation);
      if (!dry) onCreated(r.created ? "Claim created." : "A claim for this farm, event and policy already exists (no duplicate made).");
    } catch (e) { onError(e instanceof Error ? e.message : "Calculation failed"); }
    finally { setBusy(false); }
  }

  const cls = "w-full bg-navy border border-navy-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500";
  return (
    <div className="bg-navy-800 border border-navy-700 rounded-xl p-4">
      <button onClick={() => setOpen((o) => !o)} className="text-sm font-semibold text-white">
        {open ? "▾" : "▸"} New claim calculation
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid sm:grid-cols-5 gap-2">
            <select className={cls} value={policyId} onChange={(e) => setPolicyId(e.target.value)}>
              <option value="">Policy…</option>
              {policies.map((p) => <option key={p.id} value={p.id}>{p.policy_number}</option>)}
            </select>
            <input className={cls} placeholder="Event ID (e.g. storm-1)" value={eventId} onChange={(e) => setEventId(e.target.value)} />
            <input className={cls} type="number" placeholder="Rainfall mm" value={rain} onChange={(e) => setRain(e.target.value)} />
            <input className={cls} type="number" placeholder="± uncertainty mm" value={sigma} onChange={(e) => setSigma(e.target.value)} />
            <input className={cls} type="number" step="0.05" min="0" max="1" placeholder="Sensor trust 0-1" value={trust} onChange={(e) => setTrust(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button disabled={!valid || busy} onClick={() => run(true)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-navy-700 text-white disabled:opacity-40">Preview</button>
            <button disabled={!valid || busy} onClick={() => run(false)}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-green text-navy disabled:opacity-40">Create claim</button>
          </div>
          {preview && (
            <div className="text-sm text-gray-200 bg-navy border border-navy-700 rounded-lg p-3 space-y-1">
              <p>Outcome <b>{preview.outcome}</b> · recommended <b>{inr(preview.recommended_amount)}</b> (full entitlement {inr(preview.entitlement)})</p>
              <ul className="list-disc pl-5 text-xs text-gray-400">{preview.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
