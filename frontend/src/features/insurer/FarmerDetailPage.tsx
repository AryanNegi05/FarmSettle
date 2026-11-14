import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import PageLayout from "../shared/PageLayout";
import { useAuth } from "../../hooks/useAuth";
import { getFarmerDetail, FarmerDetail, FarmOut, PolicyOut } from "../../api/stage2";

function FarmCard({ farm, policy, canEdit }: { farm: FarmOut; policy: PolicyOut | undefined; canEdit: boolean }) {
  const crop = farm.crops[0];
  return (
    <div className="bg-navy border border-navy-700 rounded-xl p-4 space-y-2">
      <div className="flex justify-between items-start gap-2">
        <p className="text-white font-semibold">{farm.name}</p>
        {farm.area_hectares ? (
          <span className="text-xs bg-navy-700 text-gray-400 px-2 py-0.5 rounded-full">{farm.area_hectares} ha</span>
        ) : null}
      </div>
      {farm.map_image_url && <img src={farm.map_image_url} alt={`${farm.name} boundary`} className="w-full h-32 object-cover rounded-lg border border-navy-700" loading="lazy" />}
      {crop && <p className="text-xs text-gray-400">🌱 {crop.crop_type}{crop.season ? ` · ${crop.season}` : ""}</p>}
      <div className="pt-1 flex flex-wrap items-center gap-2 text-xs">
        {policy ? (
          <>
            <span className="font-mono text-brand-blue">{policy.policy_number}</span>
            {statusBadge(policy.status)}
          </>
        ) : (
          <span className="text-amber-300">No policy yet</span>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        {canEdit && !policy && (
          <Link to={`/insurer/policies/new?farmerId=${farm.farmer_profile_id}&farmId=${farm.id}`}
            className="text-xs bg-brand-blue text-white font-semibold px-3 py-1.5 rounded-lg hover:opacity-90">+ Create policy</Link>
        )}
        <Link to={`/insurer/command?farm=${farm.id}`} className="text-xs bg-navy-700 text-cyan-200 px-3 py-1.5 rounded-lg hover:bg-navy-600">View on map</Link>
      </div>
    </div>
  );
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: "bg-green-900/50 text-green-300 border-green-700",
    expired: "bg-red-900/50 text-red-300 border-red-700",
    cancelled: "bg-gray-700 text-gray-400 border-gray-600",
  };
  const cls = map[status] ?? "bg-navy-700 text-gray-300 border-navy-600";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border ${cls}`}>
      {status}
    </span>
  );
}

function PolicyCard({ policy, canEdit }: { policy: PolicyOut; canEdit: boolean }) {
  return (
    <div className="bg-navy border border-navy-700 rounded-xl p-4 space-y-2">
      <div className="flex justify-between items-center">
        <span className="font-mono text-brand-blue text-sm">{policy.policy_number}</span>
        {statusBadge(policy.status)}
      </div>
      <p className="text-xs text-gray-400">Farm: <span className="text-white">{policy.farm_name ?? "—"}</span></p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-400">
        <p>Start: <span className="text-white">{policy.coverage_start}</span></p>
        <p>End: <span className="text-white">{policy.coverage_end}</span></p>
        <p>Sum insured: <span className="text-white">₹{policy.sum_insured.toLocaleString("en-IN")}</span></p>
        {policy.rainfall_trigger_mm ? <p>Trigger: <span className="text-white">{policy.rainfall_trigger_mm} mm/hr</span></p> : null}
      </div>
      {canEdit && <Link to={`/insurer/policies/${policy.id}/edit`} className="inline-block text-xs bg-navy-700 hover:bg-navy-600 text-white px-3 py-1.5 rounded-lg">Edit policy</Link>}
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
      {loading && <p className="text-gray-400">Loading…</p>}
      {error && (
        <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && farmer && (
        <div className="space-y-8">
          {/* Profile */}
          <div className="bg-navy-800 border border-navy-700 rounded-xl p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">{farmer.full_name}</h2>
                <p className="text-gray-400 text-sm">{farmer.email}</p>
              </div>
              {canEdit && (
                <Link
                  to={`/insurer/policies/new?farmerId=${farmer.id}`}
                  className="bg-brand-blue text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition"
                >
                  + Create Policy
                </Link>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              {farmer.phone && (
                <div>
                  <p className="text-gray-500 text-xs">Phone</p>
                  <p className="text-white">{farmer.phone}</p>
                </div>
              )}
              {farmer.district && (
                <div>
                  <p className="text-gray-500 text-xs">District</p>
                  <p className="text-white">{farmer.district}</p>
                </div>
              )}
              {farmer.state && (
                <div>
                  <p className="text-gray-500 text-xs">State</p>
                  <p className="text-white">{farmer.state}</p>
                </div>
              )}
            </div>
          </div>

          {/* Farms */}
          <div className="space-y-3">
            <h3 className="text-white font-semibold text-lg">
              🌾 Farms <span className="text-gray-500 text-sm font-normal">({farmer.farms.length})</span>
            </h3>
            {farmer.farms.length === 0 ? (
              <p className="text-gray-400 text-sm">No farms registered.</p>
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
            <h3 className="text-white font-semibold text-lg">
              📋 Policies <span className="text-gray-500 text-sm font-normal">({farmer.policies.length})</span>
            </h3>
            {farmer.policies.length === 0 ? (
              <p className="text-gray-400 text-sm">No policies assigned yet.</p>
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
