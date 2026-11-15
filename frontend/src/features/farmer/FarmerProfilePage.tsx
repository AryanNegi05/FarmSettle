import { useState, useEffect } from "react";
import PageLayout from "../shared/PageLayout";
import { getMyProfile, upsertMyProfile, FarmerProfileOut } from "../../api/registry";
import { useAuth } from "../../hooks/useAuth";

export default function FarmerProfilePage() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [state, setState] = useState("");

  useEffect(() => {
    getMyProfile()
      .then((p: FarmerProfileOut) => {
        setPhone(p.phone ?? "");
        setAddress(p.address ?? "");
        setDistrict(p.district ?? "");
        setState(p.state ?? "");
      })
      .catch(() => {
        // No profile yet — form stays empty
      })
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setSaving(true);
    try {
      await upsertMyProfile({ phone, address, district, state });
      setSuccess(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    "w-full bg-paper border border-line rounded-lg px-3 py-2 text-ink placeholder-gray-500 focus:outline-none focus:border-accent";

  return (
    <PageLayout title="My Profile" subtitle="Update your personal details" backTo="/farmer">
      {loading ? (
        <p className="text-ink-muted">Loading…</p>
      ) : (
        <form onSubmit={handleSubmit} className="bg-surface shadow-card border border-line rounded-2xl p-6 space-y-5 max-w-lg">
          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 text-sm">
              ✅ Profile saved successfully!
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {/* Full name — read-only */}
          <div className="space-y-1">
            <label className="text-sm text-ink-muted">Full Name</label>
            <input
              className={`${inputCls} opacity-60 cursor-not-allowed`}
              value={user?.full_name ?? ""}
              readOnly
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-ink-muted">Phone Number</label>
            <input
              className={inputCls}
              placeholder="+91 98765 43210"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm text-ink-muted">Address</label>
            <textarea
              className={inputCls}
              rows={3}
              placeholder="Village / Town, Taluka"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-sm text-ink-muted">District</label>
              <input
                className={inputCls}
                placeholder="e.g. Nashik"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm text-ink-muted">State</label>
              <input
                className={inputCls}
                placeholder="e.g. Maharashtra"
                value={state}
                onChange={(e) => setState(e.target.value)}
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="w-full bg-accent text-white font-semibold py-2 rounded-full hover:opacity-90 disabled:opacity-50 transition"
          >
            {saving ? "Saving…" : "Save Profile"}
          </button>
        </form>
      )}
    </PageLayout>
  );
}
