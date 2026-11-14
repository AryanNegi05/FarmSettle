import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { CCFarm, CCSeries } from "../../../api/command";
import { Claim, calculateClaim, decideClaim, getClaim } from "../../../api/claims";
import { RISK_COLOUR, RISK_LABEL, inr } from "./layers";

const RECOMMENDATION: Record<string, string> = {
  PAY: "Eligible: approval recommended", ADVANCE: "Partial advance: investigate", HOLD: "Hold: review required", NONE: "No payout",
};

interface Props {
  farm: CCFarm;
  prevPayout: number | undefined;
  series: CCSeries | null;
  tl: number | null;
  /** Identifies the scenario on screen, so a claim is tied to exactly this event. */
  eventId: string;
  onAdjust: (farmId: string, mmHr: number) => void;
  onClose: () => void;
  role: string | undefined;
}

export default function FarmPanel({ farm, prevPayout, series, tl, eventId, onAdjust, onClose, role }: Props) {
  const claim = farm.claim;
  const now = claim?.recommended_amount ?? 0;
  const delta = prevPayout !== undefined && prevPayout > 0 ? ((now - prevPayout) / prevPayout) * 100 : null;
  const canDecide = role === "insurer" || role === "admin";
  const est = farm.estimated_rainfall;
  const gap = est !== null ? farm.true_rainfall - est : null;

  return (
    <div className="absolute top-[96px] left-3 z-20 w-[350px] max-w-[calc(100%-24px)] max-h-[calc(100%-96px-84px)] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900/85 backdrop-blur-md shadow-2xl text-sm text-gray-200">
      <div className="flex items-start justify-between px-4 py-3 border-b border-white/10">
        <div>
          <p className="font-semibold text-white">{farm.name}</p>
          <p className="text-[11px] text-gray-400">{farm.farmer_label} · farm {farm.farm_id.slice(0, 8)}…{farm.crop ? ` · ${farm.crop}` : ""} · {farm.area_ha} ha</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
      </div>

      <div className="p-4 space-y-4">
        {farm.image_url && <img src={farm.image_url} alt="Farmer-traced boundary" className="w-full rounded-lg border border-white/10" />}

        {/* 1. Rain effect on this plot */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full text-black font-semibold" style={{ background: RISK_COLOUR[farm.risk] }}>{RISK_LABEL[farm.risk]} risk</span>
            <span className="text-[11px] text-gray-400">Flood probability {farm.flood_probability ?? "n/a"} (indicative)</span>
          </div>
          <RainGauge farm={farm} />
          {gap !== null && Math.abs(gap) >= 3 && (
            <p className="text-[11px] text-amber-200">
              Basis risk: {farm.true_rainfall} mm/hr is actually falling here, but the sensors estimate {est} mm/hr
              ({gap > 0 ? "under" : "over"}-reading by {Math.abs(gap).toFixed(1)}).
            </p>
          )}
        </section>

        {/* 2. Local adjustment for this farm only */}
        <section className="space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-gray-400">Adjust rain at this farm only</p>
          <input type="range" min={-50} max={150} step={5} value={farm.adjust}
            onChange={(e) => onAdjust(farm.farm_id, parseFloat(e.target.value))} className="w-full accent-cyan-400" />
          <div className="flex justify-between text-[11px] text-gray-400">
            <span>{farm.adjust > 0 ? "+" : ""}{farm.adjust} mm/hr local cell (about {Math.round(Math.max(60, 1.5 * farm.circle_radius_m))} m wide)</span>
            {farm.adjust !== 0 && <button onClick={() => onAdjust(farm.farm_id, 0)} className="text-cyan-300 hover:underline">reset</button>}
          </div>
        </section>

        {/* 3. Policy payout curve */}
        {farm.policy ? <PayoutCurve farm={farm} /> : (
          <div className="rounded-xl bg-black/30 border border-white/10 p-3 text-xs text-gray-300 space-y-1">
            <p>This farm has no insurance policy, so no payout can be calculated.</p>
            {canDecide && farm.farmer_profile_id && (
              <Link to={`/insurer/policies/new?farmerId=${farm.farmer_profile_id}&farmId=${farm.farm_id}`} className="text-cyan-300 hover:underline">Create a policy for this farmer →</Link>
            )}
          </div>
        )}

        {claim && (
          <div className="rounded-xl bg-black/30 border border-white/10 p-3 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-gray-400">Estimated payout (simulation)</p>
            <p className="text-xl font-bold text-white">{inr(now)}
              {delta !== null && Math.abs(delta) >= 0.5 && (
                <span className={`ml-2 text-xs font-semibold ${delta > 0 ? "text-red-300" : "text-green-300"}`}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%</span>
              )}
            </p>
            {prevPayout !== undefined && <p className="text-[11px] text-gray-500">Previous {inr(prevPayout)}</p>}
            <p className="text-xs text-cyan-200">{RECOMMENDATION[claim.outcome]}</p>
            <p className="text-[11px] text-gray-400">
              Trigger {claim.trigger_crossed ? "crossed" : "not crossed"} · {claim.eligible ? "eligible" : "not eligible"}
              {claim.needs_investigation ? " · needs investigation" : ""}{claim.requires_human_review ? " · human review" : ""}
            </p>
            <ul className="list-disc pl-4 text-[11px] text-gray-400">{claim.reasons.slice(0, 3).map((r, i) => <li key={i}>{r}</li>)}</ul>
          </div>
        )}

        {/* 4. Rain over time */}
        <TimeChart series={series} tl={tl} policyTrigger={farm.policy?.trigger ?? null} />

        <section>
          <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">
            Sensor evidence · {farm.contributors.length} contributing · confidence {farm.sensor_confidence === null ? "n/a" : `${Math.round(farm.sensor_confidence * 100)}%`}
          </p>
          <ul className="text-[11px] space-y-0.5">
            {farm.contributors.map((c) => (
              <li key={c.sensor_id} className="flex justify-between text-cyan-100">
                <span>{c.sensor_id} · {c.distance_m} m</span>
                <span>{c.reading} mm/hr · trust {c.trust.toFixed(2)} · w {Math.round(c.weight * 100)}%</span>
              </li>
            ))}
            {farm.excluded.map((e) => (
              <li key={e.sensor_id} className="text-red-300" title={e.reason}>✕ {e.sensor_id} ({e.reading} mm/hr): {e.reason}</li>
            ))}
          </ul>
        </section>

        <DecisionBox farm={farm} eventId={eventId} canDecide={canDecide} />
        <p className="text-[10px] text-gray-500">Coverage circle ({Math.round(farm.circle_radius_m)} m) is a monitoring zone, not a guarantee that rain is uniform inside it. Amounts are simulated.</p>
      </div>
    </div>
  );
}

/** Estimated rainfall with its uncertainty range against the policy trigger. */
function RainGauge({ farm }: { farm: CCFarm }) {
  const est = farm.estimated_rainfall;
  const trig = farm.policy?.trigger ?? null;
  const full = farm.policy?.full ?? null;
  const max = Math.max(60, (full ?? 0) * 1.1, (farm.upper ?? 0) * 1.1, farm.true_rainfall * 1.1);
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div>
      <div className="flex justify-between text-xs">
        <span className="text-gray-400">Rainfall estimate</span>
        <span className="text-white">{est === null ? "n/a" : `${est} mm/hr`}{farm.lower !== null ? <span className="text-gray-500"> ({farm.lower}–{farm.upper})</span> : null}</span>
      </div>
      <div className="relative h-3 rounded-full bg-black/40 mt-1 overflow-hidden">
        {farm.lower !== null && farm.upper !== null && (
          <div className="absolute inset-y-0 bg-cyan-400/25" style={{ left: pct(farm.lower), width: `calc(${pct(farm.upper)} - ${pct(farm.lower)})` }} />
        )}
        {est !== null && <div className="absolute inset-y-0 w-1 bg-cyan-300" style={{ left: pct(est) }} />}
        {trig !== null && <div className="absolute inset-y-0 w-px bg-amber-300" style={{ left: pct(trig) }} title={`Trigger ${trig}`} />}
        {full !== null && <div className="absolute inset-y-0 w-px bg-red-400" style={{ left: pct(full) }} title={`Full payout ${full}`} />}
        <div className="absolute inset-y-0 w-px border-l border-dashed border-white" style={{ left: pct(farm.true_rainfall) }} title={`Actually falling: ${farm.true_rainfall}`} />
      </div>
      <p className="text-[10px] text-gray-500 mt-0.5">cyan = sensor estimate ± range · white dashed = actually falling here (simulated truth){trig !== null ? " · amber = trigger · red = full payout" : ""}</p>
    </div>
  );
}

/** This farm's own policy: payout vs rainfall, with a marker at the current estimate. */
function PayoutCurve({ farm }: { farm: CCFarm }) {
  const p = farm.policy!;
  const trig = p.trigger, full = p.full ?? (trig ? trig * 1.5 : null);
  if (trig === null || full === null) return null;
  const cap = Math.min(p.sum_insured, p.payout_limit ?? p.sum_insured);
  const W = 300, H = 110, L = 34, B = 18, T = 8;
  const xMax = Math.max(full * 1.4, (farm.estimated_rainfall ?? 0) * 1.1, 10);
  const x = (v: number) => L + (v / xMax) * (W - L - 6);
  const y = (v: number) => T + (1 - v / cap) * (H - T - B);
  const est = farm.estimated_rainfall;
  const pay = farm.claim?.recommended_amount ?? 0;
  const entitlement = est === null ? 0 : cap * Math.min(1, Math.max(0, (est - trig) / (full - trig)));
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">Payout curve · policy {p.number}</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-black/30 border border-white/10">
        <polyline fill="none" stroke="#94a3b8" strokeWidth="1.5" points={`${x(0)},${y(0)} ${x(trig)},${y(0)} ${x(full)},${y(cap)} ${x(xMax)},${y(cap)}`} />
        {est !== null && farm.lower !== null && farm.upper !== null && (
          <rect x={x(farm.lower)} y={T} width={Math.max(1, x(farm.upper) - x(farm.lower))} height={H - T - B} fill="#22d3ee" opacity="0.12" />
        )}
        {est !== null && <line x1={x(est)} x2={x(est)} y1={T} y2={H - B} stroke="#22d3ee" strokeDasharray="3 3" />}
        {est !== null && <circle cx={x(est)} cy={y(entitlement)} r="4" fill="#22d3ee" stroke="#fff" />}
        <line x1={x(trig)} x2={x(trig)} y1={y(0)} y2={y(0) + 4} stroke="#fbbf24" />
        <text x={x(trig)} y={H - 4} fontSize="8" fill="#fbbf24" textAnchor="middle">trigger {trig}</text>
        <text x={x(full)} y={H - 4} fontSize="8" fill="#f87171" textAnchor="middle">full {full}</text>
        <text x={L - 3} y={y(cap) + 3} fontSize="8" fill="#94a3b8" textAnchor="end">{inr(cap / 1000)}k</text>
        <text x={L - 3} y={y(0) + 3} fontSize="8" fill="#94a3b8" textAnchor="end">0</text>
      </svg>
      <p className="text-[10px] text-gray-500">Entitlement at the estimate {inr(entitlement)}; recommended after uncertainty and trust rules {inr(pay)}.</p>
    </div>
  );
}

/** This farm's rainfall (estimated and actual) and payout across the storm life-cycle. */
function TimeChart({ series, tl, policyTrigger }: { series: CCSeries | null; tl: number | null; policyTrigger: number | null }) {
  if (!series || series.points.length < 2) return <p className="text-[11px] text-gray-500">Rain-over-time chart loading…</p>;
  const W = 300, H = 110, L = 28, B = 16, T = 8;
  const pts = series.points;
  const rMax = Math.max(10, policyTrigger ?? 0, ...pts.map((p) => Math.max(p.estimated ?? 0, p.truth ?? 0))) * 1.1;
  const pMax = Math.max(1, ...pts.map((p) => p.payout));
  const x = (t: number) => L + t * (W - L - 6);
  const yr = (v: number) => T + (1 - v / rMax) * (H - T - B);
  const yp = (v: number) => T + (1 - v / pMax) * (H - T - B);
  const line = (get: (p: typeof pts[number]) => number | null, scale: (v: number) => number) =>
    pts.filter((p) => get(p) !== null).map((p) => `${x(p.t)},${scale(get(p) as number)}`).join(" ");
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wider text-gray-400 mb-1">Rain over the storm life-cycle</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-lg bg-black/30 border border-white/10">
        {policyTrigger !== null && <line x1={L} x2={W - 6} y1={yr(policyTrigger)} y2={yr(policyTrigger)} stroke="#fbbf24" strokeDasharray="3 3" opacity="0.6" />}
        <polyline fill="none" stroke="#fbbf24" strokeWidth="1.5" opacity="0.8" points={line((p) => p.payout, yp)} />
        <polyline fill="none" stroke="#ffffff" strokeWidth="1" strokeDasharray="3 2" points={line((p) => p.truth, yr)} />
        <polyline fill="none" stroke="#22d3ee" strokeWidth="2" points={line((p) => p.estimated, yr)} />
        {tl !== null && <line x1={x(tl)} x2={x(tl)} y1={T} y2={H - B} stroke="#f472b6" />}
        <text x={L} y={H - 3} fontSize="8" fill="#94a3b8">build-up</text>
        <text x={W - 6} y={H - 3} fontSize="8" fill="#94a3b8" textAnchor="end">fade</text>
        <text x={L - 3} y={T + 6} fontSize="8" fill="#94a3b8" textAnchor="end">{Math.round(rMax)}</text>
      </svg>
      <p className="text-[10px] text-gray-500">cyan = sensor estimate · white dashed = actual · amber = payout · amber dashed = trigger{tl !== null ? " · pink = now" : ""}</p>
    </div>
  );
}

const STATUS_STYLE: Record<string, string> = {
  AWAITING_APPROVAL: "bg-amber-500/20 text-amber-200 border-amber-500/40", UNDER_INVESTIGATION: "bg-orange-500/20 text-orange-200 border-orange-500/40",
  APPROVED: "bg-blue-500/20 text-blue-200 border-blue-500/40", PAID: "bg-green-500/20 text-green-200 border-green-500/40",
  ON_HOLD: "bg-gray-500/20 text-gray-200 border-gray-500/40", REJECTED: "bg-red-500/20 text-red-200 border-red-500/40",
};

/** Insurer decision for this farm and this scenario. Nothing is decided automatically: a person
 *  creates the claim record, types a reason and confirms each decision. */
function DecisionBox({ farm, eventId, canDecide }: { farm: CCFarm; eventId: string; canDecide: boolean }) {
  const policy = farm.policy;
  const [claim, setClaim] = useState<Claim | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const est = farm.estimated_rainfall;
  const outcome = farm.claim?.outcome ?? "NONE";

  // A claim's identity is farm + event + policy, so the same scenario always finds the same record.
  const claimId = policy ? `${farm.farm_id}__${eventId}__${policy.id}` : null;

  useEffect(() => {
    setMsg(null); setReason("");
    if (!claimId) { setClaim(null); return; }
    let live = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      getClaim(claimId).then((c) => { if (live) setClaim(c); }).catch(() => { if (live) setClaim(null); }).finally(() => { if (live) setLoading(false); });
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [claimId]);

  if (!policy) return null;

  async function create() {
    if (est === null || !policy) return;
    if (!window.confirm(`Create a claim record for ${farm.name} for this scenario (${inr(farm.claim?.recommended_amount ?? 0)} recommended)? A person still has to approve it.`)) return;
    setBusy(true); setMsg(null);
    try {
      const r = await calculateClaim({
        policy_id: policy.id, event_id: eventId, estimated_rainfall_mm: est, rainfall_sigma_mm: farm.uncertainty ?? 0,
        sensor_trust: farm.sensor_confidence ?? undefined, dry_run: false,
      });
      if (r.claim) { setClaim(r.claim); setMsg({ ok: true, text: r.created ? "Claim record created." : "A record for this scenario already existed." }); }
      else setMsg({ ok: true, text: "No payout for this scenario, so there is nothing to decide." });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not create the claim" }); }
    finally { setBusy(false); }
  }

  async function decide(action: "approve" | "hold" | "investigate" | "reject") {
    if (!claim) return;
    if (reason.trim().length < 3) { setMsg({ ok: false, text: "Type a reason first (at least 3 characters)." }); return; }
    const verb = { approve: "APPROVE", hold: "put on HOLD", investigate: "send for INVESTIGATION", reject: "REJECT" }[action];
    if (!window.confirm(`${verb[0].toUpperCase() + verb.slice(1)} this claim for ${farm.name} (${inr(claim.recommended_amount)})?\n\nReason: ${reason.trim()}`)) return;
    setBusy(true); setMsg(null);
    try {
      const updated = await decideClaim(claim.id, action, reason.trim());
      setClaim(updated); setReason("");
      setMsg({ ok: true, text: `Recorded: ${updated.status.replace(/_/g, " ").toLowerCase()}.` });
    } catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "Decision failed" }); }
    finally { setBusy(false); }
  }

  const decidable = claim && ["AWAITING_APPROVAL", "UNDER_INVESTIGATION", "ON_HOLD", "RECOMMENDED"].includes(claim.status);
  const stale = claim && est !== null && Math.abs(claim.calculation.estimated_rainfall_mm - est) > 1;

  return (
    <section className="rounded-xl bg-black/30 border border-white/10 p-3 space-y-2">
      <p className="text-[11px] uppercase tracking-wider text-gray-400">Insurer decision · scenario {eventId}</p>

      {loading && <p className="text-xs text-gray-500">Checking for an existing claim…</p>}

      {!loading && !claim && (
        outcome === "NONE" || !farm.claim
          ? <p className="text-xs text-gray-400">No payout in this scenario, so there is nothing to decide.</p>
          : canDecide
            ? <button disabled={busy} onClick={create} className="w-full text-xs font-semibold px-3 py-2 rounded-lg bg-cyan-500 text-slate-900 disabled:opacity-40">
                {busy ? "Working…" : `Create claim record (${inr(farm.claim.recommended_amount)} recommended)`}
              </button>
            : <p className="text-xs text-gray-400">No claim record yet. Only an insurer or admin can create one.</p>
      )}

      {claim && (
        <>
          <div className="flex items-center justify-between gap-2">
            <span className={`text-[11px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[claim.status] ?? "border-white/20 text-gray-200"}`}>{claim.status.replace(/_/g, " ")}</span>
            <span className="text-sm font-semibold text-white">{inr(claim.recommended_amount)}</span>
          </div>
          {stale && <p className="text-[11px] text-amber-200">Rainfall has changed since this claim was created ({claim.calculation.estimated_rainfall_mm} → {est} mm/hr). Decisions apply to the saved record.</p>}
          {claim.decision_reason && <p className="text-[11px] text-gray-400">Last reason: “{claim.decision_reason}”</p>}

          {canDecide && decidable && (
            <div className="space-y-1.5">
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)"
                className="w-full bg-black/30 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500" />
              <div className="grid grid-cols-2 gap-1.5">
                <button disabled={busy || claim.recommended_amount <= 0} onClick={() => decide("approve")} className="text-xs font-semibold px-2 py-1.5 rounded-lg bg-green-500 text-slate-900 disabled:opacity-40">Approve</button>
                <button disabled={busy} onClick={() => decide("reject")} className="text-xs font-semibold px-2 py-1.5 rounded-lg bg-red-600 text-white disabled:opacity-40">Reject</button>
                <button disabled={busy} onClick={() => decide("investigate")} className="text-xs font-semibold px-2 py-1.5 rounded-lg bg-white/10 text-white border border-white/10 disabled:opacity-40">Request investigation</button>
                <button disabled={busy} onClick={() => decide("hold")} className="text-xs font-semibold px-2 py-1.5 rounded-lg bg-white/10 text-white border border-white/10 disabled:opacity-40">Place on hold</button>
              </div>
              <p className="text-[10px] text-gray-500">You will be asked to confirm. Approved claims are paid (simulated) from Claims Review.</p>
            </div>
          )}
          {!canDecide && <p className="text-[11px] text-gray-500">Read-only: only an insurer or admin can decide.</p>}
          {claim.history.length > 0 && (
            <ul className="text-[10px] text-gray-500 space-y-0.5">
              {claim.history.slice(-3).map((h, i) => <li key={i}>{new Date(h.at).toLocaleTimeString()} · {h.from ?? "—"} → {h.to} · {h.reason}</li>)}
            </ul>
          )}
        </>
      )}

      {msg && <p className={`text-[11px] ${msg.ok ? "text-green-300" : "text-red-300"}`}>{msg.text}</p>}
      <Link to="/insurer/claims" className="text-[11px] text-cyan-300 hover:underline inline-block">Open Claims Review (payments, all claims) →</Link>
    </section>
  );
}
