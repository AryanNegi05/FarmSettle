import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

const TILES = ["bg-yellow-100", "bg-violet-100", "bg-orange-100", "bg-sky-100", "bg-rose-100", "bg-emerald-100", "bg-amber-100", "bg-indigo-100"];

const cards = [
  { icon: "📋", title: "Claims", desc: "Review claim decisions and the evidence behind them", to: "/insurer/claims" },
  { icon: "🛰️", title: "Command Centre", desc: "Live risk map, sensors and storm simulation", to: "/insurer/command" },
  { icon: "📐", title: "Basis Risk", desc: "Index payouts compared with actual losses", to: "/insurer/basis-risk" },
  { icon: "⏪", title: "Replay", desc: "Historical storm replays against the portfolio", to: "/insurer/replay" },
  { icon: "👥", title: "Farmers", desc: "Registered farmers and their farms", to: "/insurer/farmers" },
  { icon: "📄", title: "Policies", desc: "All parametric insurance policies", to: "/insurer/policies" },
];

export default function AuditorDashboard() {
  const { user } = useAuth();
  return (
    <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-ink">Audit Console 📋</h1>
        <p className="text-ink-muted mt-1">Logged in as {user?.full_name ?? user?.email}</p>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {cards.map((c, i) => (
          <Link
            key={c.title}
            to={c.to}
            className="bg-surface shadow-card border border-line hover:border-accent rounded-[2rem] p-6 space-y-3 transition-all duration-300 block hover:-translate-y-1 hover:shadow-lift shadow-card"
          >
            <span className={`grid place-items-center h-14 w-14 rounded-2xl text-2xl shadow-sm ${TILES[i % TILES.length]}`}>{c.icon}</span>
            <h3 className="font-semibold text-ink">{c.title}</h3>
            <p className="text-sm text-ink-muted">{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
