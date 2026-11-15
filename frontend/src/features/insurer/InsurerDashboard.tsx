import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

const TILES = ["bg-yellow-100", "bg-violet-100", "bg-orange-100", "bg-sky-100", "bg-rose-100", "bg-emerald-100", "bg-amber-100", "bg-indigo-100"];

const cards = [
  {
    icon: "👥",
    title: "Farmer Registry",
    desc: "Search, inspect, and manage registered farmers and their farms",
    to: "/insurer/farmers",
  },
  {
    icon: "📋",
    title: "Policy Management",
    desc: "Create, assign, filter, and track parametric insurance policies",
    to: "/insurer/policies",
  },
  {
    icon: "🗺️",
    title: "Operations Map",
    desc: "District-wide satellite map with farm boundaries and sensor overlays",
    to: "/insurer/map",
  },
  {
    icon: "🛰️",
    title: "Command Centre (3D)",
    desc: "Live 3D risk map: rainfall circles, sensors, storm simulation and instant payout impact",
    to: "/insurer/command",
  },
  {
    icon: "✅",
    title: "Claims & Payments",
    desc: "Review claim recommendations, approve or reject, and run simulated payments",
    to: "/insurer/claims",
  },
  {
    icon: "⏪",
    title: "Replay",
    desc: "Replay historical storms against the portfolio and see payout impact",
    to: "/insurer/replay",
  },
];

export default function InsurerDashboard() {
  const { user } = useAuth();
  return (
    <div className="relative -mt-[80px] pt-[80px] overflow-hidden">
      {/* Background image that fades out toward the bottom */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-cover bg-center opacity-70"
        style={{
          backgroundImage: "url(/insurer-bg.jpg)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 35%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, #000 0%, #000 35%, transparent 100%)",
        }}
      />

    <div className="relative max-w-6xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-ink">
          Operations Dashboard 🏦
        </h1>
        <p className="text-ink-muted mt-1">
          Logged in as {user?.full_name ?? user?.email} ·{" "}
          <span className="uppercase text-accent font-semibold">{user?.role}</span>
        </p>
      </div>

      <div>
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-faint mb-5">
          Operations
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {cards.map((c, i) => (
            <Link
              key={c.title}
              to={c.to}
              className="bg-surface shadow-card border border-line hover:border-accent/40 hover:-translate-y-1 hover:shadow-lift rounded-[2rem] p-6 space-y-3 transition-all duration-300 block group"
            >
              <div className="flex items-start justify-between">
                <span className={`grid place-items-center h-14 w-14 rounded-2xl text-2xl shadow-sm group-hover:scale-105 transition-transform ${TILES[i % TILES.length]}`}>{c.icon}</span>
              </div>
              <h3 className="font-semibold text-ink group-hover:text-accent transition-colors text-base">
                {c.title}
              </h3>
              <p className="text-sm text-ink-muted">{c.desc}</p>
            </Link>
          ))}
        </div>
      </div>

    </div>
    </div>
  );
}
