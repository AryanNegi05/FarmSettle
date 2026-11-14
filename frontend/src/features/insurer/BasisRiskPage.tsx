/**
 * Basis Risk Monitor: where the rainfall index may not match what farmers experience.
 * Everything here is an INDICATOR for a human to look at, not proof of crop damage or of a wrong payout.
 * Weather and sensors are simulated; the scenario controls are the Command Centre's.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { CCPreset, getPresets } from "../../api/command";
import {
  BasisAssessment, BasisFlag, BasisResult, LossReport, Verdict, addLossReport, assessBasisRisk, listLossReports,
} from "../../api/basisRisk";
import { LineChart, Scatter, ScatterPoint } from "../shared/charts";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const VERDICT: Record<Verdict, { label: string; icon: string; badge: string; color: string }> = {
  under_risk: { label: "Possible under-compensation", icon: "▼", badge: "bg-amber-900/40 text-amber-300 border-amber-700", color: "#fbbf24" },
  over_risk: { label: "Possible over-compensation", icon: "▲", badge: "bg-purple-900/40 text-purple-300 border-purple-700", color: "#c084fc" },
  mixed: { label: "Mixed signals", icon: "◆", badge: "bg-pink-900/40 text-pink-300 border-pink-700", color: "#f472b6" },
  aligned: { label: "Aligned", icon: "✓", badge: "bg-green-900/40 text-green-300 border-green-700", color: "#4ade80" },
  no_cover: { label: "Coverage gap", icon: "⚠", badge: "bg-red-900/40 text-red-300 border-red-700", color: "#f87171" },
  uninsured: { label: "No policy", icon: "–", badge: "bg-slate-700/60 text-gray-300 border-slate-500", color: "#94a3b8" },
  insufficient: { label: "Insufficient data", icon: "?", badge: "bg-slate-700/60 text-gray-300 border-slate-500", color: "#94a3b8" },
};
const LEVEL_DOTS: Record<string, string> = { low: "●○○", moderate: "●●○", high: "●●●", none: "○○○" };
const CAUSES = ["excess_rain", "flood", "waterlogging", "drought", "pest_disease", "other"] as const;
const FILTERS: [string, string][] = [["all", "All"], ["under_risk", "Under-compensation"], ["over_risk", "Over-compensation"],
  ["mixed", "Mixed"], ["aligned", "Aligned"], ["no_cover", "No cover"]];

export default function BasisRiskPage() {
  const { user } = useAuth();
  const canRecord = user?.role === "insurer" || user?.role === "admin";

  const [presets, setPresets] = useState<CCPreset[]>([]);
  const [presetId, setPresetId] = useState("moderate");
  const [district, setDistrict] = useState(14);
  const [data, setData] = useState<BasisResult | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [evidence, setEvidence] = useState("all");
  const [crop, setCrop] = useState("");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("priority");

  useEffect(() => {
    getPresets().then((p) => {
      setPresets(p);
      const m = p.find((x) => x.id === "moderate") ?? p[0];
      if (m) { setPresetId(m.id); setDistrict(m.district_mm_hr); }
    }).catch(() => undefined);
  }, []);

  const preset = presets.find((p) => p.id === presetId);
  const request = useMemo(() => ({
    district_mm_hr: district, storm: preset?.storm ?? null, faults: preset?.faults ?? {}, sensor_overrides: {}, farm_adjust: {}, sensor_count: 18,
  }), [district, preset]);

  const run = useCallback(() => {
    setBusy(true);
    return assessBasisRisk(request)
      .then((r) => { setData(r); setError(null); })
      .catch((e) => setError(e instanceof Error ? e.message : "Assessment failed"))
      .finally(() => setBusy(false));
  }, [request]);

  useEffect(() => {
    const t = window.setTimeout(run, 350);
    return () => window.clearTimeout(t);
  }, [run]);

  const all = data?.assessments ?? [];
  const crops = useMemo(() => Array.from(new Set(all.map((a) => a.crop).filter(Boolean))) as string[], [all]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    const list = all.filter((a) =>
      (filter === "all" || a.verdict === filter) && (evidence === "all" || a.evidence === evidence) && (!crop || a.crop === crop) &&
      (!n || [a.name, a.farmer, a.policy?.number, a.crop].some((v) => (v ?? "").toLowerCase().includes(n))));
    const key: Record<string, (a: BasisAssessment) => number> = {
      priority: (a) => -a.priority, rain: (a) => -(a.trigger.margin_pct ?? -999), insured: (a) => -(a.policy?.sum_insured ?? 0),
      gap: (a) => -Math.abs((a.payout.ratio) - ((a.loss?.pct ?? (a.damage_proxy ?? 0) * 100) / 100)),
    };
    return [...list].sort((x, y) => key[sort](x) - key[sort](y));
  }, [all, filter, evidence, crop, q, sort]);

  const sel = all.find((a) => a.farm_id === selected) ?? null;
  const s = data?.summary;

  const points: ScatterPoint[] = all.filter((a) => a.policy).map((a) => {
    const hasLoss = !!a.loss;
    const x = hasLoss ? a.loss!.pct : (a.damage_proxy ?? 0) * 100;
    return { id: a.farm_id, x, y: a.payout.ratio * 100, color: VERDICT[a.verdict].color, hollow: !hasLoss, r: 5.5,
      label: `${a.name}: payout ${Math.round(a.payout.ratio * 100)}% · ${hasLoss ? `reported loss ${Math.round(x)}%` : `modelled damage potential ${Math.round(x)}% (no report)`}` };
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link to="/insurer" className="text-sm text-brand-blue hover:underline">← Dashboard</Link>
          <h1 className="text-2xl font-bold text-white mt-1">Basis Risk Monitor</h1>
          <p className="text-gray-400 text-sm">Where the rain index and the policy trigger may not match what farmers actually experience.</p>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-200 border border-amber-500/30">Simulated weather & sensors</span>
      </div>

      <div className="text-xs text-amber-100 bg-amber-900/20 border border-amber-800 rounded-xl px-4 py-2.5">
        <b>Indicators, not proof.</b> A flag means the payout and the available evidence may not line up and deserve a human look. It does not show that crops were or were not damaged, or that any payout is wrong.
        Flags marked <b>Report-backed</b> compare the payout with a recorded loss; <b>Model signal</b> flags use only rainfall, uncertainty and farm-risk estimates.
      </div>

      {/* Scenario */}
      <div className="bg-navy-800 border border-navy-700 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs uppercase tracking-wide text-gray-400">Scenario (same simulation as the Command Centre)</p>
          <Link to="/insurer/command" className="text-xs text-cyan-300 hover:underline">Open Command Centre →</Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((p) => (
            <button key={p.id} onClick={() => { setPresetId(p.id); setDistrict(p.district_mm_hr); }}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${presetId === p.id ? "bg-brand-blue text-white border-brand-blue" : "border-navy-600 text-gray-300 hover:text-white"}`}>{p.label}</button>
          ))}
        </div>
        <label className="flex items-center gap-3 text-xs text-gray-300">
          District rain <input type="range" min={0} max={80} step={1} value={district} onChange={(e) => setDistrict(+e.target.value)} className="flex-1 max-w-md" />
          <b className="text-white w-20">{district} mm/hr</b>
          {busy && <span className="text-cyan-300 animate-pulse">recalculating…</span>}
        </label>
      </div>

      {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {s && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Farms assessed" value={`${s.farms}`} sub={`${s.insured} insured · ${s.uninsured} without policy`} />
          <Kpi label="Possible under-compensation" value={`${s.under_flagged}`} sub={`${inr(s.exposure_under)} insured`} tone="text-amber-300" />
          <Kpi label="Possible over-compensation" value={`${s.over_flagged}`} sub={`${inr(s.payout_over)} payable`} tone="text-purple-300" />
          <Kpi label="Aligned" value={`${s.aligned}`} sub="no indicator raised" tone="text-green-300" />
          <Kpi label="Loss reports" value={`${s.farms_with_reports}`} sub={`of ${s.farms} farms · ${s.report_backed_flags} report-backed flag(s)`} />
          <Kpi label="Payout vs reported loss" value={s.mean_payout_minus_loss == null ? "n/a" : `${s.mean_payout_minus_loss > 0 ? "+" : ""}${Math.round(s.mean_payout_minus_loss * 100)} pts`}
            sub={s.mean_abs_gap == null ? "needs loss reports" : `avg gap ${Math.round(s.mean_abs_gap * 100)} pts`} />
        </div>
      )}

      <div className="grid lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-navy-800 border border-navy-700 rounded-xl p-4 space-y-2">
          <p className="text-white font-semibold text-sm">Payout against loss</p>
          <Scatter points={points} xLabel="Reported loss % (solid) or modelled damage potential % (hollow, no report)" yLabel="Payout % of sum insured"
            diagonal selectedId={selected} onSelect={setSelected} />
          <p className="text-[11px] text-gray-400">Dots <b>below</b> the dashed line were paid less than the loss measure (possible under-compensation); dots <b>above</b> were paid more (possible over-compensation).
            Hollow dots have no loss report, so the horizontal axis is only a model proxy. Click a dot to open the farm.</p>
        </div>
        <div className="lg:col-span-2 bg-navy-800 border border-navy-700 rounded-xl p-4 space-y-2">
          <p className="text-white font-semibold text-sm">Visual key</p>
          <ul className="text-xs space-y-1.5">
            {(["under_risk", "over_risk", "mixed", "aligned", "no_cover", "uninsured"] as Verdict[]).map((v) => (
              <li key={v} className="flex items-center gap-2"><i className="w-3 h-3 rounded-full inline-block" style={{ background: VERDICT[v].color }} /><span className="text-gray-200">{VERDICT[v].label}</span></li>
            ))}
          </ul>
          <p className="text-[11px] text-gray-400 pt-1">Severity: ●○○ low · ●●○ moderate · ●●● high. <span className="text-green-300">Report-backed</span> flags carry more weight than <span className="text-gray-300">model signals</span>.</p>
          <ul className="text-[11px] text-gray-400 list-disc pl-4 space-y-0.5 pt-1">
            <li><b className="text-amber-300">Under:</b> close to the trigger but missed it, damage potential high with no payout, a reported loss above the payout, payout held back, or no policy.</li>
            <li><b className="text-purple-300">Over:</b> payout well above a reported loss, trigger crossed on a narrow or uncertain margin, weak sensor evidence, or a very large payout for low damage potential.</li>
          </ul>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${filter === id ? "bg-brand-blue text-white border-brand-blue" : "border-navy-600 text-gray-400 hover:text-white"}`}>
              {label} <span className="opacity-70">({id === "all" ? all.length : all.filter((a) => a.verdict === id).length})</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 flex-wrap">
          <select value={evidence} onChange={(e) => setEvidence(e.target.value)} className="bg-navy border border-navy-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="all">All evidence</option><option value="reported">Report-backed</option><option value="model_only">Model signal only</option>
          </select>
          <select value={crop} onChange={(e) => setCrop(e.target.value)} className="bg-navy border border-navy-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="">All crops</option>{crops.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)} className="bg-navy border border-navy-700 rounded-lg px-2 py-1.5 text-xs text-white">
            <option value="priority">Sort: highest risk</option><option value="rain">Sort: rain vs trigger</option><option value="insured">Sort: sum insured</option><option value="gap">Sort: payout–loss gap</option>
          </select>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search farm, farmer, policy…"
            className="w-48 bg-navy border border-navy-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder-gray-500" />
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-4 items-start">
        <div className={`${sel ? "lg:col-span-3" : "lg:col-span-5"} bg-navy-800 border border-navy-700 rounded-xl overflow-x-auto`}>
          {!data && busy && <p className="p-6 text-gray-400 text-sm">Assessing farms…</p>}
          {data && shown.length === 0 && <p className="p-6 text-gray-400 text-sm">{all.length === 0 ? "No farms are registered on the shared land yet." : "No farms match these filters."}</p>}
          {shown.length > 0 && (
            <table className="w-full text-xs min-w-[920px]">
              <thead>
                <tr className="border-b border-navy-700 text-gray-400 text-left uppercase tracking-wide text-[10px]">
                  <th className="px-3 py-2.5 font-medium">Farm</th><th className="font-medium">Location</th><th className="font-medium">Rain vs trigger</th>
                  <th className="font-medium">Coverage</th><th className="font-medium">Payout</th><th className="font-medium">Loss</th><th className="px-3 font-medium">Risk indicators</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.farm_id} onClick={() => setSelected(a.farm_id)}
                    className={`border-b border-navy-700/50 last:border-0 cursor-pointer transition ${a.farm_id === selected ? "bg-brand-blue/10" : "hover:bg-navy-700/30"}`}>
                    <td className="px-3 py-2.5"><p className="text-white font-medium">{a.name}</p><p className="text-gray-400">{a.farmer ?? "Farmer"} · {a.crop ?? "crop n/a"}</p></td>
                    <td className="text-gray-300">{a.centre ? `${a.centre[1].toFixed(4)}, ${a.centre[0].toFixed(4)}` : "n/a"}<p className="text-gray-500">{a.area_ha ?? "?"} ha</p></td>
                    <td className="min-w-[170px]"><RainBar a={a} /></td>
                    <td className="text-gray-300">{a.policy ? <>{inr(a.policy.sum_insured)}<p className="text-gray-500">{a.policy.number}</p></> : <span className="text-gray-500">no policy</span>}</td>
                    <td className="text-gray-300">{a.payout.outcome ? <>{inr(a.payout.amount)}<p className="text-gray-500">{a.payout.outcome} · {Math.round(a.payout.ratio * 100)}%</p></> : "n/a"}</td>
                    <td className="text-gray-300">{a.loss ? <>{a.loss.pct}%<p className="text-gray-500">{a.loss.source === "farmer" ? "farmer report" : "field record"}</p></> : <span className="text-gray-500">no report{a.damage_proxy != null && <p>proxy {Math.round(a.damage_proxy * 100)}%</p>}</span>}</td>
                    <td className="px-3"><Badges a={a} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {sel && <Detail a={sel} canRecord={canRecord} onClose={() => setSelected(null)} onRecorded={run} />}
      </div>

      {data && <p className="text-[11px] text-gray-500">{data.notes.join(" ")}</p>}
    </div>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-navy-800 border border-navy-700 rounded-xl p-3">
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`text-2xl font-bold ${tone ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-500 leading-snug">{sub}</p>}
    </div>
  );
}

/** Estimated rain (with its range) against the trigger and full-payout level. */
function RainBar({ a }: { a: BasisAssessment }) {
  const mu = a.rain.estimate, trig = a.trigger.threshold, full = a.trigger.full;
  if (mu == null || trig == null || full == null) return <span className="text-gray-500">n/a</span>;
  const max = Math.max(full * 1.15, (a.rain.upper ?? mu) * 1.05, 1);
  const p = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  const m = a.trigger.margin_pct;
  return (
    <div>
      <div className="relative h-3.5 rounded bg-slate-900 border border-slate-700 overflow-hidden">
        <div className="absolute inset-y-0 bg-green-500/20" style={{ left: p(trig), width: `calc(${p(full)} - ${p(trig)})` }} />
        <div className="absolute inset-y-1 bg-cyan-400/30 rounded" style={{ left: p(a.rain.lower ?? mu), width: `calc(${p(a.rain.upper ?? mu)} - ${p(a.rain.lower ?? mu)})` }} />
        <div className="absolute inset-y-0 w-0.5 bg-amber-400" style={{ left: p(trig) }} />
        <div className="absolute inset-y-0 w-0.5 bg-cyan-300" style={{ left: p(mu) }} />
      </div>
      <p className="text-gray-300 mt-1">{mu.toFixed(1)} ± {a.rain.sigma.toFixed(1)} <span className="text-gray-500">vs {trig} → {full}</span></p>
      <p className={m != null && m >= 0 ? "text-green-300" : "text-amber-300"}>{m == null ? "" : `${m > 0 ? "+" : ""}${m}% vs trigger`}{a.trigger.p_cross != null && <span className="text-gray-500"> · {Math.round(a.trigger.p_cross * 100)}% likely crossed</span>}</p>
    </div>
  );
}

function Badges({ a }: { a: BasisAssessment }) {
  const v = VERDICT[a.verdict];
  const items = [["under", a.under], ["over", a.over]] as const;
  return (
    <div className="space-y-1">
      <span className={`inline-block px-2 py-0.5 rounded-full border text-[11px] font-medium ${v.badge}`}>{v.icon} {v.label}</span>
      {items.filter(([, x]) => x.level !== "none").map(([dir, x]) => (
        <p key={dir} className="text-[11px] text-gray-300">
          <span className={dir === "under" ? "text-amber-300" : "text-purple-300"}>{dir === "under" ? "▼ under" : "▲ over"}</span> {LEVEL_DOTS[x.level]}{" "}
          <span className={x.basis === "reported" ? "text-green-300" : "text-gray-400"}>{x.basis === "reported" ? "report-backed" : "model signal"}</span>
        </p>
      ))}
    </div>
  );
}

function FlagCard({ f }: { f: BasisFlag }) {
  const under = f.direction === "under";
  return (
    <div className={`rounded-lg border p-3 space-y-1 ${under ? "border-amber-800 bg-amber-900/10" : "border-purple-800 bg-purple-900/10"}`}>
      <div className="flex justify-between gap-2 flex-wrap">
        <p className={`text-xs font-semibold ${under ? "text-amber-200" : "text-purple-200"}`}>{under ? "▼" : "▲"} {f.title}</p>
        <p className="text-[10px] text-gray-400">{LEVEL_DOTS[f.level]} {f.level} · <span className={f.basis === "reported" ? "text-green-300" : ""}>{f.basis === "reported" ? "report-backed" : "model signal"}</span></p>
      </div>
      <p className="text-xs text-gray-300 leading-snug">{f.text}</p>
    </div>
  );
}

function Detail({ a, canRecord, onClose, onRecorded }: { a: BasisAssessment; canRecord: boolean; onClose: () => void; onRecorded: () => void }) {
  const [reports, setReports] = useState<LossReport[]>([]);
  const [pct, setPct] = useState("");
  const [cause, setCause] = useState<string>("excess_rain");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const loadReports = useCallback(() => listLossReports(a.farm_id).then(setReports).catch(() => setReports([])), [a.farm_id]);
  useEffect(() => { loadReports(); }, [loadReports]);

  async function submit() {
    const v = Number(pct);
    if (pct === "" || isNaN(v) || v < 0 || v > 100) { setErr("Enter the loss as a percentage from 0 to 100."); return; }
    setBusy(true); setErr(null);
    try { await addLossReport({ farm_id: a.farm_id, loss_pct: v, cause, observed_on: on, note }); setPct(""); setNote(""); await loadReports(); onRecorded(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  // Payout curve against rainfall, with the estimate, its range, the trigger and the reported loss.
  const pol = a.policy, trig = a.trigger.threshold, full = a.trigger.full, mu = a.rain.estimate;
  let chart = null;
  if (pol && trig != null && full != null && mu != null) {
    const max = Math.max(full * 1.3, (a.rain.upper ?? mu) * 1.1);
    const xs = Array.from({ length: 61 }, (_, i) => (i / 60) * max);
    const pay = (r: number) => pol.sum_insured * Math.min(1, Math.max(0, (r - trig) / (full - trig)));
    chart = (
      <LineChart xs={xs} height={210} yUnit="₹" xLabel="rainfall (mm/hr)" xFormat={(x) => x.toFixed(0)}
        series={[{ id: "pay", label: "Payout at this rainfall", values: xs.map(pay), color: "#22d3ee", width: 2.2 },
                 ...(a.loss ? [{ id: "loss", label: `Reported loss (${a.loss.pct}% of sum insured)`, values: xs.map(() => (pol.sum_insured * a.loss!.pct) / 100), color: "#f472b6", dash: "5 3", width: 1.6 }] : [])]}
        ranges={[{ from: a.rain.lower ?? mu, to: a.rain.upper ?? mu, color: "#22d3ee", label: "likely rain range" }]}
        vlines={[{ x: trig, label: "trigger", color: "#fbbf24" }, { x: full, label: "full", color: "#4ade80" }, { x: mu, label: "estimate", color: "#e2e8f0" }]} />
    );
  }

  return (
    <aside className="lg:col-span-2 bg-navy-800 border border-navy-700 rounded-xl p-4 space-y-4 lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-white font-semibold">{a.name}</p>
          <p className="text-[11px] text-gray-400">{a.farmer} · {a.crop ?? "crop n/a"} · {a.area_ha ?? "?"} ha</p>
          <p className="text-[11px] text-gray-500">{a.centre ? `${a.centre[1].toFixed(5)}, ${a.centre[0].toFixed(5)}` : ""}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-lg leading-none">×</button>
      </div>
      <div className="flex gap-3 text-xs">
        <Link to={`/insurer/command?farm=${a.farm_id}`} className="text-cyan-300 hover:underline">Open on map →</Link>
        <Link to="/insurer/claims" className="text-cyan-300 hover:underline">Claims →</Link>
      </div>

      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Indicators</p>
        {a.flags.length === 0 && <p className="text-xs text-green-300">No basis-risk indicator raised for this scenario.</p>}
        {a.flags.map((f) => <FlagCard key={f.id} f={f} />)}
      </section>

      {chart && <section className="space-y-1"><p className="text-[11px] uppercase tracking-wide text-gray-400">Where this farm sits on its payout curve</p>{chart}</section>}

      <section className="grid grid-cols-2 gap-2 text-xs">
        <Fact label="Estimated rain" v={mu == null ? "n/a" : `${mu.toFixed(1)} ± ${a.rain.sigma.toFixed(1)} mm/hr`} />
        <Fact label="Trigger → full" v={trig == null ? "n/a" : `${trig} → ${full} mm/hr`} />
        <Fact label="Sensor trust" v={a.rain.sensor_confidence == null ? "n/a" : `${Math.round(a.rain.sensor_confidence * 100)}%`} />
        <Fact label="Farm risk / flood" v={`${a.risk ?? "n/a"} · ${a.flood_probability == null ? "n/a" : Math.round(a.flood_probability * 100) + "%"}`} />
        <Fact label="Sum insured" v={pol ? inr(pol.sum_insured) : "no policy"} />
        <Fact label="Payout now" v={a.payout.outcome ? `${a.payout.outcome} ${inr(a.payout.amount)}` : "n/a"} />
      </section>

      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wide text-gray-400">Loss reports ({reports.length})</p>
        {reports.length === 0 && <p className="text-xs text-gray-400">No loss has been reported for this farm. Without one, indicators use model signals only.</p>}
        <ul className="space-y-1.5">
          {reports.slice(0, 4).map((r) => (
            <li key={r.id} className="text-xs rounded-lg border border-white/10 px-3 py-1.5">
              <b className="text-white">{r.loss_pct}%</b> <span className="text-gray-400">· {r.cause.replace(/_/g, " ")} · {r.observed_on} · {r.source === "farmer" ? "reported by farmer" : "field record"}</span>
              {r.note && <p className="text-gray-300">“{r.note}”</p>}
            </li>
          ))}
        </ul>
        {canRecord && (
          <div className="rounded-lg border border-white/10 p-3 space-y-2">
            <p className="text-xs text-gray-300 font-medium">Record a field observation</p>
            <div className="grid grid-cols-2 gap-2">
              <input value={pct} onChange={(e) => setPct(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="Crop loss % (0-100)"
                className="bg-navy border border-navy-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500" />
              <input type="date" value={on} onChange={(e) => setOn(e.target.value)} className="bg-navy border border-navy-700 rounded-lg px-2.5 py-1.5 text-xs text-white" />
              <select value={cause} onChange={(e) => setCause(e.target.value)} className="col-span-2 bg-navy border border-navy-700 rounded-lg px-2.5 py-1.5 text-xs text-white">
                {CAUSES.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
              </select>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Note (optional)"
                className="col-span-2 bg-navy border border-navy-700 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-500" />
            </div>
            {err && <p className="text-xs text-red-300">{err}</p>}
            <button disabled={busy} onClick={submit} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-brand-blue text-white disabled:opacity-50">{busy ? "Saving…" : "Save observation"}</button>
            <p className="text-[10px] text-gray-500">This only feeds the indicators. It does not create, change or pay a claim.</p>
          </div>
        )}
      </section>
    </aside>
  );
}

function Fact({ label, v }: { label: string; v: string }) {
  return <div className="rounded-lg border border-white/10 px-2.5 py-1.5"><p className="text-[10px] text-gray-400">{label}</p><p className="text-white">{v}</p></div>;
}
