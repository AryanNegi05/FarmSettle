import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import PageLayout from "../shared/PageLayout";
import { useAuth } from "../../hooks/useAuth";
import { getFarmerDetail, FarmerDetail, FarmOut, PolicyOut } from "../../api/registry";

function FarmCard({ farm, policy, canEdit }: { farm: FarmOut; policy: PolicyOut | undefined; canEdit: boolean }) {
  const crop = farm.crops[0];
  return (
    <div className="bg-paper border border-line rounded-xl p-4 space-y-2">
      <div className="flex justify-between items-start gap-2">
        <p className="text-ink font-semibold">{farm.name}</p>
        {farm.area_hectares ? (
          <span className="text-xs bg-sunken text-ink-muted px-2 py-0.5 rounded-full">{farm.area_hectares} ha</span>
        ) : null}
      </div>
      {farm.map_image_url && <img src={farm.map_image_url} alt={`${farm.name} boundary`} className="w-full h-32 object-cover rounded-lg border border-line" loading="lazy" />}
      {crop && <p className="text-xs text-ink-muted">🌱 {crop.crop_type}{crop.season ? ` · ${crop.season}` : ""}</p>}
      <div className="pt-1 flex flex-wrap items-center gap-2 text-xs">
        {policy ? (
          <>
            <span className="font-mono text-accent">{policy.policy_number}</span>
            {statusBadge(policy.status)}
          </>
        ) : (
          <span className="text-amber-700">No policy yet</span>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        {canEdit && !policy && (
          <Link to={`/insurer/policies/new?farmerId=${farm.farmer_profile_id}&farmId=${farm.id}`}
            className="text-xs bg-accent text-white font-semibold px-3 py-1.5 rounded-full hover:opacity-90">+ Create policy</Link>
        )}
        <Link to={`/insurer/command?farm=${farm.id}`} className="text-xs bg-sunken text-accent px-3 py-1.5 rounded-lg hover:bg-line">View on map</Link>
      </div>
    </div>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-green-50 text-green-700 border-green-200",
    expired: "bg-red-50 text-red-700 border-red-200",
    cancelled: "bg-sunken text-ink-muted border-line-strong",
  };
  const cls = map[status] ?? "bg-sunken text-ink-soft border-line-strong";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

function PolicyCard({ policy, canEdit }: { policy: PolicyOut; canEdit: boolean }) {
  return (
    <div className="bg-paper border border-line rounded-xl p-4 space-y-2">
      <div className="flex justify-between items-center">
        <span className="font-mono text-accent text-sm">{policy.policy_number}</span>
        {statusBadge(policy.status)}
      </div>
      <p className="text-xs text-ink-muted">Farm: <span className="text-ink">{policy.farm_name ?? "—"}</span></p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-muted">
        <p>Start: <span className="text-ink">{policy.coverage_start}</span></p>
        <p>End: <span className="text-ink">{policy.coverage_end}</span></p>
        <p>Sum insured: <span className="text-ink">₹{policy.sum_insured.toLocaleString("en-IN")}</span></p>
        {policy.rainfall_trigger_mm ? <p>Trigger: <span className="text-ink">{policy.rainfall_trigger_mm} mm/hr</span></p> : null}
      </div>
      {canEdit && <Link to={`/insurer/policies/${policy.id}/edit`} className="inline-block text-xs bg-sunken hover:bg-line text-ink px-3 py-1.5 rounded-lg">Edit policy</Link>}
    </div>
  );
}

export default function FarmerDetailPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "insurer" || user?.role === "admin";
  const { profileId } = useParams<{ profileId: string }>();
  const [farmer, setFarmer] = useState<FarmerDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) return;
    getFarmerDetail(profileId)
      .then(setFarmer)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load farmer"))
      .finally(() => setLoading(false));
  }, [profileId]);

  return (
    <PageLayout title="Farmer Detail" backTo="/insurer/farmers">
      {loading && <p className="text-ink-muted">Loading…</p>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && farmer && (
        <div className="space-y-8">
          {/* Profile */}
          <div className="bg-surface shadow-card border border-line rounded-2xl p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-ink">{farmer.full_name}</h2>
                <p className="text-ink-muted text-sm">{farmer.email}</p>
              </div>
              {canEdit && (
                <Link
                  to={`/insurer/policies/new?farmerId=${farmer.id}`}
                  className="bg-accent text-white text-sm font-semibold px-4 py-2 rounded-full hover:opacity-90 transition"
                >
                  + Create Policy
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              {farmer.phone && (
                <div>
                  <p className="text-ink-faint text-xs">Phone</p>
                  <p className="text-ink">{farmer.phone}</p>
                </div>
              )}
              {farmer.district && (
                <div>
                  <p className="text-ink-faint text-xs">District</p>
                  <p className="text-ink">{farmer.district}</p>
                </div>
              )}
              {farmer.state && (
                <div>
                  <p className="text-ink-faint text-xs">State</p>
                  <p className="text-ink">{farmer.state}</p>
                </div>
              )}
            </div>
          </div>

          {/* Farms */}
          <div className="space-y-3">
            <h3 className="text-ink font-semibold text-lg">
              🌾 Farms <span className="text-ink-faint text-sm font-normal">({farmer.farms.length})</span>
            </h3>
            {farmer.farms.length === 0 ? (
              <p className="text-ink-muted text-sm">No farms registered.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {farmer.farms.map((f) => (
                  <FarmCard key={f.id} farm={f} canEdit={canEdit}
                    policy={farmer.policies.find((p) => String(p.farm_id) === String(f.id) && p.status === "active") ?? farmer.policies.find((p) => String(p.farm_id) === String(f.id))} />
                ))}
              </div>
            )}
          </div>

          {/* Policies */}
          <div className="space-y-3">
            <h3 className="text-ink font-semibold text-lg">
              📋 Policies <span className="text-ink-faint text-sm font-normal">({farmer.policies.length})</span>
            </h3>
            {farmer.policies.length === 0 ? (
              <p className="text-ink-muted text-sm">No policies assigned yet.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {farmer.policies.map((p) => <PolicyCard key={p.id} policy={p} canEdit={canEdit} />)}
              </div>
            )}
          </div>
        </div>
      )}
    </PageLayout>
  );
}
