import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import PageLayout from "../shared/PageLayout";
import { getMyFarms, FarmOut } from "../../api/registry";

function FarmCard({ farm }: { farm: FarmOut }) {
  const crop = farm.crops[0];
  return (
    <div className="bg-surface shadow-card border border-line rounded-2xl overflow-hidden">
      {farm.map_image_url ? (
        <img src={farm.map_image_url} alt={`${farm.name} boundary on satellite map`} className="w-full h-44 object-cover" loading="lazy" />
      ) : (
        <div className="w-full h-24 bg-paper flex items-center justify-center text-xs text-ink-faint">
          No boundary traced yet
        </div>
      )}
      <div className="p-5 space-y-3">
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-ink text-lg">{farm.name}</h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-sunken text-ink-muted">
          {farm.area_hectares ? `${farm.area_hectares} ha` : "Area TBD"}
        </span>
      </div>

      {(farm.latitude || farm.longitude) && (
        <p className="text-xs text-ink-faint">
          📍 {farm.latitude?.toFixed(5)}, {farm.longitude?.toFixed(5)}
        </p>
      )}

      {crop ? (
        <div className="flex gap-2 flex-wrap">
          <span className="text-xs bg-sunken text-ink-soft px-2 py-0.5 rounded-full">
            🌱 {crop.crop_type}
          </span>
          {crop.season && (
            <span className="text-xs bg-sunken text-ink-soft px-2 py-0.5 rounded-full">
              {crop.season}
            </span>
          )}
          {crop.area_hectares && (
            <span className="text-xs bg-sunken text-ink-soft px-2 py-0.5 rounded-full">
              {crop.area_hectares} ha crop
            </span>
          )}
        </div>
      ) : (
        <p className="text-xs text-ink-faint">No crop recorded</p>
      )}
      <div className="pt-1">
        <Link
          to={`/farmer/farms/${farm.id}/edit`}
          className="inline-block text-xs font-semibold bg-sunken text-ink px-3 py-1.5 rounded-lg hover:bg-line transition"
        >
          ✎ {farm.boundary_geojson ? "Edit boundary" : "Trace boundary"}
        </Link>
      </div>
      </div>
    </div>
  );
}

export default function MyFarmsPage() {
  const [farms, setFarms] = useState<FarmOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMyFarms()
      .then(setFarms)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load farms"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PageLayout title="My Farms" subtitle="All registered farms" backTo="/farmer">
      <div className="flex justify-end">
        <Link
          to="/farmer/farms/new"
          className="bg-accent text-white font-semibold px-4 py-2 rounded-full hover:opacity-90 transition text-sm"
        >
          + Add Farm
        </Link>
      </div>

      {loading && <p className="text-ink-muted">Loading…</p>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && !error && farms.length === 0 && (
        <div className="bg-surface shadow-card border border-line rounded-2xl p-10 text-center space-y-4">
          <p className="text-4xl">🌾</p>
          <p className="text-ink font-semibold">No farms registered yet</p>
          <p className="text-ink-muted text-sm">Register your first farm to get started with FarmTrust coverage.</p>
          <Link
            to="/farmer/farms/new"
            className="inline-block mt-2 bg-accent text-white font-semibold px-5 py-2 rounded-full hover:opacity-90 transition text-sm"
          >
            Register Your First Farm
          </Link>
        </div>
      )}

      {!loading && farms.length > 0 && (
        <div className="grid sm:grid-cols-2 gap-4">
          {farms.map((farm) => <FarmCard key={farm.id} farm={farm} />)}
        </div>
      )}
    </PageLayout>
  );
}
