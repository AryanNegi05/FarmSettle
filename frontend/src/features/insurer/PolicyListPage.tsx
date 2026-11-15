import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { listPolicies, PolicyOut } from "../../api/registry";

type StatusFilter = "all" | "active" | "expired" | "cancelled";

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

const STATUS_STYLE: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  expired: "bg-red-50 text-red-700 border-red-200",
  cancelled: "bg-sunken text-ink-muted border-line-strong",
};

/** "ends in 40 days", "ended 3 days ago", based on the coverage end date. */
function endsLabel(end: string): { text: string; tone: string } {
  const days = Math.round((new Date(end).getTime() - Date.now()) / 86_400_000);
  if (isNaN(days)) return { text: "", tone: "text-ink-faint" };
  if (days < 0) return { text: `ended ${-days} day${days === -1 ? "" : "s"} ago`, tone: "text-red-700" };
  if (days <= 30) return { text: `ends in ${days} day${days === 1 ? "" : "s"}`, tone: "text-amber-700" };
  return { text: `ends in ${days} days`, tone: "text-ink-faint" };
}

export default function PolicyListPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const canEdit = user?.role === "insurer" || user?.role === "admin";

  // A message and row highlight passed from the create/edit screens.
  const nav = (location.state ?? {}) as { flash?: string; highlightId?: string };
  const [flash, setFlash] = useState<string | null>(nav.flash ?? null);
  const highlightId = nav.highlightId;

  const [policies, setPolicies] = useState<PolicyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");

  useEffect(() => {
    // Clear the navigation state so a refresh doesn't show the message again.
    if (nav.flash) navigate(location.pathname, { replace: true, state: null });
    listPolicies()
      .then(setPolicies)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load policies"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => ({
    all: policies.length,
    active: policies.filter((p) => p.status === "active").length,
    expired: policies.filter((p) => p.status === "expired").length,
    cancelled: policies.filter((p) => p.status === "cancelled").length,
    insured: policies.filter((p) => p.status === "active").reduce((s, p) => s + p.sum_insured, 0),
  }), [policies]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return policies.filter((p) =>
      (status === "all" || p.status === status) &&
      (!needle || [p.policy_number, p.farmer_name, p.farmer_email, p.farm_name].some((v) => (v ?? "").toLowerCase().includes(needle))));
  }, [policies, status, q]);

  const tabs: { id: StatusFilter; label: string; n: number }[] = [
    { id: "all", label: "All", n: counts.all }, { id: "active", label: "Active", n: counts.active },
    { id: "expired", label: "Expired", n: counts.expired }, { id: "cancelled", label: "Cancelled", n: counts.cancelled },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Policies</h1>
          <p className="text-ink-muted text-sm">Every issued policy, with its farmer, farm and rain trigger.</p>
        </div>
        {canEdit && (
          <Link to="/insurer/policies/new" className="bg-accent text-white font-semibold px-4 py-2 rounded-full hover:opacity-90 transition text-sm">
            + New Policy
          </Link>
        )}
      </div>

      {flash && (
        <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm flex items-center justify-between gap-3">
          <span>✓ {flash}</span>
          <button onClick={() => setFlash(null)} className="text-green-700 hover:text-ink">✕</button>
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>}

      {/* Summary */}
      {!loading && !error && policies.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Policies" value={String(counts.all)} />
          <Stat label="Active" value={String(counts.active)} tone="text-green-700" />
          <Stat label="Needing attention" value={String(policies.filter((p) => p.status === "active" && endsLabel(p.coverage_end).tone === "text-amber-700").length)} sub="ending within 30 days" tone="text-amber-700" />
          <Stat label="Active sum insured" value={inr(counts.insured)} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          {tabs.map((t) => (
            <button key={t.id} onClick={() => setStatus(t.id)}
              className={`text-xs px-3 py-1.5 rounded-full border transition ${status === t.id ? "bg-accent text-white border-accent" : "border-line-strong text-ink-muted hover:text-white"}`}>
              {t.label} <span className="opacity-70">({t.n})</span>
            </button>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search policy #, farmer or farm…"
          className="w-full sm:w-72 bg-paper border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-500 focus:outline-none focus:border-accent" />
      </div>

      {loading && <p className="text-ink-muted">Loading…</p>}

      {!loading && !error && policies.length === 0 && (
        <div className="bg-surface shadow-card border border-line rounded-2xl p-10 text-center space-y-3">
          <p className="text-4xl">📋</p>
          <p className="text-ink font-semibold">No policies yet</p>
          <p className="text-ink-muted text-sm">A farmer registers a farm first; then you issue a policy for it.</p>
          {canEdit && <Link to="/insurer/policies/new" className="inline-block bg-accent text-white font-semibold px-5 py-2 rounded-full text-sm">Create the first policy</Link>}
        </div>
      )}
      {!loading && policies.length > 0 && shown.length === 0 && (
        <div className="bg-surface shadow-card border border-line rounded-2xl p-8 text-center text-ink-muted text-sm">No policies match your filters.</div>
      )}

      {shown.length > 0 && (
        <div className="bg-surface shadow-card border border-line rounded-2xl overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-line text-ink-muted text-left text-xs uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Policy</th>
                <th className="px-4 py-3 font-medium">Farmer · Farm</th>
                <th className="px-4 py-3 font-medium">Coverage</th>
                <th className="px-4 py-3 font-medium">Rain trigger → full</th>
                <th className="px-4 py-3 font-medium text-right">Sum insured</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
                <th className="px-4 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((p) => {
                const ends = endsLabel(p.coverage_end);
                const full = p.rainfall_max_payout_mm ?? (p.rainfall_trigger_mm ? p.rainfall_trigger_mm * 1.5 : null);
                return (
                  <tr key={p.id} className={`border-b border-line/50 last:border-b-0 transition ${p.id === highlightId ? "bg-green-50" : "hover:bg-sunken/30"}`}>
                    <td className="px-4 py-3 font-mono text-accent">{p.policy_number}</td>
                    <td className="px-4 py-3">
                      <Link to={`/insurer/farmers/${p.farmer_profile_id}`} className="text-ink hover:underline">{p.farmer_name ?? "Farmer"}</Link>
                      <p className="text-xs text-ink-muted">{p.farm_name ?? "Farm"}</p>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {p.coverage_start} → {p.coverage_end}
                      {p.status === "active" && ends.text && <p className={`text-xs ${ends.tone}`}>{ends.text}</p>}
                    </td>
                    <td className="px-4 py-3 text-ink-soft">
                      {p.rainfall_trigger_mm ? <>{p.rainfall_trigger_mm} → {full} <span className="text-xs text-ink-faint">mm/hr</span></> : <span className="text-ink-faint">not set</span>}
                    </td>
                    <td className="px-4 py-3 text-ink text-right">{inr(p.sum_insured)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${STATUS_STYLE[p.status] ?? "bg-sunken text-ink-soft border-line-strong"}`}>{p.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap space-x-2">
                      <Link to={`/insurer/command?farm=${p.farm_id}`} className="text-xs text-accent hover:underline">Map</Link>
                      {canEdit && <Link to={`/insurer/policies/${p.id}/edit`} className="text-xs bg-sunken hover:bg-line text-ink px-2.5 py-1 rounded-lg">Edit</Link>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-surface shadow-card border border-line rounded-2xl p-3">
      <p className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</p>
      <p className={`text-xl font-bold ${tone ?? "text-ink"}`}>{value}</p>
      {sub && <p className="text-[11px] text-ink-faint">{sub}</p>}
    </div>
  );
}
