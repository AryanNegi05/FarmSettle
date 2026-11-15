import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

export default function AdminDashboard() {
  const { user } = useAuth();
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold text-ink">Admin Panel ⚙️</h1>
      <p className="text-ink-muted">Platform Administrator: {user?.full_name ?? user?.email}</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <Link to="/insurer" className="bg-surface shadow-card border border-line hover:border-accent rounded-2xl p-5 block transition">
          <h3 className="font-semibold text-ink">Operations Dashboard</h3>
          <p className="text-sm text-ink-muted mt-1">Farmers, policies, claims and the command centre</p>
        </Link>
        <Link to="/auditor" className="bg-surface shadow-card border border-line hover:border-accent rounded-2xl p-5 block transition">
          <h3 className="font-semibold text-ink">Audit Console</h3>
          <p className="text-sm text-ink-muted mt-1">Read-only review of claims and decisions</p>
        </Link>
      </div>
    </div>
  );
}
