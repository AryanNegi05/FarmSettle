import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { homeFor } from "../shared/nav";
import { UserRole } from "../../api/auth";

const AVAILABLE_ROLES: { value: UserRole; label: string; desc: string }[] = [
  { value: "farmer", label: "🌾 Farmer", desc: "Insured farms, alerts & claim payouts" },
  { value: "insurer", label: "🏦 Insurer", desc: "Policies, operations map & risk" },
  { value: "auditor", label: "📋 Auditor", desc: "Sensor health & audit records" },
  { value: "admin", label: "⚙️ Admin", desc: "Platform admin & configuration" },
];

export default function RegisterPage() {
  const { register, login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "", full_name: "", role: "farmer" as UserRole });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await register(form);
      const role = await login(form.email, form.password);
      navigate(homeFor(role), { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const selectedRoleObj = AVAILABLE_ROLES.find((r) => r.value === form.role);

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4 py-8">
      <div className="w-full max-w-lg bg-surface shadow-card rounded-3xl p-8 border border-line space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-bold text-ink">Create your account</h2>
          <p className="text-ink-muted text-sm">Join FarmTrust platform</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Role selector */}
          <div className="space-y-1.5">
            <label className="block text-sm text-ink-soft font-medium">Select Role</label>
            <div className="grid grid-cols-2 gap-2">
              {AVAILABLE_ROLES.map((r) => (
                <button
                  type="button"
                  key={r.value}
                  onClick={() => setForm((f) => ({ ...f, role: r.value }))}
                  className={`p-2.5 rounded-xl border text-left transition flex flex-col gap-0.5 ${
                    form.role === r.value
                      ? "border-accent bg-green-50 text-ink ring-1 ring-accent"
                      : "border-line-strong bg-sunken/60 text-ink-soft hover:border-line-strong"
                  }`}
                >
                  <span className="text-sm font-semibold">{r.label}</span>
                  <span className="text-[11px] text-ink-muted leading-tight">{r.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm text-ink-soft mb-1.5">Full Name</label>
            <input
              type="text"
              value={form.full_name}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
              className="w-full px-4 py-2.5 bg-sunken border border-line-strong rounded-xl text-ink placeholder-gray-500 focus:outline-none focus:border-accent transition"
              placeholder="Your name"
            />
          </div>
          <div>
            <label className="block text-sm text-ink-soft mb-1.5">Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full px-4 py-2.5 bg-sunken border border-line-strong rounded-xl text-ink placeholder-gray-500 focus:outline-none focus:border-accent transition"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-ink-soft mb-1.5">Password</label>
            <input
              type="password"
              required
              minLength={6}
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              className="w-full px-4 py-2.5 bg-sunken border border-line-strong rounded-xl text-ink placeholder-gray-500 focus:outline-none focus:border-accent transition"
              placeholder="At least 6 characters"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-accent text-white font-bold rounded-full hover:bg-accent-dark disabled:opacity-60 transition"
          >
            {loading ? "Creating account…" : `Create ${selectedRoleObj?.label.split(" ")[1] || "Account"}`}
          </button>
        </form>

        <div className="text-center text-sm text-ink-muted">
          Already have an account?{" "}
          <Link to="/login" className="text-accent hover:underline">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
