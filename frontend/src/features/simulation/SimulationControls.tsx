/**
 * Simulation control panel: scenario selector, play/pause/reset/step,
 * tick progress bar, and a live gauge-reading summary table.
 */
import { ScenarioInfo, SimulationRun, SimulationSnapshot, GaugeReading } from "../../api/simulation";
import { UseSimulationReturn } from "../../hooks/useSimulation";
import type { UseSensorTrustReturn } from "../../hooks/useSensorTrust";
import type { UseRiskReturn } from "../../hooks/useRisk";
import SensorTrustPanel from "../sensors/SensorTrustPanel";
import FarmRiskPanel from "../risk/FarmRiskPanel";

interface Props {
  sim: UseSimulationReturn;
  /** Whether the panel is collapsed (map-only view). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  /** sensor fault-detection state. When provided, a Sensor Health
   *  control section is rendered at the bottom of the sidebar. */
  sensorTrust?: UseSensorTrustReturn;
  onSensorSelect?: (sensorId: string) => void;
  /** farm-level risk assessment state. */
  risk?: UseRiskReturn;
  selectedFarmId?: string | null;
}

export default function SimulationControls({
  sim,
  collapsed,
  onToggleCollapse,
  sensorTrust,
  onSensorSelect,
  risk,
  selectedFarmId,
}: Props) {
  const { scenarios, selectedPreset, setSelectedPreset, run, snapshot, status, error, startNew, control } = sim;

  const pct = run ? Math.round((run.current_tick / Math.max(run.total_ticks - 1, 1)) * 100) : 0;
  const isRunning = status === "running";
  const isComplete = status === "complete";

  return (
    <div className="flex flex-col bg-surface border-l border-line w-80 flex-shrink-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-line bg-sunken/50">
        <div className="flex items-center gap-2">
          <span className="text-base">🌪️</span>
          <span className="text-sm font-semibold text-ink">Simulation</span>
          <StatusPill status={status} />
        </div>
        {onToggleCollapse && (
          <button onClick={onToggleCollapse} className="text-ink-muted hover:text-ink text-sm transition">
            {collapsed ? "▶" : "◀"}
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs">{error}</div>
        )}

        {/* Scenario selector */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Scenario</label>
          <select
            className="w-full bg-paper border border-line-strong text-ink text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-accent"
            value={selectedPreset}
            onChange={e => setSelectedPreset(e.target.value as any)}
            disabled={isRunning}
          >
            {scenarios.map(s => (
              <option key={s.preset} value={s.preset}>{s.label}</option>
            ))}
          </select>
          {scenarios.find(s => s.preset === selectedPreset) && (
            <p className="text-xs text-ink-faint">
              {scenarios.find(s => s.preset === selectedPreset)!.description}
            </p>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={startNew}
            disabled={status === "loading" || isRunning}
            className="flex-1 bg-accent text-white text-xs font-semibold px-3 py-2 rounded-full hover:opacity-90 disabled:opacity-40 transition"
          >
            {run ? "New Sim" : "Start Sim"}
          </button>
          {run && (
            <>
              <button
                onClick={() => control(isRunning ? "pause" : "start")}
                disabled={isComplete || status === "loading"}
                className="flex-1 bg-sunken text-ink text-xs font-semibold px-3 py-2 rounded-lg hover:bg-line disabled:opacity-40 transition"
              >
                {isRunning ? "⏸ Pause" : "▶ Play"}
              </button>
              <button
                onClick={() => control("step")}
                disabled={isRunning || isComplete}
                className="bg-sunken text-ink text-xs font-semibold px-3 py-2 rounded-lg hover:bg-line disabled:opacity-40 transition"
              >
                ⏭ Step
              </button>
              <button
                onClick={() => control("reset")}
                className="bg-sunken text-ink text-xs font-semibold px-3 py-2 rounded-lg hover:bg-line transition"
              >
                ↺ Reset
              </button>
            </>
          )}
        </div>

        {/* Progress bar */}
        {run && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-ink-muted">
              <span>Hour {run.current_tick} of {run.total_ticks - 1}</span>
              <span>{pct}%</span>
            </div>
            <div className="w-full bg-sunken rounded-full h-2 overflow-hidden">
              <div
                className="h-2 rounded-full bg-accent transition-all duration-500"
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}

        {/* Flood alert */}
        {snapshot?.flood_active && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-lg">🌊</span>
            <div>
              <p className="text-red-700 text-xs font-semibold">Flood Event Active</p>
              <p className="text-red-700 text-xs">
                Intensity: {Math.round(snapshot.flood_intensity * 100)}% ·{" "}
                <span className="italic">Simulated overlay</span>
              </p>
            </div>
          </div>
        )}

        {/* Storm cell */}
        {snapshot && snapshot.storm_cells.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <span className="text-lg">⛈</span>
            <div>
              <p className="text-yellow-700 text-xs font-semibold">Storm Cell Active</p>
              <p className="text-yellow-500 text-xs">
                Peak {snapshot.storm_cells[0].peak_mm_hr.toFixed(1)} mm/hr ·{" "}
                <span className="italic">Simulated</span>
              </p>
            </div>
          </div>
        )}

        {/* Gauge readings table */}
        {snapshot && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">
              Gauge Readings — Tick {snapshot.tick}
            </p>
            <div className="bg-paper rounded-lg overflow-hidden border border-line">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-line text-ink-faint">
                    <th className="px-2 py-1.5 text-left font-medium">ID</th>
                    <th className="px-2 py-1.5 text-left font-medium">Type</th>
                    <th className="px-2 py-1.5 text-right font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.gauge_readings.map(r => (
                    <GaugeRow key={r.sensor_id} reading={r} />
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-ink-faint italic">All readings are simulated demo data.</p>
          </div>
        )}

        {/* Sensor fault detection & trust scoring */}
        {sensorTrust && (
          <SensorTrustPanel
            runId={run?.id ?? null}
            tick={run?.current_tick ?? 0}
            sensorTrust={sensorTrust}
            onSensorSelect={onSensorSelect}
          />
        )}

        {/* Farm Risk Assessment */}
        {risk && (
          <FarmRiskPanel
            runId={run?.id ?? null}
            tick={run?.current_tick ?? 0}
            risk={risk}
            selectedFarmId={selectedFarmId ?? null}
          />
        )}
      </div>
    </div>
  );
}

function GaugeRow({ reading }: { reading: GaugeReading }) {
  const isRain = reading.sensor_type === "rainfall";
  const high = isRain ? reading.value > 50 : reading.value > 230;
  return (
    <tr className={`border-b border-line ${reading.is_faulty ? "bg-red-50" : ""}`}>
      <td className="px-2 py-1 font-mono text-ink-soft">
        {reading.sensor_id}
        {reading.is_faulty && <span className="ml-1 text-red-700">⚠</span>}
      </td>
      <td className="px-2 py-1 text-ink-faint capitalize">
        {isRain ? "🌧" : "💧"} {reading.sensor_type.replace("_", " ")}
      </td>
      <td className={`px-2 py-1 text-right font-mono ${high ? "text-red-700 font-semibold" : "text-ink-soft"}`}>
        {reading.value.toFixed(1)} {reading.unit}
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    idle:     "bg-sunken text-ink-muted",
    loading:  "bg-yellow-50 text-yellow-700",
    paused:   "bg-sunken text-ink-soft",
    running:  "bg-green-50 text-green-700 animate-pulse",
    complete: "bg-blue-50 text-accent",
    error:    "bg-red-50 text-red-700",
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border border-transparent capitalize ${styles[status] ?? styles.idle}`}>
      {status}
    </span>
  );
}
