import { useState } from "react";
import { Link } from "react-router-dom";
import { AgentRun, QueuedClaim, queueAgentClaims } from "../../../api/agents";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const STATUS: Record<string, { label: string; cls: string }> = {
  ready_for_approval: { label: "Ready for approval", cls: "bg-green-500/15 text-green-700 border-green-200" },
  needs_investigation: { label: "Needs investigation", cls: "bg-amber-500/15 text-amber-700 border-amber-200" },
  blocked: { label: "Blocked", cls: "bg-red-500/15 text-red-700 border-red-200" },
  no_action: { label: "No action", cls: "bg-slate-500/15 text-ink-soft border-line-strong" },
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
    <div className="absolute top-3 left-3 bottom-24 z-20 w-[380px] max-w-[calc(100%-1.5rem)] rounded-xl border border-line bg-surface/95 backdrop-blur-md shadow-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line">
        <div>
          <p className="text-ink text-sm font-semibold">Agent investigation</p>
          <p className="text-[10px] text-ink-muted">Investigate → explain → recommend. The claim engine sets amounts; a person decides.</p>
        </div>
        <button onClick={onClose} className="text-ink-muted hover:text-ink px-1">✕</button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3 text-xs">
        {running && <p className="text-accent animate-pulse">The four agents are working on the current storm…</p>}
        {error && <p className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2">{error}</p>}

        {run && (
          <>
            <div className="flex flex-wrap items-center gap-2 text-[10px]">
              <span className="px-2 py-0.5 rounded-full border border-line text-ink-soft">event {run.event_id}</span>
              <span className={`px-2 py-0.5 rounded-full border ${run.llm.used ? "border-purple-200 text-purple-700 bg-purple-500/10" : "border-line-strong text-ink-soft"}`}>
                {run.llm.used ? `explained by ${run.llm.model}` : run.llm.configured ? "model unavailable, templated text" : "no LLM key, templated text"}
              </span>
              <span className="text-ink-faint">{run.elapsed_ms} ms</span>
            </div>

            {run.agents.map((a, i) => (
              <div key={a.name} className="rounded-xl border border-line bg-sunken p-2.5">
                <p className="text-accent font-semibold">{i + 1}. {a.name} Agent</p>
                <p className="text-ink-soft mt-1 leading-snug">{a.summary}</p>
                {a.concerns.map((c, j) => <p key={j} className="text-amber-700/90 mt-1">• {c}</p>)}
              </div>
            ))}

            <div className="rounded-lg border border-line p-2.5">
              <p className="text-ink font-semibold mb-1.5">Per-farm outcome</p>
              {run.compliance.farms.length === 0 && <p className="text-ink-muted">No farm needs a decision for this storm.</p>}
              <div className="space-y-2">
                {run.compliance.farms.map((f) => {
                  const rec = run.recommendations.find((r) => r.farm_id === f.farm_id);
                  const st = STATUS[f.status];
                  return (
                    <div key={f.farm_id} className="border-b border-line last:border-0 pb-2 last:pb-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-ink">{f.farm}</span>
                        <span className="text-ink-soft">{f.outcome} · {inr(f.amount)}</span>
                      </div>
                      <span className={`inline-block mt-1 px-1.5 py-0.5 rounded-full border text-[10px] ${st.cls}`}>{st.label}</span>
                      {rec && <p className="text-ink-muted mt-1 leading-snug">{rec.explanation}</p>}
                      {f.flags.map((fl, i) => <p key={i} className="text-amber-700/90 mt-0.5">⚑ {fl}</p>)}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-line p-2.5">
              <button onClick={() => setShowTrace((v) => !v)} className="w-full flex justify-between text-ink font-semibold">
                <span>Trace: tool calls and hand-offs ({run.trace.length})</span><span className="text-ink-muted">{showTrace ? "−" : "+"}</span>
              </button>
              {showTrace && (
                <ol className="mt-2 space-y-1">
                  {run.trace.map((t) => (
                    <li key={t.n} className={`leading-snug ${t.kind === "handoff" ? "text-accent" : t.kind === "error" ? "text-red-700" : "text-ink-soft"}`}>
                      <span className="mr-1">{KIND_ICON[t.kind]}</span>
                      <span className="text-ink-faint">{t.agent.split(" ")[0]} ·</span> <b>{t.name}</b> <span className="text-ink-muted">{t.detail}</span>
                      {t.ms != null && <span className="text-ink-faint"> ({t.ms} ms)</span>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </>
        )}
      </div>

      {run && (
        <div className="border-t border-line p-3 space-y-2">
          {qError && <p className="text-red-700 text-xs">{qError}</p>}
          {queued ? (
            <div className="text-xs text-green-700">
              ✓ {queued.filter((q) => q.created).length} claim(s) sent to the claims queue
              {queued.some((q) => !q.created) && ` (${queued.filter((q) => !q.created).length} already existed)`}.{" "}
              <Link to="/insurer/claims" className="underline text-accent">Review and approve →</Link>
            </div>
          ) : (
            <>
              <button disabled={!awaiting || queueing} onClick={queue}
                className="w-full bg-accent text-white font-semibold text-sm py-2 rounded-full disabled:opacity-40">
                {queueing ? "Sending…" : awaiting ? `Send ${run.compliance.needs_human} claim(s) to review queue` : run.approval_status === "blocked" ? "Blocked, re-run the investigation" : "Nothing to review"}
              </button>
              <p className="text-[10px] text-ink-faint">This creates claims awaiting your decision. Nothing is approved or paid automatically.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
