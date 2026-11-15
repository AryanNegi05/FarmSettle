import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";

const roles = [
  {
    icon: "🌾",
    tile: "bg-yellow-100",
    title: "Farmers",
    tag: "Register · Track · Receive",
    desc: "Register your farm, follow climate events, and receive transparent parametric payouts directly to your account.",
  },
  {
    icon: "🏦",
    tile: "bg-violet-100",
    title: "Insurers & Banks",
    tag: "Assess · Approve · Pay",
    desc: "AI-assisted investigation, automated risk assessment, and policy-based claim calculation with full audit trails.",
  },
  {
    icon: "📋",
    tile: "bg-orange-100",
    title: "Auditors",
    tag: "Inspect · Verify · Replay",
    desc: "Inspect every decision, replay agent actions, verify calculations, and validate the full chain of evidence.",
  },
];

const stats = [
  { label: "Simulated farms", value: "100+" },
  { label: "AI agents", value: "4" },
  { label: "Weather gauges", value: "12" },
  { label: "Audit trail", value: "100%" },
];

export default function LandingPage() {
  const { user } = useAuth();
  const [videoReady, setVideoReady] = useState(false);

  return (
    <div>
      {/* Hero — full-bleed video that sits behind the floating navbar and fades into the page */}
      <section className="relative -mt-[80px] min-h-[92vh] flex items-center justify-center overflow-hidden">
        <video
          src="/gemini_generated_video_64395702.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          onCanPlay={() => setVideoReady(true)}
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-[2000ms] ease-out ${videoReady ? "opacity-[0.75]" : "opacity-0"}`}
        />
        <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-paper/60 via-paper/10 to-paper" />

        <div className="relative max-w-4xl mx-auto px-6 pt-32 pb-28 text-center space-y-8">
          <span className="inline-block px-5 py-2 rounded-full bg-surface/60 backdrop-blur-md border border-line text-ink-soft text-sm font-medium">
            Agentic climate insurance platform
          </span>
          <h1 className="text-5xl sm:text-7xl font-extrabold leading-[1.02] tracking-tighter text-ink">
            Transparent payouts,
            <br />
            <span className="text-accent">settled by evidence.</span>
          </h1>
          <p className="text-lg sm:text-xl text-ink-soft max-w-2xl mx-auto leading-relaxed">
            FarmTrust combines AI agents, satellite data and sensor networks to investigate climate
            events and pay farmers fairly — automatically.
          </p>
          <div className="flex flex-wrap justify-center gap-4 pt-2">
            {user ? (
              <Link
                to={`/${user.role}`}
                className="px-9 py-4 bg-accent text-white font-semibold rounded-full hover:bg-accent-dark transition text-lg shadow-lift"
              >
                Go to Dashboard →
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="px-9 py-4 bg-accent text-white font-semibold rounded-full hover:bg-accent-dark transition text-lg shadow-lift"
                >
                  Sign In →
                </Link>
                <Link
                  to="/register"
                  className="px-9 py-4 bg-surface/70 backdrop-blur-md text-ink font-semibold rounded-full hover:bg-surface border border-line-strong transition text-lg"
                >
                  Register as Farmer
                </Link>
              </>
            )}
          </div>
        </div>
        <p className="absolute bottom-6 inset-x-0 text-center text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-faint">
          Scroll to explore
        </p>
      </section>

      <div className="max-w-6xl mx-auto px-6 pb-16 space-y-24">
        {/* Role cards */}
        <section className="space-y-10">
          <div className="text-center space-y-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-ink-faint">Built for every role</p>
            <h2 className="text-4xl sm:text-5xl font-extrabold tracking-tighter">Who is it for?</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {roles.map((r) => (
              <div
                key={r.title}
                className="bg-surface rounded-[2.5rem] border border-line shadow-card hover:shadow-lift hover:-translate-y-1 transition-all duration-300 p-8 text-center space-y-4"
              >
                <div className={`mx-auto grid place-items-center h-16 w-16 rounded-2xl text-3xl shadow-sm ${r.tile}`}>{r.icon}</div>
                <h3 className="text-xl font-extrabold tracking-tight text-ink">{r.title}</h3>
                <p className="text-ink-muted text-sm leading-relaxed">{r.desc}</p>
                <p className="text-[10px] font-semibold uppercase tracking-[0.25em] text-ink-faint pt-1">{r.tag}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Stats */}
        <section className="bg-surface rounded-[2.5rem] border border-line shadow-card p-10 grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="text-4xl font-extrabold tracking-tighter text-accent">{s.value}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-ink-faint mt-2">{s.label}</div>
            </div>
          ))}
        </section>

        <p className="text-center text-[11px] font-semibold uppercase tracking-[0.3em] text-ink-faint">
          Private protocol · Adaptive analysis · Simulated payments
        </p>
      </div>
    </div>
  );
}
