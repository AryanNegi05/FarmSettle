import { useRef, useState } from "react";

/** Small dependency-free SVG charts in the app's dark theme. */

export interface LineSeries { id: string; label: string; values: (number | null)[]; color: string; dash?: string; width?: number; opacity?: number }
export interface XRange { from: number; to: number; color: string; label?: string }
export interface VLine { x: number; label?: string; color: string }
export interface Dot { x: number; y: number; color: string; r?: number; title?: string }

const PAD = { l: 38, r: 10, t: 10, b: 22 };

export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export function LineChart({ xs, series, ranges = [], vlines = [], dots = [], height = 220, yUnit = "", xLabel, xFormat, yMax }: {
  xs: number[]; series: LineSeries[]; ranges?: XRange[]; vlines?: VLine[]; dots?: Dot[]; height?: number;
  yUnit?: string; xLabel?: string; xFormat?: (x: number) => string; yMax?: number;
}) {
  const W = 600, H = height;
  const ref = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const x0 = xs[0], x1 = xs[xs.length - 1];
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const top = yMax ?? niceMax(Math.max(...all, ...dots.map((d) => d.y), 1) * 1.08);
  const sx = (x: number) => PAD.l + ((x - x0) / Math.max(1e-9, x1 - x0)) * (W - PAD.l - PAD.r);
  const sy = (y: number) => H - PAD.b - (Math.min(y, top) / top) * (H - PAD.t - PAD.b);
  const fmtX = xFormat ?? ((x: number) => String(x));
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  const xTickIdx = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(f * (xs.length - 1)));

  function move(e: React.MouseEvent) {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const f = (px - PAD.l) / (W - PAD.l - PAD.r);
    setHover(Math.max(0, Math.min(xs.length - 1, Math.round(f * (xs.length - 1)))));
  }
  const path = (vals: (number | null)[]) => {
    let d = "", pen = false;
    vals.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? "L" : "M"}${sx(xs[i]).toFixed(1)},${sy(v).toFixed(1)} `; pen = true; });
    return d;
  };

  return (
    <div className="relative">
      <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="w-full select-none" onMouseMove={move} onMouseLeave={() => setHover(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="#334155" strokeWidth={0.6} strokeDasharray={t === 0 ? "" : "2 3"} />
            <text x={PAD.l - 5} y={sy(t) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{t >= 10 ? Math.round(t) : t.toFixed(1)}</text>
          </g>
        ))}
        {ranges.map((r, i) => (
          <g key={i}>
            <rect x={sx(r.from)} width={Math.max(2, sx(r.to) - sx(r.from))} y={PAD.t} height={H - PAD.t - PAD.b} fill={r.color} opacity={0.16} />
            {r.label && <text x={sx(r.from) + 2} y={PAD.t + 9} fontSize={8} fill={r.color}>{r.label}</text>}
          </g>
        ))}
        {vlines.map((v, i) => (
          <g key={i}>
            <line x1={sx(v.x)} x2={sx(v.x)} y1={PAD.t} y2={H - PAD.b} stroke={v.color} strokeWidth={1} strokeDasharray="3 3" />
            {v.label && <text x={sx(v.x) - 3} y={PAD.t + 8} textAnchor="end" fontSize={8} fill={v.color}>{v.label}</text>}
          </g>
        ))}
        {series.map((s) => (
          <path key={s.id} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.6} strokeDasharray={s.dash}
            opacity={s.opacity ?? 1} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {dots.map((d, i) => (
          <circle key={i} cx={sx(d.x)} cy={sy(d.y)} r={d.r ?? 3.5} fill={d.color} stroke="#0f172a" strokeWidth={1}><title>{d.title}</title></circle>
        ))}
        {xTickIdx.map((i) => (
          <text key={i} x={sx(xs[i])} y={H - 7} textAnchor="middle" fontSize={9} fill="#94a3b8">{fmtX(xs[i])}</text>
        ))}
        {xLabel && <text x={W - PAD.r} y={H - 1} textAnchor="end" fontSize={8} fill="#64748b">{xLabel}</text>}
        {hover != null && <line x1={sx(xs[hover])} x2={sx(xs[hover])} y1={PAD.t} y2={H - PAD.b} stroke="#e2e8f0" strokeWidth={0.8} opacity={0.6} />}
        {hover != null && series.map((s) => s.values[hover] != null && (
          <circle key={s.id} cx={sx(xs[hover])} cy={sy(s.values[hover] as number)} r={2.6} fill={s.color} />
        ))}
      </svg>
      {hover != null && (
        <div className="absolute top-1 right-2 text-[10px] bg-slate-900/90 border border-white/10 rounded px-2 py-1 pointer-events-none space-y-0.5">
          <p className="text-gray-400">{fmtX(xs[hover])}</p>
          {series.filter((s) => s.values[hover] != null).map((s) => (
            <p key={s.id} style={{ color: s.color }}>{s.label}: <b>{(s.values[hover] as number).toFixed(2)}</b> {yUnit}</p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-400 mt-1">
        {series.map((s) => (
          <span key={s.id}><i className="inline-block w-3 h-0.5 align-middle mr-1" style={{ background: s.color, opacity: s.opacity ?? 1 }} />{s.label}</span>
        ))}
        {ranges.filter((r) => r.label).map((r, i) => (
          <span key={`r${i}`}><i className="inline-block w-2.5 h-2.5 align-middle mr-1 rounded-sm" style={{ background: r.color, opacity: 0.4 }} />{r.label}</span>
        ))}
      </div>
    </div>
  );
}

/** Horizontal diverging bars: positive pushes toward a class, negative pushes away. */
export function DivergingBars({ rows, unit = "" }: {
  rows: { key: string; label: string; right?: string; value: number; muted?: boolean; title?: string }[]; unit?: string;
}) {
  const max = Math.max(0.5, ...rows.map((r) => Math.abs(r.value)));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.key} title={r.title} className={r.muted ? "opacity-45" : ""}>
          <div className="flex justify-between text-[11px] gap-2">
            <span className="text-gray-200 truncate">{r.label}</span>
            <span className="text-gray-400 shrink-0">{r.right}</span>
          </div>
          <div className="relative h-2.5 bg-slate-800 rounded">
            <div className="absolute inset-y-0 left-1/2 w-px bg-slate-500" />
            <div className={`absolute inset-y-0 rounded ${r.value >= 0 ? "bg-red-400/80 left-1/2" : "bg-cyan-400/80 right-1/2"}`}
              style={{ width: `${(Math.abs(r.value) / max) * 50}%` }} />
          </div>
          <p className="text-[10px] text-gray-500 text-right">{r.value >= 0 ? "+" : ""}{r.value.toFixed(2)}{unit}</p>
        </li>
      ))}
    </ul>
  );
}

/** Scatter with labelled axes and an optional diagonal reference. Points can be solid or hollow. */
export interface ScatterPoint { id: string; x: number; y: number; color: string; hollow?: boolean; r?: number; label: string }
export function Scatter({ points, xLabel, yLabel, height = 260, diagonal, selectedId, onSelect, xMax = 100, yMax = 100 }: {
  points: ScatterPoint[]; xLabel: string; yLabel: string; height?: number; diagonal?: boolean;
  selectedId?: string | null; onSelect?: (id: string) => void; xMax?: number; yMax?: number;
}) {
  const W = 600, H = height, P = { l: 42, r: 12, t: 10, b: 32 };
  const sx = (v: number) => P.l + (Math.min(v, xMax) / xMax) * (W - P.l - P.r);
  const sy = (v: number) => H - P.b - (Math.min(v, yMax) / yMax) * (H - P.t - P.b);
  const [tip, setTip] = useState<ScatterPoint | null>(null);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={P.l} x2={W - P.r} y1={sy((t / 100) * yMax)} y2={sy((t / 100) * yMax)} stroke="#334155" strokeWidth={0.6} strokeDasharray="2 3" />
            <text x={P.l - 5} y={sy((t / 100) * yMax) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{Math.round((t / 100) * yMax)}</text>
            <text x={sx((t / 100) * xMax)} y={H - P.b + 12} textAnchor="middle" fontSize={9} fill="#94a3b8">{Math.round((t / 100) * xMax)}</text>
          </g>
        ))}
        {diagonal && <line x1={sx(0)} y1={sy(0)} x2={sx(Math.min(xMax, yMax))} y2={sy(Math.min(xMax, yMax))} stroke="#64748b" strokeWidth={1} strokeDasharray="4 3" />}
        {diagonal && <text x={sx(Math.min(xMax, yMax) * 0.62)} y={sy(Math.min(xMax, yMax) * 0.62) - 6} fontSize={8} fill="#64748b" transform="" >payout = loss</text>}
        <text x={(P.l + W - P.r) / 2} y={H - 3} textAnchor="middle" fontSize={9} fill="#94a3b8">{xLabel}</text>
        <text transform={`translate(10 ${(P.t + H - P.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={9} fill="#94a3b8">{yLabel}</text>
        {points.map((p) => (
          <circle key={p.id} cx={sx(p.x)} cy={sy(p.y)} r={(p.r ?? 5) + (p.id === selectedId ? 2 : 0)}
            fill={p.hollow ? "none" : p.color} fillOpacity={p.hollow ? 0 : 0.85} stroke={p.id === selectedId ? "#fff" : p.color} strokeWidth={p.hollow ? 1.8 : 1}
            className="cursor-pointer" onMouseEnter={() => setTip(p)} onMouseLeave={() => setTip(null)} onClick={() => onSelect?.(p.id)} />
        ))}
      </svg>
      {tip && <div className="absolute top-1 left-12 text-[10px] bg-slate-900/90 border border-white/10 rounded px-2 py-1 pointer-events-none">{tip.label}</div>}
    </div>
  );
}
