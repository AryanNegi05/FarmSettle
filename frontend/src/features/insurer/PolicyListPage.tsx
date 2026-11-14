import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import PageLayout from "../shared/PageLayout";
import { listPolicies, PolicyOut, syncAllToFirestore } from "../../api/stage2";

type StatusFilter = "all" | "active" | "expired" | "cancelled";

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-green-900/50 text-green-300 border-green-700",
    expired: "bg-red-900/50 text-red-300 border-red-700",
    cancelled: "bg-gray-700 text-gray-400 border-gray-600",
  };
  const cls = map[status] ?? "bg-navy-700 text-gray-300 border-navy-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {status}
    </span>
  );
}

export default function PolicyListPage() {
  const [policies, setPolicies] = useState<PolicyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const fetchPolicies = () => {
    setLoading(true);
    listPolicies()
      .then(setPolicies)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load policies"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPolicies();
  }, []);

  const handleSyncToFirebase = async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await syncAllToFirestore();
      setSyncMsg(`Successfully synced ${res.policies} policies & ${res.farmers} farmers to Firebase!`);
      fetchPolicies();
    } catch (err: unknown) {
      setSyncMsg(err instanceof Error ? err.message : "Failed to sync to Firebase");
    } finally {
      setSyncing(false);
    }
  };

  const filtered = policies.filter((p) => {
    if (statusFilter !== "all" && p.status !== statusFilter) return false;
    if (dateFrom && p.coverage_start < dateFrom) return false;
    if (dateTo && p.coverage_end > dateTo) return false;
    return true;
  });

  return (
    <PageLayout title="Policy Management" subtitle="All issued policies (Firebase Firestore backed)" backTo="/insurer">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        {/* Filters */}
        <div className="flex flex-wrap gap-3 items-center">
          <select
            className="bg-navy-900 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-blue"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input
            type="date"
            placeholder="From"
            className="bg-navy-900 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-blue"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <input
            type="date"
            placeholder="To"
            className="bg-navy-900 border border-navy-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-brand-blue"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleSyncToFirebase}
            disabled={syncing}
            className="flex items-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs px-3 py-2 rounded-lg font-medium transition disabled:opacity-50"
            title="Push all backend policies and farmers to Firebase Firestore"
          >
            🔥 {syncing ? "Syncing..." : "Sync to Firebase"}
          </button>
          <Link
            to="/insurer/policies/new"
            className="bg-brand-blue text-white font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition text-sm"
          >
            + New Policy
          </Link>
        </div>
      </div>

      {syncMsg && (
        <div className="bg-amber-900/30 border border-amber-700/50 text-amber-200 rounded-lg px-4 py-2.5 text-xs flex items-center justify-between">
          <span>🔥 {syncMsg}</span>
          <button onClick={() => setSyncMsg(null)} className="text-gray-400 hover:text-white ml-2">✕</button>
        </div>
      )}

      {loading && <p className="text-gray-400">Loading…</p>}
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-8 text-center text-gray-400">
          No policies found{statusFilter !== "all" ? ` with status "${statusFilter}"` : ""}.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="bg-navy-800 border border-navy-700 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700 text-gray-400 text-left">
                <th className="px-4 py-3 font-medium">Policy #</th>
                <th className="px-4 py-3 font-medium">Coverage</th>
                <th className="px-4 py-3 font-medium text-right">Sum Insured</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => (
                <tr
                  key={p.id}
                  className={`border-b border-navy-700/50 ${i === filtered.length - 1 ? "border-b-0" : ""}`}
                >
                  <td className="px-4 py-3 font-mono text-brand-blue">{p.policy_number}</td>
                  <td className="px-4 py-3 text-gray-300">
                    {p.coverage_start} → {p.coverage_end}
                  </td>
                  <td className="px-4 py-3 text-white text-right">
                    ₹{p.sum_insured.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3 text-center">{statusBadge(p.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageLayout>
  );
}
