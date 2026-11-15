import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import PageLayout from "../shared/PageLayout";
import { searchFarmers, FarmerSummary } from "../../api/registry";

export default function FarmerRegistryPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [farmers, setFarmers] = useState<FarmerSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((q: string) => {
    setLoading(true);
    setError(null);
    searchFarmers(q || undefined)
      .then(setFarmers)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load farmers"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(""); }, [load]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    load(query);
  }

  return (
    <PageLayout title="Farmer Registry" subtitle="Registered farmers, their farms and policies" backTo="/insurer">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <form onSubmit={handleSearch} className="flex gap-3 max-w-md flex-1">
          <input
            className="flex-1 bg-paper border border-line rounded-lg px-3 py-2 text-ink placeholder-gray-500 focus:outline-none focus:border-accent"
            placeholder="Search by name, email, or district…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="submit"
            className="bg-accent text-white font-semibold px-4 py-2 rounded-full hover:opacity-90 transition text-sm"
          >
            Search
          </button>
        </form>

      </div>

      {loading && <p className="text-ink-muted">Loading…</p>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && !error && farmers.length === 0 && (
        <div className="bg-surface shadow-card border border-line rounded-2xl p-8 text-center text-ink-muted">
          No farmers found{query ? ` for "${query}"` : ""}.
        </div>
      )}

      {!loading && farmers.length > 0 && (
        <div className="bg-surface shadow-card border border-line rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-ink-muted text-left">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">District</th>
                <th className="px-4 py-3 font-medium text-center">Farms</th>
                <th className="px-4 py-3 font-medium text-center">Policies</th>
              </tr>
            </thead>
            <tbody>
              {farmers.map((f, i) => (
                <tr
                  key={f.id}
                  className={`border-b border-line/50 hover:bg-sunken/40 cursor-pointer transition ${i === farmers.length - 1 ? "border-b-0" : ""}`}
                  onClick={() => navigate(`/insurer/farmers/${f.id}`)}
                >
                  <td className="px-4 py-3 text-ink font-medium">{f.full_name}</td>
                  <td className="px-4 py-3 text-ink-soft">{f.email}</td>
                  <td className="px-4 py-3 text-ink-soft">{f.district ?? "—"}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-sunken text-ink-soft px-2 py-0.5 rounded-full text-xs">{f.farm_count}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="bg-sunken text-ink-soft px-2 py-0.5 rounded-full text-xs">{f.policy_count}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageLayout>
  );
}
