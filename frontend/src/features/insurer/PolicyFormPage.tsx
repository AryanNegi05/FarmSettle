/**
 * Create or edit an insurance policy.
 *   /insurer/policies/new[?farmerId=…&farmId=…]   → create (farmer and farm can be preselected by link)
 *   /insurer/policies/:policyId/edit              → edit (farmer, farm and policy number are fixed)
 * Ids are Firestore document ids (strings). Rainfall values are mm/hr, the unit the simulation uses.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import PageLayout from "../shared/PageLayout";
import {
  createPolicy, updatePolicy, getPolicy, searchFarmers, getFarmerDetail,
  FarmerSummary, FarmOut, PolicyCreate, PolicyUpdate,
} from "../../api/stage2";

const STATUSES = ["active", "expired", "cancelled"];
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const todayIso = () => isoDate(new Date());
const nextYearIso = () => { const d = new Date(); d.setFullYear(d.getFullYear() + 1); return isoDate(d); };
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function generatePolicyNumber(): string {
  return `PT-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 90000)}`;
}

export default function PolicyFormPage() {
  const navigate = useNavigate();
  const { policyId } = useParams<{ policyId: string }>();
  const isEdit = !!policyId;
  const [searchParams] = useSearchParams();
  const preFarmer = searchParams.get("farmerId");
  const preFarm = searchParams.get("farmId");

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [policyNumber, setPolicyNumber] = useState(generatePolicyNumber());
  const [farmers, setFarmers] = useState<FarmerSummary[]>([]);
  const [farmerSearch, setFarmerSearch] = useState("");
  const [farmerId, setFarmerId] = useState<string>(preFarmer ?? "");
  const [farms, setFarms] = useState<FarmOut[]>([]);
  const [farmId, setFarmId] = useState<string>("");
  // Read-only labels used in edit mode.
  const [who, setWho] = useState<{ farmer: string; email: string; farm: string } | null>(null);

  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(nextYearIso());
  const [sumInsured, setSumInsured] = useState("");
  const [trigger, setTrigger] = useState("");
  const [full, setFull] = useState("");
  const [flood, setFlood] = useState("");
  const [limit, setLimit] = useState("");
  const [status, setStatus] = useState("active");

  // ── Edit mode: load the policy ───────────────────────────────────────────
  useEffect(() => {
    if (!isEdit || !policyId) return;
    getPolicy(policyId)
      .then((p) => {
        setPolicyNumber(p.policy_number);
        setWho({ farmer: p.farmer_name ?? "Farmer", email: p.farmer_email ?? "", farm: p.farm_name ?? "Farm" });
        setStart(String(p.coverage_start).slice(0, 10));
        setEnd(String(p.coverage_end).slice(0, 10));
        setSumInsured(String(p.sum_insured));
        setTrigger(p.rainfall_trigger_mm != null ? String(p.rainfall_trigger_mm) : "");
        setFull(p.rainfall_max_payout_mm != null ? String(p.rainfall_max_payout_mm) : "");
        setFlood(p.flood_trigger_level != null ? String(p.flood_trigger_level) : "");
        setLimit(p.payout_limit != null ? String(p.payout_limit) : "");
        setStatus(p.status);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Could not load this policy"))
      .finally(() => setLoading(false));
  }, [isEdit, policyId]);

  // ── Create mode: farmers and their farms ─────────────────────────────────
  useEffect(() => {
    if (isEdit) return;
    searchFarmers(farmerSearch || undefined).then(setFarmers).catch(() => {});
  }, [farmerSearch, isEdit]);

  useEffect(() => {
    if (isEdit) return;
    if (!farmerId) { setFarms([]); setFarmId(""); return; }
    getFarmerDetail(farmerId)
      .then((d) => {
        const list = d.farms ?? [];
        setFarms(list);
        // Preselect the farm from the link, or the farmer's only farm.
        const pick = list.find((f) => String(f.id) === preFarm) ?? (list.length === 1 ? list[0] : null);
        if (pick) setFarmId(String(pick.id));
      })
      .catch(() => setFarms([]));
  }, [farmerId, isEdit, preFarm]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const num = (v: string) => (v.trim() === "" ? null : parseFloat(v));

  function validate(): string | null {
    if (!isEdit && !farmerId) return "Choose a farmer.";
    if (!isEdit && !farmId) return "Choose the farm this policy covers.";
    if (!start || !end) return "Both coverage dates are required.";
    if (end < start) return "Coverage end must be on or after the start date.";
    const si = num(sumInsured);
    if (si === null || isNaN(si) || si <= 0) return "Sum insured must be a positive amount.";
    const t = num(trigger), f = num(full), l = num(limit);
    if (t !== null && (isNaN(t) || t <= 0)) return "Rainfall trigger must be a positive number.";
    if (f !== null && t !== null && f <= t) return "Full-payout rainfall must be higher than the trigger.";
    if (f !== null && t === null) return "Set a rainfall trigger, or clear the full-payout value.";
    if (l !== null && (isNaN(l) || l <= 0)) return "Payout limit must be a positive amount.";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) { setError(problem); return; }
    setError(null);
    setSaving(true);
    try {
      if (isEdit && policyId) {
        const body: PolicyUpdate = {
          coverage_start: start, coverage_end: end, sum_insured: parseFloat(sumInsured), status,
          rainfall_trigger_mm: num(trigger), rainfall_max_payout_mm: num(full),
          flood_trigger_level: num(flood), payout_limit: num(limit),
        };
        await updatePolicy(policyId, body);
        navigate("/insurer/policies", { state: { flash: `Policy ${policyNumber} updated.`, highlightId: policyId } });
      } else {
        const body: PolicyCreate = {
          policy_number: policyNumber.trim(), farm_id: farmId, farmer_profile_id: farmerId,
          coverage_start: start, coverage_end: end, sum_insured: parseFloat(sumInsured), status,
          ...(num(trigger) !== null ? { rainfall_trigger_mm: num(trigger)! } : {}),
          ...(num(full) !== null ? { rainfall_max_payout_mm: num(full)! } : {}),
          ...(num(flood) !== null ? { flood_trigger_level: num(flood)! } : {}),
          ...(num(limit) !== null ? { payout_limit: num(limit)! } : {}),
        };
        const created = await createPolicy(body);
        navigate("/insurer/policies", {
          state: {
            flash: `Policy ${created.policy_number} created for ${created.farmer_name ?? "the farmer"}${created.farm_name ? ` · ${created.farm_name}` : ""}.`,
            highlightId: created.id,
          },
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not save the policy");
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "w-full bg-navy border border-navy-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-brand-blue disabled:opacity-60";
  const t = num(trigger), f = num(full), si = num(sumInsured);
  const effectiveFull = f ?? (t ? t * 1.5 : null);

  if (loading) return <PageLayout title="Edit Policy" backTo="/insurer/policies"><p className="text-gray-400">Loading…</p></PageLayout>;

  return (
    <PageLayout title={isEdit ? "Edit Policy" : "Create Policy"} subtitle={isEdit ? `Policy ${policyNumber}` : "Issue a new insurance policy for a registered farm"} backTo="/insurer/policies">
      <form onSubmit={handleSubmit} className="bg-navy-800 border border-navy-700 rounded-xl p-6 space-y-6 max-w-2xl">
        {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}

        {/* Who and what the policy covers */}
        {isEdit ? (
          <div className="bg-navy border border-navy-700 rounded-lg p-3 text-sm space-y-0.5">
            <p className="text-gray-400 text-xs uppercase tracking-wide">Covers</p>
            <p className="text-white">{who?.farmer} <span className="text-gray-500">{who?.email && `· ${who.email}`}</span></p>
            <p className="text-gray-300">Farm: {who?.farm}</p>
            <p className="text-xs text-gray-500">The farmer and farm cannot be changed. To cover a different farm, create a new policy.</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <label className="text-sm text-gray-400">Policy number *</label>
              <div className="flex gap-2">
                <input className={inputCls} value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} required />
                <button type="button" onClick={() => setPolicyNumber(generatePolicyNumber())}
                  className="text-xs bg-navy-700 text-gray-300 px-3 rounded-lg hover:bg-navy-600 transition whitespace-nowrap">Regenerate</button>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-gray-400">Farmer *</label>
              <input className={inputCls} placeholder="Search farmer by name or email…" value={farmerSearch} onChange={(e) => setFarmerSearch(e.target.value)} />
              <select className={inputCls} value={farmerId} onChange={(e) => { setFarmerId(e.target.value); setFarmId(""); }}>
                <option value="">— Select farmer —</option>
                {farmers.map((fm) => <option key={String(fm.id)} value={String(fm.id)}>{fm.full_name} ({fm.email}) · {fm.farm_count} farm(s)</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-sm text-gray-400">Farm *</label>
              <select className={inputCls} value={farmId} onChange={(e) => setFarmId(e.target.value)} disabled={!farmerId || farms.length === 0}>
                <option value="">— Select farm —</option>
                {farms.map((fm) => <option key={String(fm.id)} value={String(fm.id)}>{fm.name}{fm.area_hectares ? ` (${fm.area_hectares} ha)` : ""}</option>)}
              </select>
              {farmerId && farms.length === 0 && (
                <p className="text-xs text-yellow-500">This farmer has no farms yet. The farmer registers a farm under <b>My Farms → Add Farm</b>, then you can insure it.</p>
              )}
            </div>
          </>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm text-gray-400">Coverage start *</label>
            <input className={inputCls} type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-400">Coverage end *</label>
            <input className={inputCls} type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-sm text-gray-400">Sum insured (₹) *</label>
            <input className={inputCls} type="number" min="0" step="1000" placeholder="e.g. 80000" value={sumInsured} onChange={(e) => setSumInsured(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <label className="text-sm text-gray-400">Payout limit (₹)</label>
            <input className={inputCls} type="number" min="0" step="1000" placeholder="optional cap" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-brand-blue font-semibold text-sm uppercase tracking-wider">Rain trigger</legend>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm text-gray-400">Payout starts at (mm/hr)</label>
              <input className={inputCls} type="number" min="0" step="1" placeholder="e.g. 20" value={trigger} onChange={(e) => setTrigger(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-gray-400">Full payout at (mm/hr)</label>
              <input className={inputCls} type="number" min="0" step="1" placeholder={t ? `blank = ${t * 1.5}` : "e.g. 60"} value={full} onChange={(e) => setFull(e.target.value)} />
            </div>
          </div>
          {t !== null && effectiveFull !== null && si !== null && !isNaN(si) && (
            <p className="text-xs text-cyan-200 bg-navy border border-navy-700 rounded-lg px-3 py-2">
              Pays nothing below {t} mm/hr, rises gradually, and pays the full {inr(Math.min(si, parseFloat(limit) || si))} at {effectiveFull} mm/hr or more
              (for example {inr(Math.min(si, parseFloat(limit) || si) * 0.5)} at {(t + effectiveFull) / 2} mm/hr).
            </p>
          )}
          <div className="space-y-1 max-w-xs">
            <label className="text-sm text-gray-400">Flood water-level trigger (optional)</label>
            <input className={inputCls} type="number" min="0" step="0.1" placeholder="optional" value={flood} onChange={(e) => setFlood(e.target.value)} />
          </div>
        </fieldset>

        <div className="space-y-1">
          <label className="text-sm text-gray-400">Status</label>
          <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
          {isEdit && status === "cancelled" && <p className="text-xs text-amber-300">A cancelled policy pays nothing from now on.</p>}
        </div>

        <div className="flex gap-3">
          <Link to="/insurer/policies" className="px-5 py-2 rounded-lg bg-navy-700 text-white hover:bg-navy-600 transition text-center">Cancel</Link>
          <button type="submit" disabled={saving} className="flex-1 bg-brand-blue text-white font-semibold py-2 rounded-lg hover:opacity-90 disabled:opacity-50 transition">
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create policy"}
          </button>
        </div>
      </form>
    </PageLayout>
  );
}
