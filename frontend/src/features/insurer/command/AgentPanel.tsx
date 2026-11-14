import { useState } from "react";
import { Link } from "react-router-dom";
import { AgentRun, QueuedClaim, queueAgentClaims } from "../../../api/agents";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const STATUS: Record<string, { label: string; cls: string }> = {
  ready_for_approval: { label: "Ready for approval", cls: "bg-green-500/15 text-green-300 border-green-500/30" },
  needs_investigation: { label: "Needs investigation", cls: "bg-amber-500/15 text-amber-200 border-amber-500/30" },
  blocked: { label: "Blocked", cls: "bg-red-500/15 text-red-300 border-red-500/30" },
  no_action: { label: "No action", cls: "bg-slate-500/15 text-slate-300 border-slate-500/30" },
};
const KIND_ICON: Record<string, string> = { tool: "🔧", handoff: "➜", llm: "💬", note: "📝", error: "⚠️" };

export default function AgentPanel({ run, running, error, onClose }: {
  run: AgentRun | null; running: boolean; error: string | null; onClose: () => void;
}) {
  const [showTrace, setShowTrace] = useState(true);
  const [queued, setQueued] = useState<QueuedClaim[] | null>(null);
  const [queueing, setQueueing] = useState(false);
  const [qError, setQError] = useState<string | null>(null);

  async function queue() {
    if (!run) return;
    setQueueing(true); setQError(null);
    try { setQueued((await queueAgentClaims(run.id)).queued); }
    catch (e) { setQError(e instanceof Error ? e.message : "Could not queue claims"); }
    finally { setQueueing(false); }
  }

  const awaiting = run?.approval_status === "awaiting_human";
  return (
    <div className="absolute top-3 left-3 bottom-24 z-20 w-[380px] max-w-[calc(100%-1.5rem)] rounded-xl border border-white/10 bg-slate-900/95 backdrop-blur-md shadow-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
        <div>
          <p className="text-white text-sm font-semibold">Agent investigation</p>
          <p className="text-[10px] text-gray-400">Investigate → explain → recommend. The claim engine sets amounts; a person decides.</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-white px-1">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {running && <p className="text-cyan-300 animate-pulse">The four agents are working on the current storm…</p>}
        {error && <p className="rounded-lg bg-red-900/50 border border-red-700 text-red-200 px-3 py-2">{error}</p>}

        {run && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <span className="px-2 py-0.5 rounded-full border border-white/10 text-gray-300">event {run.event_id}</span>
              <span className={`px-2 py-0.5 rounded-full border ${run.llm.used ? "border-purple-500/40 text-purple-200 bg-purple-500/10" : "border-slate-500/40 text-slate-300"}`}>
                {run.llm.used ? `explained by ${run.llm.model}` : run.llm.configured ? "model unavailable, templated text" : "no LLM key, templated text"}
              </span>
              <span className="text-gray-500">{run.elapsed_ms} ms</span>
            </div>

            {run.agents.map((a, i) => (
              <div key={a.name} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
                <p className="text-cyan-300 font-semibold">{i + 1}. {a.name} Agent</p>
                <p className="text-gray-200 mt-1 leading-snug">{a.summary}</p>
                {a.concerns.map((c, j) => <p key={j} className="text-amber-200/90 mt-1">• {c}</p>)}
              </div>
            ))}

            <div className="rounded-lg border border-white/10 p-2.5">
              <p className="text-white font-semibold mb-1.5">Per-farm outcome</p>
              {run.compliance.farms.length === 0 && <p className="text-gray-400">No farm needs a decision for this storm.</p>}
              <div className="space-y-2">
                {run.compliance.farms.map((f) => {
                  const rec = run.recommendations.find((r) => r.farm_id === f.farm_id);
                  const st = STATUS[f.status];
                  return (
                    <div key={f.farm_id} className="border-b border-white/5 last:border-0 pb-2 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-white">{f.farm}</span>
                        <span className="text-gray-200">{f.outcome} · {inr(f.amount)}</span>
                      </div>
                      <span className={`inline-block mt-1 px-1.5 py-0.5 rounded-full border text-[10px] ${st.cls}`}>{st.label}</span>
                      {rec && <p className="text-gray-400 mt-1 leading-snug">{rec.explanation}</p>}
                      {f.flags.map((fl, i) => <p key={i} className="text-amber-200/90 mt-0.5">⚑ {fl}</p>)}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-white/10 p-2.5">
              <button onClick={() => setShowTrace((v) => !v)} className="w-full flex justify-between text-white font-semibold">
                <span>Trace: tool calls and hand-offs ({run.trace.length})</span><span className="text-gray-400">{showTrace ? "−" : "+"}</span>
              </button>
              {showTrace && (
                <ol className="mt-2 space-y-1">
                  {run.trace.map((t) => (
                    <li key={t.n} className={`leading-snug ${t.kind === "handoff" ? "text-cyan-200" : t.kind === "error" ? "text-red-300" : "text-gray-300"}`}>
                      <span className="mr-1">{KIND_ICON[t.kind]}</span>
                      <span className="text-gray-500">{t.agent.split(" ")[0]} ·</span> <b>{t.name}</b> <span className="text-gray-400">{t.detail}</span>
                      {t.ms != null && <span className="text-gray-600"> ({t.ms} ms)</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </div>

      {run && (
        <div className="border-t border-white/10 p-3 space-y-2">
          {qError && <p className="text-red-300 text-xs">{qError}</p>}
          {queued ? (
            <div className="text-xs text-green-300">
              ✓ {queued.filter((q) => q.created).length} claim(s) sent to the claims queue
              {queued.some((q) => !q.created) && ` (${queued.filter((q) => !q.created).length} already existed)`}.{" "}
              <Link to="/insurer/claims" className="underline text-cyan-300">Review and approve →</Link>
            </div>
          ) : (
            <>
              <button disabled={!awaiting || queueing} onClick={queue}
                className="w-full bg-brand-blue text-white font-semibold text-sm py-2 rounded-lg disabled:opacity-40">
                {queueing ? "Sending…" : awaiting ? `Send ${run.compliance.needs_human} claim(s) to review queue` : run.approval_status === "blocked" ? "Blocked, re-run the investigation" : "Nothing to review"}
              </button>
              <p className="text-[10px] text-gray-500">This creates claims awaiting your decision. Nothing is approved or paid automatically.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
