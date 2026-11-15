/**
 * Sensor Forensics Workbench: click any sensor on the map to investigate it.
 * History and neighbours are simulated; the LightGBM classification is the same one the map shows.
 * Markers and explanations are investigative indicators, not proof of a fault.
 */
import { useState } from "react";
import { ForensicsNeighbour, SensorForensics } from "../../../api/command";
import { DivergingBars, LineChart, XRange } from "../../shared/charts";

const CLASS_COLOR: Record<string, string> = {
  normal: "#4ade80", spike: "#f87171", stuck: "#fbbf24", drift: "#fb923c", dead: "#94a3b8", genuine_localised_cell: "#22d3ee",
};
const ANOMALY_COLOR: Record<string, string> = {
  spike: "#f87171", stuck: "#fbbf24", drift: "#fb923c", dead: "#94a3b8", neighbour_gap: "#a78bfa",
};
const ANOMALY_LABEL: Record<string, string> = {
  spike: "Sudden spike", stuck: "Stuck readings", drift: "Drift", dead: "Dead / zero", neighbour_gap: "Neighbour discrepancy",
};
const AGREE: Record<string, { cls: string; icon: string }> = {
  match: { cls: "border-green-200 bg-green-50 text-green-700", icon: "✓" },
  partial: { cls: "border-amber-200 bg-amber-50 text-amber-700", icon: "≈" },
  missed: { cls: "border-red-200 bg-red-50 text-red-700", icon: "✕" },
  false_alarm: { cls: "border-amber-200 bg-amber-50 text-amber-700", icon: "?" },
  clear: { cls: "border-line-strong bg-surface/50 text-ink-soft", icon: "–" },
};
const TABS = [["overview", "Overview"], ["series", "Time series"], ["neighbours", "Neighbours"], ["why", "Why flagged"]] as const;
type Tab = typeof TABS[number][0];
const pct = (v: number) => `${Math.round(v * 100)}%`;
const cn = (s: string) => s.replace(/_/g, " ");

export default function SensorPanel({ data, loading, error, onClose, onSelectSensor, onSelectFarm }: {
  data: SensorForensics | null; loading: boolean; error: string | null; onClose: () => void;
  onSelectSensor: (id: string) => void; onSelectFarm: (id: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [showNb, setShowNb] = useState(true);
  const [target, setTarget] = useState<"class" | "normal">("class");
  const cl = data?.classification;

  return (
    <div className="absolute top-[96px] right-3 bottom-24 z-20 w-[470px] max-w-[calc(100%-1.5rem)] flex flex-col rounded-2xl border border-line bg-surface/92 backdrop-blur-md shadow-2xl text-sm text-ink-soft overflow-hidden">
      <div className="flex items-start justify-between px-4 py-3 border-b border-line">
        <div>
          <p className="font-semibold text-ink">🔬 Sensor forensics · {data?.sensor.id ?? "…"}</p>
          <p className="text-[11px] text-ink-muted">
            {data ? `${data.sensor.type.replace("_", " ")} gauge · ${data.sensor.value} ${data.sensor.unit} · ${data.sensor.lat.toFixed(5)}, ${data.sensor.lng.toFixed(5)}` : "loading…"}
            {" · "}<span className="text-amber-700">simulated</span>
          </p>
        </div>
        <button onClick={onClose} className="text-ink-muted hover:text-ink text-lg leading-none">×</button>
      </div>

      <div className="flex border-b border-line text-xs">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} disabled={!data?.supported && id !== "overview" && id !== "neighbours"}
            className={`flex-1 py-2 transition disabled:opacity-30 ${tab === id ? "text-ink border-b-2 border-accent bg-sunken" : "text-ink-muted hover:text-ink"}`}>{label}</button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && <p className="text-accent animate-pulse text-xs">Investigating…</p>}
        {error && <p className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-xs">{error}</p>}

        {data && !data.supported && (
          <div className="space-y-3">
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{data.message}</p>
            <p className="text-xs text-ink-muted">Nearest water-level gauges</p>
            <ul className="text-xs space-y-1">
              {data.neighbours.map((n) => (
                <li key={n.id} className="flex justify-between"><button onClick={() => onSelectSensor(n.id)} className="text-accent hover:underline">{n.id}</button>
                  <span className="text-ink-muted">{n.distance_m} m · {"value" in n ? n.value : ""} cm</span></li>
              ))}
            </ul>
          </div>
        )}

        {data?.supported && cl && data.series && data.explanation && (
          <>
            {tab === "overview" && <Overview data={data} onSelectFarm={onSelectFarm} />}
            {tab === "series" && <Series data={data} showNb={showNb} setShowNb={setShowNb} />}
            {tab === "neighbours" && <Neighbours data={data} onSelectSensor={onSelectSensor} />}
            {tab === "why" && <Why data={data} target={target} setTarget={setTarget} />}
          </>
        )}
        {data && <p className="text-[10px] text-ink-faint leading-snug pt-1">{data.notes.join(" ")}</p>}
      </div>
    </div>
  );
}

function Bar({ label, value, color, right }: { label: string; value: number; color: string; right?: string }) {
  return (
    <div>
      <div className="flex justify-between text-[11px]"><span className="text-ink-soft">{label}</span><span className="text-ink-muted">{right ?? pct(value)}</span></div>
      <div className="h-1.5 bg-surface/90 rounded"><div className="h-full rounded" style={{ width: `${Math.round(value * 100)}%`, background: color }} /></div>
    </div>
  );
}

function Overview({ data, onSelectFarm }: { data: SensorForensics; onSelectFarm: (id: string) => void }) {
  const cl = data.classification!;
  const ag = AGREE[cl.agreement.state];
  const probs = Object.entries(cl.class_probabilities).sort((a, b) => b[1] - a[1]);
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: `${CLASS_COLOR[cl.predicted_class]}22`, color: CLASS_COLOR[cl.predicted_class], border: `1px solid ${CLASS_COLOR[cl.predicted_class]}66` }}>
            LightGBM: {cn(cl.predicted_class)}
          </span>
          <span className="text-[11px] text-ink-muted">{cl.is_flagged ? "flagged, excluded from rain estimates" : "usable evidence"}</span>
        </div>
        <Bar label="Model confidence" value={cl.confidence} color="#38bdf8" />
        <Bar label="Trust score" value={cl.trust} color={cl.trust >= 0.6 ? "#4ade80" : cl.trust >= 0.3 ? "#fbbf24" : "#f87171"} right={cl.trust.toFixed(2)} />
        <p className="text-[10px] text-ink-faint">Trust: {data.trust_breakdown?.text} (class base {data.trust_breakdown?.class_base}, confidence {pct(cl.confidence)}).</p>
        <p className="text-xs text-ink-soft">{cl.note}</p>
      </section>

      <div className={`text-xs rounded-lg border px-3 py-2 ${ag.cls}`}>
        <b>{ag.icon} Model vs simulation ground truth:</b> {cl.agreement.text}
        {cl.injected_fault && <span className="text-ink-muted"> (injected fault is known only because this is a simulation)</span>}
      </div>

      <section>
        <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1.5">Class probabilities</p>
        <div className="space-y-1.5">{probs.map(([k, v]) => <Bar key={k} label={cn(k)} value={v} color={CLASS_COLOR[k] ?? "#94a3b8"} />)}</div>
      </section>

      <section className="text-xs grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-line px-3 py-2"><p className="text-ink-muted">Satellite wet ground</p><p className="text-ink">{cl.satellite_wet ? "yes (supports a real local cell)" : "no"}</p></div>
        <div className="rounded-lg border border-line px-3 py-2"><p className="text-ink-muted">Storm track nearby</p><p className="text-ink">{cl.storm_nearby ? "yes" : "no"}</p></div>
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1.5">Anomaly markers (rule-based)</p>
        {data.anomalies!.length === 0 && <p className="text-xs text-ink-muted">No spikes, stuck readings, drift or large neighbour gaps found.</p>}
        <ul className="space-y-1.5">
          {data.anomalies!.map((a, i) => (
            <li key={i} className="text-xs flex gap-2">
              <i className="w-2.5 h-2.5 rounded-sm mt-0.5 shrink-0" style={{ background: ANOMALY_COLOR[a.type] }} />
              <span><b style={{ color: ANOMALY_COLOR[a.type] }}>{ANOMALY_LABEL[a.type]}</b> <span className="text-ink-faint">({a.severity})</span> <span className="text-ink-soft">{a.detail}</span></span>
            </li>
          ))}
        </ul>
        {!cl.is_flagged && data.anomalies!.some((a) => a.severity === "high") && (
          <p className="text-[11px] text-amber-700 mt-2">The rules found a pattern the model did not flag. Treat this gauge with caution and compare with neighbours.</p>
        )}
      </section>

      <section>
        <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1.5">Farm estimates that depend on this sensor</p>
        {data.farm_impact!.length === 0 && <p className="text-xs text-ink-muted">No registered farm uses or excludes this gauge.</p>}
        <ul className="space-y-1">
          {data.farm_impact!.map((f) => (
            <li key={f.farm_id} className="text-xs flex justify-between gap-2">
              <button onClick={() => onSelectFarm(f.farm_id)} className="text-accent hover:underline text-left">{f.farm}</button>
              <span className="text-ink-muted text-right">{f.role === "used" ? `weight ${Math.round(f.weight * 100)}%` : "excluded"} · {f.distance_m} m · {f.outcome ?? "no policy"}{f.amount ? ` ₹${Math.round(f.amount).toLocaleString("en-IN")}` : ""}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Series({ data, showNb, setShowNb }: { data: SensorForensics; showNb: boolean; setShowNb: (v: boolean) => void }) {
  const s = data.series!;
  const now = s.now_index;
  const nbs = data.neighbours as ForensicsNeighbour[];
  const ranges: XRange[] = data.anomalies!.filter((a) => a.type !== "neighbour_gap").map((a) => ({
    from: a.tick, to: a.end, color: ANOMALY_COLOR[a.type], label: ANOMALY_LABEL[a.type] }));
  const seen = new Set<string>();
  const uniqRanges = ranges.map((r) => { const first = !seen.has(r.label!); seen.add(r.label!); return first ? r : { ...r, label: undefined }; });
  const dots = data.timeline!.filter((t) => t.class !== "normal" && t.class !== "genuine_localised_cell")
    .map((t) => ({ x: t.tick, y: s.values[t.tick], color: CLASS_COLOR[t.class], r: 3.2, title: `Reading ${t.tick - now}: LightGBM says ${cn(t.class)} (${pct(t.confidence)})` }));
  return (
    <div className="space-y-3">
      <LineChart xs={s.ticks} height={230} yUnit="mm/hr" xLabel="readings (now = latest)" xFormat={(x) => (x === now ? "now" : String(x - now))}
        series={[
          ...(showNb ? nbs.map((n, i) => ({ id: n.id, label: n.id, values: n.series, color: "#64748b", opacity: 0.55 - i * 0.05, width: 1 })) : []),
          { id: "med", label: "Neighbour median", values: s.neighbour_median, color: "#94a3b8", dash: "4 3", width: 1.4 },
          { id: "own", label: data.sensor.id, values: s.values, color: "#22d3ee", width: 2.2 },
        ]}
        ranges={uniqRanges} vlines={[{ x: s.window_start, label: "classified window →", color: "#38bdf8" }]} dots={dots} />
      <label className="flex items-center gap-2 text-[11px] text-ink-muted"><input type="checkbox" checked={showNb} onChange={(e) => setShowNb(e.target.checked)} /> Show individual neighbours</label>

      <div>
        <p className="text-[11px] uppercase tracking-wide text-ink-muted mb-1">LightGBM class at each reading</p>
        <div className="flex gap-0.5">
          {data.series!.ticks.map((t) => {
            const m = data.timeline!.find((x) => x.tick === t);
            return <span key={t} title={m ? `Reading ${t - now}: ${cn(m.class)} (${pct(m.confidence)})` : "not enough history yet"}
              className="flex-1 h-4 rounded-sm" style={{ background: m ? CLASS_COLOR[m.class] : "#1e293b", opacity: m ? 0.5 + 0.5 * m.confidence : 1 }} />;
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 text-[10px] text-ink-muted mt-1">
          {Object.entries(CLASS_COLOR).map(([k, c]) => <span key={k}><i className="inline-block w-2 h-2 rounded-sm mr-1" style={{ background: c }} />{cn(k)}</span>)}
        </div>
      </div>
      <p className="text-[11px] text-ink-faint">Only the last 6 readings are classified by the map; earlier readings are a simulated lead-up so you can see how the gauge got here. Shaded bands are rule-based markers; dots are readings the model flagged.</p>
    </div>
  );
}

function Neighbours({ data, onSelectSensor }: { data: SensorForensics; onSelectSensor: (id: string) => void }) {
  if (!data.supported) return null;
  const nbs = data.neighbours as ForensicsNeighbour[];
  const s = data.series!;
  const colors = ["#a78bfa", "#f472b6", "#fbbf24", "#34d399"];
  return (
    <div className="space-y-3">
      <LineChart xs={s.ticks} height={200} yUnit="mm/hr" xFormat={(x) => (x === s.now_index ? "now" : String(x - s.now_index))}
        series={[...nbs.map((n, i) => ({ id: n.id, label: n.id, values: n.series, color: colors[i % 4], width: 1.2, opacity: 0.8 })),
                 { id: "own", label: data.sensor.id, values: s.values, color: "#22d3ee", width: 2.4 }]} />
      <table className="w-full text-[11px]">
        <thead><tr className="text-ink-muted text-left"><th className="py-1 font-medium">Gauge</th><th className="font-medium">Dist.</th><th className="font-medium">Now</th><th className="font-medium">Δ vs this</th><th className="font-medium">Corr.</th><th className="font-medium">Class · trust</th></tr></thead>
        <tbody>
          {nbs.map((n, i) => (
            <tr key={n.id} className="border-t border-line">
              <td className="py-1.5"><button onClick={() => onSelectSensor(n.id)} className="hover:underline" style={{ color: colors[i % 4] }}>{n.id}</button></td>
              <td>{n.distance_m} m</td><td>{n.now.toFixed(1)}</td>
              <td className={Math.abs(n.diff_now) > 8 ? "text-amber-700" : ""}>{n.diff_now > 0 ? "+" : ""}{n.diff_now.toFixed(1)}</td>
              <td>{n.lead_correlation ?? "n/a"}</td>
              <td><span style={{ color: CLASS_COLOR[n.class] }}>{cn(n.class)}</span> · {n.trust.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-ink-faint">Δ is this gauge minus the neighbour right now. A large gap is only a clue: a real local storm cell can also make neighbours differ. Click a gauge to investigate it.</p>
    </div>
  );
}

function Why({ data, target, setTarget }: { data: SensorForensics; target: "class" | "normal"; setTarget: (t: "class" | "normal") => void }) {
  const ex = data.explanation!;
  const set = target === "normal" && ex.vs_normal ? ex.vs_normal : ex;
  const rows = set.features.slice(0, 9).map((f) => ({
    key: f.feature, label: f.label, right: `${f.value}${f.unit ? " " + f.unit : ""}`, value: f.contribution, muted: f.fixed_default, title: f.about }));
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-soft leading-snug">{ex.why}</p>
      {ex.vs_normal && (
        <div className="flex gap-1.5 text-[11px]">
          {([["class", `Toward “${cn(ex.class)}”`], ["normal", "Toward “normal”"]] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTarget(k)} className={`px-2.5 py-1 rounded-full border ${target === k ? "bg-accent border-accent text-white" : "border-line-strong text-ink-muted hover:text-white"}`}>{label}</button>
          ))}
        </div>
      )}
      <p className="text-[11px] text-ink-muted">
        Each bar is how much one input pushed the model toward <b className="text-ink">{cn(set.class)}</b>.
        <span className="text-red-700"> Red = toward</span>, <span className="text-accent">blue = away</span>. Hover a row for what the input means.
      </p>
      <DivergingBars rows={rows} />
      {ex.features.some((f) => f.fixed_default) && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          “Position in the storm timeline” is fixed at 0.5 when classifying live readings, so it carries no real information. It is greyed out, but it can still shift the model's score. This is a known limitation of the current model.
        </p>
      )}
      <p className="text-[10px] text-ink-faint">Contributions are LightGBM's own per-feature values (SHAP-style, in log-odds) and sum to the model's score for this class together with a baseline of {set.bias.toFixed(2)}. They explain the model, not the physical cause.</p>
    </div>
  );
}
