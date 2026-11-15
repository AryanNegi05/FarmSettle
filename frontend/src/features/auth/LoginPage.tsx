import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { canVisit, homeFor } from "../shared/nav";

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // If a protected page sent us here, return to it after signing in (when this role may open it).
  const from = (location.state as { from?: string } | null)?.from;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin(eMail: string, pass: string) {
    setError("");
    setLoading(true);
    try {
      const role = await login(eMail, pass);
      navigate(from && canVisit(role, from) ? from : homeFor(role), { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await handleLogin(email, password);
  }

  return (
    <div className="flex items-center justify-center min-h-[80vh] px-4 py-8">
      <div className="w-full max-w-md bg-surface shadow-card rounded-3xl p-8 border border-line space-y-6">
        <div className="text-center space-y-1">
          <h2 className="text-2xl font-bold text-ink">Welcome back</h2>
          <p className="text-ink-muted text-sm">Sign in to your FarmTrust account</p>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-ink-soft mb-1.5">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 bg-sunken border border-line-strong rounded-xl text-ink placeholder-gray-500 focus:outline-none focus:border-accent transition"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-ink-soft mb-1.5">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-2.5 bg-sunken border border-line-strong rounded-xl text-ink placeholder-gray-500 focus:outline-none focus:border-accent transition"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-accent text-white font-bold rounded-full hover:bg-accent-dark disabled:opacity-60 transition"
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>

        <div className="text-center text-sm text-ink-muted">
          Don't have an account?{" "}
          <Link to="/register" className="text-accent hover:underline">Register here</Link>
        </div>
      </div>
    </div>
  );
}
