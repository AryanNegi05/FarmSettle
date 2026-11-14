/**
 * Real-data replay under India's RWBCIS weather-index rules.
 * Real IMD district rainfall -> the scheme's excess-rainfall term sheet (two-slab payout,
 * index = max 2-consecutive-day rainfall per cover phase). The engine is first checked against
 * the scheme's own published worked example. Read-only and simulated: no money moves.
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  DistrictDetail, PortfolioReport, SchemeExample, getDistrictReplay, getPortfolio, getSchemeExample,
} from "../../api/backtest";

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

export default function BacktestPage() {
  const [hectares, setHectares] = useState(1);
  const [report, setReport] = useState<PortfolioReport | null>(null);
  const [example, setExample] = useState<SchemeExample | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DistrictDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { getSchemeExample().then(setExample).catch(() => setExample(null)); }, []);

  useEffect(() => {
    if (!(hectares > 0)) return;
    const h = setTimeout(() => {
      getPortfolio(hectares)
        .then((r) => { setReport(r); setError(null); setSelected((s) => s ?? r.results[0]?.district ?? null); })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load replay"));
    }, 250);
    return () => clearTimeout(h);
  }, [hectares]);

  useEffect(() => {
    if (!selected || !(hectares > 0)) return;
    getDistrictReplay(selected, hectares).then(setDetail).catch(() => setDetail(null));
  }, [selected, hectares]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <Link to="/insurer" className="text-sm text-brand-blue hover:underline">← Dashboard</Link>
        <h1 className="text-2xl font-bold text-white mt-1">Real-Data Replay · RWBCIS rules</h1>
        <p className="text-sm text-gray-400">
          Real IMD district rainfall (Maharashtra, 19 Aug – 14 Nov 2026) paid out under the payout rules of India's
          Restructured Weather Based Crop Insurance Scheme. Simulation only; the term-sheet numbers are the
          guidelines' own illustration, not a notified policy for a real district.
        </p>
      </div>

      {example && <ExampleCard ex={example} />}

      <div className="flex items-end gap-4 flex-wrap">
        <label className="text-xs text-gray-400 space-y-1">Insured area (hectares)
          <input type="number" min={0.1} step={0.5} value={hectares}
            onChange={(e) => setHectares(Number(e.target.value))}
            className="block w-40 bg-navy-900 border border-navy-600 rounded px-2 py-1.5 text-white text-sm" />
        </label>
        {report && <TermSheet phases={report.phases} />}
      </div>

      {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {report && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Districts evaluated" value={String(report.districts)} />
            <Stat label="Districts paid" value={`${report.districts_paid} / ${report.districts}`} />
            <Stat label="Total payout" value={inr(report.total_payout)} />
            <Stat label="Maximum liability" value={inr(report.total_insured)} />
          </div>
          <p className="text-xs text-gray-500">{report.data_note}</p>
          <div className="bg-navy-800 border border-amber-700/50 rounded-xl p-3 text-xs text-gray-300 space-y-1">
            <p className="text-amber-300 font-semibold">Basis risk (where rainfall index and real hardship can diverge)</p>
            <p>
              <b className="text-white">{report.basis_risk_summary.near_miss}</b> districts were near misses (no payout, but a phase reached ≥70% of its trigger) ·{" "}
              <b className="text-white">{report.basis_risk_summary.heavy_week_low_payout}</b> had a heavy week (≥100 mm in 7 days) but paid under 10% of the limit.
            </p>
            <p className="text-gray-500">{report.basis_risk_summary.note}</p>
          </div>

          <div className="grid md:grid-cols-5 gap-4">
            <div className="md:col-span-2 bg-navy-800 border border-navy-700 rounded-xl overflow-hidden">
              <div className="max-h-[560px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-navy-900 text-xs text-gray-400">
                    <tr><th className="text-left p-2">District</th><th className="text-right p-2">Peak 2-day (mm)</th>
                      <th className="text-right p-2">Payout</th></tr>
                  </thead>
                  <tbody>
                    {report.results.map((r) => (
                      <tr key={r.district} onClick={() => setSelected(r.district)}
                        className={`cursor-pointer border-t border-navy-700 hover:bg-navy-700/50 ${selected === r.district ? "bg-navy-700" : ""}`}>
                        <td className="p-2 text-white">{title(r.district)}
                          {r.flags.includes("NEAR_MISS") && <span className="ml-1 text-[10px] text-amber-300" title="No payout, but ≥70% of a trigger">near miss</span>}
                          {r.flags.includes("HEAVY_WEEK_LOW_PAYOUT") && <span className="ml-1 text-[10px] text-orange-300" title="≥100 mm in 7 days but small payout">heavy week</span>}
                        </td>
                        <td className="p-2 text-right text-gray-300">{r.peak_two_day_mm.toFixed(1)}</td>
                        <td className="p-2 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${r.payout > 0
                            ? "bg-green-900/40 text-green-300 border-green-700" : "bg-navy-700 text-gray-400 border-navy-600"}`}>
                            {r.payout > 0 ? inr(r.payout) : "—"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="md:col-span-3">
              {detail ? <DistrictPanel d={detail} /> : (
                <div className="bg-navy-800 border border-navy-700 rounded-xl p-8 text-center text-gray-400 text-sm">
                  Select a district to replay its rainfall.
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-navy-800 border border-navy-700 rounded-xl p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className="text-xl font-bold text-white">{value}</p>
    </div>
  );
}

/** Our engine vs the numbers printed in the official guidelines. */
function ExampleCard({ ex }: { ex: SchemeExample }) {
  const all = ex.cases.every((c) => c.matches);
  return (
    <div className="bg-navy-800 border border-navy-700 rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-white">Check: our engine vs the scheme's published worked example</h2>
        <span className={`text-xs px-3 py-1 rounded-full border ${all
          ? "bg-green-900/40 text-green-300 border-green-700" : "bg-red-900/40 text-red-300 border-red-700"}`}>
          {all ? "✓ matches the guidelines" : "⚠ differs from the guidelines"}
        </span>
      </div>
      <p className="text-xs text-gray-400">
        Deficit-rainfall cover from the guidelines: strikes {ex.terms.strike1} / {ex.terms.strike2} mm, exit {ex.terms.exit} mm,
        ₹{ex.terms.notional1} and ₹{ex.terms.notional2} per mm per ha, limit {inr(ex.terms.limit)} per ha.
      </p>
      <table className="w-full text-xs">
        <thead className="text-gray-400"><tr>
          <th className="text-left py-1">Area</th><th className="text-right">Hectares</th><th className="text-right">Observed (mm)</th>
          <th className="text-right">Published claim</th><th className="text-right">Our engine</th></tr></thead>
        <tbody>
          {ex.cases.map((c) => (
            <tr key={c.rua} className="border-t border-navy-700 text-gray-200">
              <td className="py-1">RUA {c.rua}</td><td className="text-right">{c.hectares}</td>
              <td className="text-right">{c.observed}</td>
              <td className="text-right">{inr(c.published_total)}</td>
              <td className={`text-right font-semibold ${c.matches ? "text-green-300" : "text-red-300"}`}>{inr(c.engine_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TermSheet({ phases }: { phases: PortfolioReport["phases"] }) {
  return (
    <div className="text-xs bg-navy-800 border border-navy-700 rounded-xl p-3 flex-1 min-w-[300px]">
      <p className="text-gray-400 mb-1">Excess-rainfall term sheet · index = max rainfall in any 2 consecutive days · ₹ per hectare</p>
      <table className="w-full">
        <thead className="text-gray-400"><tr><th className="text-left">Phase</th><th className="text-right">Strike 1</th>
          <th className="text-right">Strike 2</th><th className="text-right">Exit</th><th className="text-right">₹/mm (1 · 2)</th>
          <th className="text-right">Limit</th></tr></thead>
        <tbody>
          {phases.map((p) => (
            <tr key={p.name} className="text-gray-200 border-t border-navy-700">
              <td className="py-0.5">{p.name}</td><td className="text-right">{p.strike1}</td><td className="text-right">{p.strike2}</td>
              <td className="text-right">{p.exit}</td><td className="text-right">{p.notional1} · {p.notional2}</td>
              <td className="text-right">{inr(p.limit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DistrictPanel({ d }: { d: DistrictDetail }) {
  return (
    <div className="bg-navy-800 border border-navy-700 rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-white">{title(d.district)}</h2>
          <p className="text-xs text-gray-400">Peak 2-day rainfall <b className="text-white">{d.peak_two_day_mm.toFixed(1)} mm</b></p>
        </div>
        <span className={`text-xs px-3 py-1 rounded-full border ${d.payout > 0
          ? "bg-green-900/40 text-green-300 border-green-700" : "bg-navy-700 text-gray-400 border-navy-600"}`}>
          {d.payout > 0 ? `PAY · ${inr(d.payout)}` : "NO PAYOUT"} · {d.hectares} ha
        </span>
      </div>
      <TwoDayChart d={d} />
      <BasisRiskPanel d={d} />
      <div className="space-y-2">
        {d.phases.map((p) => <PhaseCalc key={p.name} p={p} />)}
      </div>
    </div>
  );
}

function BasisRiskPanel({ d }: { d: DistrictDetail }) {
  const b = d.basis_risk;
  const w = b.payout_per_ha_by_window_days;
  return (
    <div className="text-xs bg-navy-900 border border-amber-700/40 rounded-lg p-3 text-gray-300 space-y-1">
      <p className="text-amber-300 font-semibold">Basis-risk check</p>
      {b.near_misses.map((n) => (
        <p key={n.phase}>Near miss in {n.phase}: peak {n.observed_mm} mm vs trigger {n.strike1} mm ({n.pct_of_strike1}%) → no payout.</p>
      ))}
      <p>Peak 7-day rainfall: <b className="text-white">{b.peak_7day_mm} mm</b>
        {b.flags.includes("HEAVY_WEEK_LOW_PAYOUT") && " — a heavy week, but a short-burst index pays little for rain spread over days."}</p>
      <p>Same slabs, different index window (₹/ha): 1 day <b className="text-white">{inr(w["1"])}</b> · 2 days{" "}
        <b className="text-white">{inr(w["2"])}</b> · 3 days <b className="text-white">{inr(w["3"])}</b>
        <span className="text-gray-500"> — the contract's window definition changes the payout.</span></p>
      <p className="text-gray-500">Proxies from rainfall only; no crop-loss data.</p>
    </div>
  );
}

function PhaseCalc({ p }: { p: DistrictDetail["phases"][number] }) {
  const obs = p.observed_mm;
  const s1 = obs !== null ? Math.max(0, Math.min(obs, p.strike2) - p.strike1) : 0;
  const s2 = obs !== null ? Math.max(0, Math.min(obs, p.exit) - p.strike2) : 0;
  return (
    <div className="text-xs bg-navy-900 rounded-lg p-3 text-gray-300 space-y-0.5">
      <p className="text-white font-semibold">{p.name}
        {obs !== null && <span className="text-gray-400 font-normal"> · peak {obs} mm on {p.window_start} → {p.window_end}</span>}
        {p.partial_data && <span className="text-amber-300 font-normal"> · data starts mid-phase</span>}
      </p>
      {obs === null || obs <= p.strike1 ? (
        <p>{obs === null ? "No complete 2-day observation in this phase." :
          `${obs} mm ≤ Strike 1 (${p.strike1} mm): trigger not breached → ₹0`}</p>
      ) : obs >= p.exit ? (
        <p>{obs} mm ≥ Exit ({p.exit} mm): full phase limit → <b className="text-white">{inr(p.limit)}</b> per ha</p>
      ) : (
        <p>
          ({Math.min(obs, p.strike2).toFixed(1)} − {p.strike1}) × {p.notional1}
          {s2 > 0 && <> + ({obs} − {p.strike2}) × {p.notional2}</>}
          {" "}= <b className="text-white">{inr(p.payout_per_ha)}</b> per ha
        </p>
      )}
    </div>
  );
}

/** Rolling 2-day rainfall (the scheme's index) with each phase's Strike 1 / Strike 2 / Exit lines. */
function TwoDayChart({ d }: { d: DistrictDetail }) {
  const W = 640, H = 220, P = { l: 36, r: 8, t: 10, b: 22 };
  const t0 = new Date(d.daily[0].date).getTime();
  const t1 = new Date(d.daily[d.daily.length - 1].date).getTime();
  const x = (date: string) => P.l + ((new Date(date).getTime() - t0) / (t1 - t0)) * (W - P.l - P.r);
  const max = Math.max(...d.two_day.map((p) => p.mm), ...d.phases.map((p) => p.strike1 * 1.2), 20);
  const y = (v: number) => H - P.b - (Math.min(v, max) / max) * (H - P.t - P.b);
  const pts = d.two_day.map((p) => `${x(p.end).toFixed(1)},${y(p.mm).toFixed(1)}`).join(" ");
  const clip = (s: string) => (s < d.daily[0].date ? d.daily[0].date : s > d.daily[d.daily.length - 1].date ? d.daily[d.daily.length - 1].date : s);
  const visible = d.phases.filter((p) => p.end >= d.daily[0].date && p.start <= d.daily[d.daily.length - 1].date);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
        aria-label={`Rolling 2-day rainfall for ${d.district} against scheme strike levels`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={P.l} x2={W - P.r} y1={y(max * f)} y2={y(max * f)} stroke="#334155" strokeWidth={0.5} />
            <text x={P.l - 4} y={y(max * f) + 3} fontSize={9} textAnchor="end" fill="#94a3b8">{Math.round(max * f)}</text>
          </g>
        ))}
        {visible.map((p) => {
          const xa = x(clip(p.start)), xb = x(clip(p.end));
          return (
            <g key={p.name}>
              <rect x={xa} y={P.t} width={Math.max(0, xb - xa)} height={H - P.t - P.b} fill="#1e293b" opacity={0.35} />
              {([["Strike 1", p.strike1, "#f59e0b"], ["Strike 2", p.strike2, "#f97316"], ["Exit", p.exit, "#ef4444"]] as const)
                .filter(([, v]) => v <= max).map(([lbl, v, col]) => (
                  <g key={lbl}>
                    <line x1={xa} x2={xb} y1={y(v)} y2={y(v)} stroke={col} strokeWidth={1} strokeDasharray="4 3" />
                    <text x={xb - 2} y={y(v) - 2} fontSize={8} textAnchor="end" fill={col}>{lbl} {v}</text>
                  </g>
                ))}
            </g>
          );
        })}
        <polyline points={pts} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        {d.phases.filter((p) => p.window_end && p.observed_mm !== null).map((p) => (
          <circle key={p.name} cx={x(p.window_end as string)} cy={y(p.observed_mm as number)} r={3.5} fill="#22c55e">
            <title>{p.name}: {p.observed_mm} mm</title>
          </circle>
        ))}
        <text x={P.l} y={H - 6} fontSize={9} fill="#94a3b8">{d.daily[0].date}</text>
        <text x={W - P.r} y={H - 6} fontSize={9} textAnchor="end" fill="#94a3b8">{d.daily[d.daily.length - 1].date}</text>
        <text x={P.l + 4} y={P.t + 8} fontSize={9} fill="#94a3b8">2-day rainfall, mm</text>
      </svg>
      <p className="text-xs text-gray-500">
        <span className="text-blue-400">━</span> rolling 2-day rainfall (the scheme's index) ·{" "}
        <span className="text-green-400">●</span> peak per phase, used for settlement · dashed lines = that phase's strikes and exit.
      </p>
    </div>
  );
}
