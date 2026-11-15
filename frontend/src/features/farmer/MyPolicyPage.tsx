import { useState, useEffect } from "react";
import PageLayout from "../shared/PageLayout";
import { payPremium } from "../../api/premium";
import { getMyFarms, listPolicies, FarmOut, PolicyOut } from "../../api/registry";

type StatusKey = "active" | "expired" | "cancelled" | string;

function statusBadge(status: StatusKey) {
  const map: Record<string, string> = {
    active: "bg-green-50 text-green-700 border-green-200",
    expired: "bg-red-50 text-red-700 border-red-200",
    cancelled: "bg-sunken text-ink-muted border-line-strong",
  };
  const cls = map[status] ?? "bg-sunken text-ink-soft border-line-strong";
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${cls}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function PolicyCard({ policy, onPaid }: { policy: PolicyOut; onPaid: () => void }) {
  const [paying, setPaying] = useState(false);
  const [payErr, setPayErr] = useState<string | null>(null);
  const premium = Math.round(policy.sum_insured * 0.03 * 100) / 100;
  const paid = policy.premium_status === "paid";
  const pay = async () => {
    setPaying(true);
    setPayErr(null);
    try {
      if (await payPremium(policy.id)) onPaid();
    } catch (e) {
      setPayErr(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setPaying(false);
    }
  };
  return (
    <div className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-3">
      <div className="flex items-start justify-between">
        <span className="font-mono text-accent font-semibold">{policy.policy_number}</span>
        {statusBadge(policy.status)}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <div>
          <p className="text-ink-faint text-xs">Coverage Start</p>
          <p className="text-ink">{policy.coverage_start}</p>
        </div>
        <div>
          <p className="text-ink-faint text-xs">Coverage End</p>
          <p className="text-ink">{policy.coverage_end}</p>
        </div>
        <div>
          <p className="text-ink-faint text-xs">Sum Insured</p>
          <p className="text-ink">₹{policy.sum_insured.toLocaleString("en-IN")}</p>
        </div>
        {policy.payout_limit && (
          <div>
            <p className="text-ink-faint text-xs">Payout Cap</p>
            <p className="text-ink">₹{policy.payout_limit.toLocaleString("en-IN")}</p>
          </div>
        )}
        {policy.rainfall_trigger_mm && (
          <div>
            <p className="text-ink-faint text-xs">Rainfall Trigger</p>
            <p className="text-ink">{policy.rainfall_trigger_mm} mm</p>
          </div>
        )}
        {policy.rainfall_max_payout_mm && (
          <div>
            <p className="text-ink-faint text-xs">Max Payout Rainfall</p>
            <p className="text-ink">{policy.rainfall_max_payout_mm} mm</p>
          </div>
        )}
        {policy.flood_trigger_level && (
          <div>
            <p className="text-ink-faint text-xs">Flood Trigger Level</p>
            <p className="text-ink">{policy.flood_trigger_level} m</p>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-line pt-3">
        {paid ? (
          <span className="text-sm text-green-700 font-medium">✓ Premium paid</span>
        ) : (
          <>
            <span className="text-sm text-ink-soft">
              Premium due: <b className="text-ink">₹{(policy.premium_amount ?? premium).toLocaleString("en-IN")}</b>
            </span>
            <button onClick={pay} disabled={paying}
              className="bg-accent text-white text-sm font-medium px-4 py-1.5 rounded-lg disabled:opacity-60">
              {paying ? "Opening…" : "Pay premium"}
            </button>
          </>
        )}
      </div>
      {payErr && <p className="text-red-600 text-xs">{payErr}</p>}
    </div>
  );
}

export default function MyPolicyPage() {
  const [farms, setFarms] = useState<FarmOut[]>([]);
  const [policies, setPolicies] = useState<PolicyOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getMyFarms(), listPolicies()])
      .then(([f, p]) => { setFarms(f); setPolicies(p); })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to load data"))
      .finally(() => setLoading(false));
  }, []);

  const getPoliciesForFarm = (farmId: string | number) =>
    policies.filter((p) => String(p.farm_id) === String(farmId));

  return (
    <PageLayout title="My Policy" subtitle="Insurance coverage for your farms" backTo="/farmer">
      {loading && <p className="text-ink-muted">Loading…</p>}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{error}</div>
      )}

      {!loading && !error && farms.length === 0 && (
        <div className="bg-surface shadow-card border border-line rounded-2xl p-8 text-center space-y-2">
          <p className="text-3xl">📋</p>
          <p className="text-ink font-semibold">No farms registered</p>
          <p className="text-ink-muted text-sm">Register a farm first before viewing policies.</p>
        </div>
      )}

      {!loading && farms.map((farm) => {
        const farmPolicies = getPoliciesForFarm(farm.id);
        return (
          <div key={farm.id} className="space-y-3">
            <h2 className="text-ink font-semibold text-lg flex items-center gap-2">
              🌾 {farm.name}
            </h2>
            {farmPolicies.length === 0 ? (
              <div className="bg-surface shadow-card border border-line rounded-2xl p-5 text-ink-muted text-sm">
                No policy assigned yet. Contact your insurer.
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-4">
                {farmPolicies.map((p) => <PolicyCard key={p.id} policy={p} onPaid={() => listPolicies().then(setPolicies)} />)}
              </div>
            )}
          </div>
        );
      })}
    </PageLayout>
  );
}
