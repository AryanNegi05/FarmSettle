import { useState } from "react";
import type { CCLand, CCPreset, CCSensor, CCStorm, FaultType } from "../../../api/command";

export interface Controls {
  district: number;
  storm: CCStorm | null;
  faults: Record<string, FaultType>;
  overrides: Record<string, number>;
  farmAdjust: Record<string, number>;
  sensorCount: number;
}

interface Props {
  land: CCLand | null;
  controls: Controls;
  setControls: (u: (c: Controls) => Controls) => void;
  presets: CCPreset[];
  activePreset: string | null;
  onPreset: (p: CCPreset) => void;
  sensors: CCSensor[];
  selectedSensor: CCSensor | null;
  placingStorm: boolean;
  setPlacingStorm: (v: boolean) => void;
  tl: number | null;
  playing: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  onScrub: (v: number) => void;
}

const FAULTS: FaultType[] = ["spike", "stuck", "dead", "drift"];

function Slider({ label, value, min, max, step = 1, unit, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <div className="flex justify-between text-xs text-ink-soft">
        <span>{label}</span><span className="text-accent font-mono">{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-cyan-400" />
    </label>
  );
}

export default function ControlsPanel(p: Props) {
  const { controls: c, setControls } = p;
  const [faultSensor, setFaultSensor] = useState("");
  const [faultType, setFaultType] = useState<FaultType>("spike");
  const [override, setOverride] = useState("");
  const rainSensors = p.sensors.filter((s) => s.type === "rainfall");
  const stormOn = c.storm !== null;

  return (
    <div className="space-y-4 text-sm">
      <section>
        <p className="text-[11px] uppercase tracking-wider text-ink-muted mb-1">Scenario presets</p>
        <div className="grid grid-cols-2 gap-1.5">
          {p.presets.map((pr) => (
            <button key={pr.id} onClick={() => p.onPreset(pr)}
              className={`text-xs px-2 py-1.5 rounded-lg border transition ${p.activePreset === pr.id
                ? "bg-accent-soft border-accent text-accent" : "border-line text-ink-soft hover:bg-sunken"}`}>
              {pr.label}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-ink-muted">Rainfall</p>
        <Slider label="District-wide intensity" value={c.district} min={0} max={100} unit=" mm/hr"
          onChange={(v) => setControls((x) => ({ ...x, district: v }))} />
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          <input type="checkbox" checked={stormOn}
            disabled={!p.land}
            onChange={(e) => setControls((x) => ({
              ...x,
              // Default position and size come from the land itself (its centre and extent), not fixed places.
              storm: e.target.checked && p.land
                ? { peak_mm_hr: 80, radius_m: Math.round(Math.max(p.land.width_m, p.land.height_m) * 0.12), lat: p.land.centre[1], lng: p.land.centre[0] }
                : null,
            }))} />
          Localised storm
        </label>
        {c.storm && (
          <div className="space-y-2 pl-4 border-l border-line">
            <Slider label="Storm intensity" value={c.storm.peak_mm_hr} min={10} max={200} unit=" mm/hr"
              onChange={(v) => setControls((x) => x.storm ? { ...x, storm: { ...x.storm, peak_mm_hr: v } } : x)} />
            <Slider label="Storm radius (1σ)" value={c.storm.radius_m} min={20} max={600} step={10} unit=" m"
              onChange={(v) => setControls((x) => x.storm ? { ...x, storm: { ...x.storm, radius_m: v } } : x)} />
            <button onClick={() => p.setPlacingStorm(!p.placingStorm)}
              className={`text-xs px-2 py-1 rounded-xl border ${p.placingStorm ? "bg-amber-500/20 border-amber-400 text-amber-700" : "border-line text-ink-soft hover:bg-sunken"}`}>
              {p.placingStorm ? "Click the map to place…" : "Place storm on map"}
            </button>
            <p className="text-[11px] text-ink-faint">Centre {c.storm.lat.toFixed(3)}, {c.storm.lng.toFixed(3)}</p>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-ink-muted">Sensors</p>
        <Slider label="Total sensors (rain + water gauges)" value={c.sensorCount} min={6} max={40}
          onChange={(v) => setControls((x) => ({ ...x, sensorCount: v }))} />
        <div className="flex gap-1.5">
          <select value={faultSensor} onChange={(e) => setFaultSensor(e.target.value)}
            className="flex-1 bg-sunken border border-line rounded-xl px-2 py-1 text-xs text-ink">
            <option value="">Inject fault on…</option>
            {rainSensors.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}
          </select>
          <select value={faultType} onChange={(e) => setFaultType(e.target.value as FaultType)}
            className="bg-sunken border border-line rounded-xl px-2 py-1 text-xs text-ink">
            {FAULTS.map((f) => <option key={f}>{f}</option>)}
          </select>
          <button disabled={!faultSensor} onClick={() => setControls((x) => ({ ...x, faults: { ...x.faults, [faultSensor]: faultType } }))}
            className="text-xs px-2 rounded-lg bg-red-500/80 text-ink disabled:opacity-40">Inject</button>
        </div>
        {Object.keys(c.faults).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {Object.entries(c.faults).map(([id, t]) => (
              <button key={id} title="Remove fault" onClick={() => setControls((x) => {
                const f = { ...x.faults }; delete f[id]; return { ...x, faults: f };
              })} className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/20 text-red-700 border border-red-200">
                {id}: {t} ×
              </button>
            ))}
          </div>
        )}
        {p.selectedSensor && (
          <div className="bg-sunken border border-line rounded-xl p-2 space-y-1">
            <p className="text-xs text-ink">{p.selectedSensor.id} · {p.selectedSensor.type.replace("_", " ")}</p>
            <p className="text-[11px] text-ink-muted">
              {p.selectedSensor.value} {p.selectedSensor.unit} · {p.selectedSensor.classification} ({Math.round(p.selectedSensor.confidence * 100)}%) · trust {p.selectedSensor.trust.toFixed(2)}
            </p>
            <div className="flex gap-1.5">
              <input value={override} onChange={(e) => setOverride(e.target.value)} placeholder="Set reading"
                className="flex-1 bg-sunken border border-line rounded px-2 py-1 text-xs text-ink" />
              <button disabled={isNaN(parseFloat(override))}
                onClick={() => setControls((x) => ({ ...x, overrides: { ...x.overrides, [p.selectedSensor!.id]: parseFloat(override) } }))}
                className="text-xs px-2 rounded bg-accent text-white disabled:opacity-40">Apply</button>
              {p.selectedSensor.id in c.overrides && (
                <button onClick={() => setControls((x) => { const o = { ...x.overrides }; delete o[p.selectedSensor!.id]; return { ...x, overrides: o }; })}
                  className="text-xs px-2 rounded border border-line text-ink-soft">Clear</button>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <p className="text-[11px] uppercase tracking-wider text-ink-muted">Storm timeline</p>
        <div className="flex gap-1.5">
          <button onClick={p.playing ? p.onPause : p.onPlay}
            className="text-xs px-3 py-1 rounded-full bg-accent text-white">{p.playing ? "❚❚ Pause" : "▶ Play"}</button>
          <button onClick={p.onReset} className="text-xs px-3 py-1 rounded-xl border border-line text-ink-soft hover:bg-sunken">↺ Reset</button>
        </div>
        <Slider label="Life-cycle (build-up → peak → fade)" value={Math.round((p.tl ?? 0.5) * 100)} min={0} max={100} unit="%"
          onChange={(v) => p.onScrub(v / 100)} />
        <p className="text-[11px] text-ink-faint">{p.tl === null ? "Timeline off: sliders apply directly." : "Timeline scales district and storm rainfall by the storm life-cycle."}</p>
      </section>
    </div>
  );
}
