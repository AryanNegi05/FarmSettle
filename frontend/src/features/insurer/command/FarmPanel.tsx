import { Link } from "react-router-dom";
import type { CCFarm, CCSeries } from "../../../api/command";
import { RISK_COLOUR, RISK_LABEL, inr } from "./layers";

const RECOMMENDATION: Record<string, string> = {
  PAY: "Eligible: approval recommended", ADVANCE: "Partial advance: investigate", HOLD: "Hold: review required", NONE: "No payout",
};

interface Props {
  farm: CCFarm;
  prevPayout: number | undefined;
  series: CCSeries | null;
  tl: number | null;
  onAdjust: (farmId: string, mmHr: number) => void;
  onClose: () => void;
  role: string | undefined;
}

export default function FarmPanel({ farm, prevPayout, series, tl, onAdjust, onClose, role }: Props) {
  const claim = farm.claim;
  const now = claim?.recommended_amount ?? 0;
  const delta = prevPayout !== undefined && prevPayout > 0 ? ((now - prevPayout) / prevPayout) * 100 : null;
  const canDecide = role === "insurer" || role === "admin";
  const est = farm.estimated_rainfall;
  const gap = est !== null ? farm.true_rainfall - est : null;

  return (
    <div className="absolute top-[96px] left-3 z-20 w-[320px] max-w-[calc(100%-24px)] max-h-[calc(100%-96px-84px)] overflow-y-auto rounded-2xl border border-line bg-surface/85 backdrop-blur-md shadow-2xl text-sm text-ink-soft">
      <div className="flex items-start justify-between px-4 py-3 border-b border-line">
        <div>
          <p className="font-semibold text-ink">{farm.name}</p>
          <p className="text-[11px] text-ink-muted">{farm.farmer_label} · farm {farm.farm_id.slice(0, 8)}…{farm.crop ? ` · ${farm.crop}` : ""} · {farm.area_ha} ha</p>
        </div>
        <button onClick={onClose} className="text-ink-muted hover:text-ink text-lg leading-none">×</button>
      </div>

      <div className="p-4 space-y-4">
        {/* 1. Rain effect on this plot */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] px-2 py-0.5 rounded-full text-black font-semibold" style={{ background: RISK_COLOUR[farm.risk] }}>{RISK_LABEL[farm.risk]} risk</span>
          </div>
          <RainGauge farm={farm} />
          {gap !== null && Math.abs(gap) >= 3 && (
            <p className="text-[11px] text-amber-700">
              Basis risk: {farm.true_rainfall} mm/hr is actually falling here, but the sensors estimate {est} mm/hr
              ({gap > 0 ? "under" : "over"}-reading by {Math.abs(gap).toFixed(1)}).
            </p>
          )}
        </section>

        {/* 2. Local adjustment for this farm only */}
        <section className="space-y-1">
          <p className="text-[11px] uppercase tracking-wider text-ink-muted">Adjust rain at this farm only</p>
          <input type="range" min={-50} max={150} step={5} value={farm.adjust}
            onChange={(e) => onAdjust(farm.farm_id, parseFloat(e.target.value))} className="w-full accent-cyan-400" />
          <div className="flex justify-between text-[11px] text-ink-muted">
            <span>{farm.adjust > 0 ? "+" : ""}{farm.adjust} mm/hr local cell (about {Math.round(Math.max(60, 1.5 * farm.circle_radius_m))} m wide)</span>
            {farm.adjust !== 0 && <button onClick={() => onAdjust(farm.farm_id, 0)} className="text-accent hover:underline">reset</button>}
          </div>
        </section>

        {/* 3. Policy */}
        {!farm.policy && (
          <div className="rounded-xl bg-sunken border border-line p-3 text-xs text-ink-soft space-y-1">
            <p>This farm has no insurance policy, so no payout can be calculated.</p>
            {canDecide && farm.farmer_profile_id && (
              <Link to={`/insurer/policies/new?farmerId=${farm.farmer_profile_id}&farmId=${farm.farm_id}`} className="text-accent hover:underline">Create a policy for this farmer →</Link>
            )}
          </div>
        )}

        {claim && (
          <div className="rounded-xl bg-sunken border border-line p-3 space-y-1">
            <p className="text-[11px] uppercase tracking-wider text-ink-muted">Estimated payout (simulation)</p>
            <p className="text-xl font-bold text-ink">{inr(now)}
              {delta !== null && Math.abs(delta) >= 0.5 && (
                <span className={`ml-2 text-xs font-semibold ${delta > 0 ? "text-red-700" : "text-green-700"}`}>{delta > 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(0)}%</span>
              )}
            </p>
            {prevPayout !== undefined && <p className="text-[11px] text-ink-faint">Previous {inr(prevPayout)}</p>}
            <p className="text-xs text-accent">{RECOMMENDATION[claim.outcome]}</p>
            <p className="text-[11px] text-ink-muted">
              Trigger {claim.trigger_crossed ? "crossed" : "not crossed"} · {claim.eligible ? "eligible" : "not eligible"}
              {claim.needs_investigation ? " · needs investigation" : ""}{claim.requires_human_review ? " · human review" : ""}
            </p>
          </div>
        )}

        {/* 4. Rain over time */}
        <TimeChart series={series} tl={tl} policyTrigger={farm.policy?.trigger ?? null} />

      </div>
    </div>
  );
}

/** Estimated rainfall      </div>
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
        <span className="text-ink-muted">Rainfall estimate</span>
        <span className="text-ink">{est === null ? "n/a" : `${est} mm/hr`}{farm.lower !== null ? <span className="text-ink-faint"> ({farm.lower}–{farm.upper})</span> : null}</span>
      </div>
      <div className="relative h-3 rounded-full bg-sunken mt-1 overflow-hidden">
        {farm.lower !== null && farm.upper !== null && (
          <div className="absolute inset-y-0 bg-accent/25" style={{ left: pct(farm.lower), width: `calc(${pct(farm.upper)} - ${pct(farm.lower)})` }} />
        )}
        {est !== null && <div className="absolute inset-y-0 w-1 bg-accent" style={{ left: pct(est) }} />}
        {trig !== null && <div className="absolute inset-y-0 w-px bg-amber-300" style={{ left: pct(trig) }} title={`Trigger ${trig}`} />}
        {full !== null && <div className="absolute inset-y-0 w-px bg-red-400" style={{ left: pct(full) }} title={`Full payout ${full}`} />}
        <div className="absolute inset-y-0 w-px border-l border-dashed border-white" style={{ left: pct(farm.true_rainfall) }} title={`Actually falling: ${farm.true_rainfall}`} />
      </div>
      <p className="text-[10px] text-ink-faint mt-0.5">cyan = sensor estimate ± range · white dashed = actually falling here (simulated truth){trig !== null ? " · amber = trigger · red = full payout" : ""}</p>
    </div>
  );
}

/** This farm's rainfall (estimated and actual) and payout across the storm life-cycle. */
function TimeChart({ series, tl, policyTrigger }: { series: CCSeries | null; tl: number | null; policyTrigger: number | null }) {
  if (!series || series.points.length < 2) return <p className="text-[11px] text-ink-faint">Rain-over-time chart loading…</p>;
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
      <p className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">Rain over the storm life-cycle</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl bg-sunken border border-line">
        {policyTrigger !== null && <line x1={L} x2={W - 6} y1={yr(policyTrigger)} y2={yr(policyTrigger)} stroke="#fbbf24" strokeDasharray="3 3" opacity="0.6" />}
        <polyline fill="none" stroke="#fbbf24" strokeWidth="1.5" opacity="0.8" points={line((p) => p.payout, yp)} />
        <polyline fill="none" stroke="#ffffff" strokeWidth="1" strokeDasharray="3 2" points={line((p) => p.truth, yr)} />
        <polyline fill="none" stroke="#22d3ee" strokeWidth="2" points={line((p) => p.estimated, yr)} />
        {tl !== null && <line x1={x(tl)} x2={x(tl)} y1={T} y2={H - B} stroke="#f472b6" />}
        <text x={L} y={H - 3} fontSize="8" fill="#94a3b8">build-up</text>
        <text x={W - 6} y={H - 3} fontSize="8" fill="#94a3b8" textAnchor="end">fade</text>
        <text x={L - 3} y={T + 6} fontSize="8" fill="#94a3b8" textAnchor="end">{Math.round(rMax)}</text>
      </svg>
      <p className="text-[10px] text-ink-faint">cyan = sensor estimate · white dashed = actual · amber = payout · amber dashed = trigger{tl !== null ? " · pink = now" : ""}</p>
    </div>
  );
}
