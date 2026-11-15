import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../hooks/useAuth";
import { BankAccountOut, FarmOut, PolicyOut, getBankAccount, getMyFarms, listPolicies } from "../../api/registry";
import { FarmerClaimItem, getMyClaims } from "../../api/farmerClaims";
import { useI18n } from "../../i18n";
import { StatusPill, Tracker, inr } from "./claimUi";
import LossReportCard from "./LossReportCard";

const CLOSED = ["PAID", "REJECTED"];

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="bg-surface shadow-card border border-line rounded-2xl p-4">
      <p className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${tone ?? "text-ink"}`}>{value}</p>
      {sub && <p className="text-xs text-ink-faint">{sub}</p>}
    </div>
  );
}

export default function FarmerDashboard() {
  const { user } = useAuth();
  const { t, date } = useI18n();
  const [claims, setClaims] = useState<FarmerClaimItem[]>([]);
  const [policies, setPolicies] = useState<PolicyOut[]>([]);
  const [farms, setFarms] = useState<FarmOut[]>([]);
  const [bank, setBank] = useState<BankAccountOut | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.allSettled([getMyClaims(), listPolicies(), getMyFarms(), getBankAccount()]).then(([c, p, f, b]) => {
      if (c.status === "fulfilled") setClaims(c.value);
      if (p.status === "fulfilled") setPolicies(p.value);
      if (f.status === "fulfilled") setFarms(f.value);
      if (b.status === "fulfilled") setBank(b.value);
      setReady(true);
    });
  }, []);

  const active = claims.filter((c) => !CLOSED.includes(c.status.code));
  const past = claims.filter((c) => CLOSED.includes(c.status.code));
  const paid = claims.filter((c) => c.status.code === "PAID").reduce((s, c) => s + c.amount, 0);
  const pending = active.reduce((s, c) => s + c.amount, 0);
  const activePolicies = policies.filter((p) => p.status === "active");

  // Things only the farmer can fix, most important first.
  const todo: { text: string; to: string; cta: string }[] = [];
  if (ready && farms.length === 0) todo.push({ text: t("todo.noFarm"), to: "/farmer/farms/new", cta: t("todo.addFarm") });
  if (ready && farms.length > 0 && policies.length === 0) todo.push({ text: t("todo.noPolicy"), to: "/farmer/farms", cta: t("todo.myFarms") });
  if (ready && !bank) todo.push({ text: active.some((c) => c.amount > 0) ? t("todo.bankWithClaim") : t("todo.bankNone"), to: "/farmer/bank", cta: t("todo.addBank") });
  if (bank && bank.verification_status !== "verified") todo.push({ text: t("todo.bankStatus", { status: t(`bank.${bank.verification_status}`) }), to: "/farmer/bank", cta: t("todo.checkBank") });

  return (
    <div className="relative -mt-[80px] pt-[80px] overflow-hidden">
      {/* Background photo that fades out toward the bottom */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-cover bg-center opacity-70"
        style={{
          backgroundImage: "url(/farmer-bg.jpg)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 0%, #000 35%, transparent 100%)",
          maskImage: "linear-gradient(to bottom, #000 0%, #000 35%, transparent 100%)",
        }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[620px] bg-gradient-to-b from-paper/40 via-transparent to-transparent" />

    <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-7">
      <div>
        <h1 className="text-3xl font-bold text-ink">{t("dash.welcome", { name: user?.full_name ?? "" })}</h1>
        <p className="text-ink-muted mt-1">{t("dash.subtitle")}</p>
      </div>

      {todo.length > 0 && (
        <div className="space-y-2">
          {todo.map((t) => (
            <div key={t.text} className="flex items-center justify-between gap-3 flex-wrap bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <p className="text-sm text-amber-800">⚑ {t.text}</p>
              <Link to={t.to} className="text-xs font-semibold bg-amber-500 text-white px-3 py-1.5 rounded-lg">{t.cta}</Link>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label={t("stat.activeClaims")} value={String(active.length)} sub={pending > 0 ? t("stat.inProgress", { amount: inr(pending) }) : t("stat.nothingWaiting")} tone={active.length ? "text-accent" : undefined} />
        <Stat label={t("stat.paidSoFar")} value={inr(paid)} sub={t("stat.claimsCount", { n: claims.filter((c) => c.status.code === "PAID").length })} tone={paid ? "text-green-700" : undefined} />
        <Stat label={t("stat.activePolicies")} value={String(activePolicies.length)} sub={t("stat.ofN", { n: policies.length })} />
        <Stat label={t("stat.farms")} value={String(farms.length)} sub={farms.reduce((s, f) => s + (f.area_hectares ?? 0), 0).toFixed(1) + " ha"} />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">{t("dash.activeClaims")}</h2>
          <Link to="/farmer/claims" className="text-xs text-accent hover:underline">{t("dash.allClaims")}</Link>
        </div>
        {!ready && <p className="text-ink-muted text-sm">{t("common.loading")}</p>}
        {ready && active.length === 0 && (
          <div className="bg-surface shadow-card border border-line rounded-2xl p-6 text-sm text-ink-muted">
            {t("dash.noActive")}
          </div>
        )}
        {active.map((c) => (
          <Link key={c.id} to={`/farmer/claims/${encodeURIComponent(c.id)}`}
            className="block bg-surface shadow-card border border-line hover:border-accent rounded-2xl p-5 space-y-3 transition">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <p className="text-ink font-semibold">{c.amount > 0 ? inr(c.amount) : t("claim.noPayout")} <span className="text-sm font-normal text-ink-muted">· {c.farm_name ?? t("claim.yourFarm")}</span></p>
                <p className="text-xs text-ink-faint">{c.policy_number} · {date(c.created_at)}</p>
              </div>
              <StatusPill status={c.status} />
            </div>
            <Tracker status={c.status} />
            <div className="flex justify-between gap-3 flex-wrap text-xs">
              <span className="text-ink-soft">{t(`status.${c.status.code}.next`)}</span>
              <span className="text-accent">{t("claim.whyAmount")}</span>
            </div>
          </Link>
        ))}
      </section>

      {past.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">{t("dash.pastClaims")}</h2>
          <div className="bg-surface shadow-card border border-line rounded-2xl divide-y divide-line/60">
            {past.map((c) => (
              <Link key={c.id} to={`/farmer/claims/${encodeURIComponent(c.id)}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-sunken/30">
                <div>
                  <p className="text-sm text-ink">{c.amount > 0 ? inr(c.amount) : t("claim.noPayout")} · {c.farm_name ?? t("claim.yourFarm")}</p>
                  <p className="text-xs text-ink-faint">{c.paid_at ? t("dash.paidOn", { date: date(c.paid_at) }) : date(c.created_at)}</p>
                </div>
                <StatusPill status={c.status} />
              </Link>
            ))}
          </div>
        </section>
      )}

      <LossReportCard farms={farms} />

      <div className="grid md:grid-cols-2 gap-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-ink">{t("dash.myPolicies")}</h2><Link to="/farmer/policy" className="text-xs text-accent hover:underline">{t("dash.details")}</Link></div>
          {ready && policies.length === 0 && <p className="text-sm text-ink-muted bg-surface shadow-card border border-line rounded-2xl p-4">{t("dash.noPolicyIssued")}</p>}
          {policies.map((p) => (
            <div key={p.id} className="bg-surface shadow-card border border-line rounded-2xl p-4 text-sm space-y-1">
              <div className="flex justify-between"><span className="font-mono text-accent">{p.policy_number}</span><span className="text-xs text-ink-muted">{t(`policy.${p.status}`)}</span></div>
              <p className="text-ink-soft">{t("dash.policyLine", { farm: p.farm_name ?? "", amount: inr(p.sum_insured) })}</p>
              <p className="text-xs text-ink-faint">{t("dash.paysWhen", { trigger: p.rainfall_trigger_mm ?? "?", start: p.coverage_start, end: p.coverage_end })}</p>
            </div>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-ink">{t("dash.payoutAccount")}</h2>
          {bank ? (
            <div className="bg-surface shadow-card border border-line rounded-2xl p-4 text-sm space-y-1">
              <p className="text-ink">{bank.bank_name ?? "Bank"} · {bank.masked_account_number}</p>
              <p className="text-xs text-ink-muted">{bank.account_holder_name}</p>
              <p className={`text-xs ${bank.verification_status === "verified" ? "text-green-700" : "text-amber-700"}`}>{t(`bank.${bank.verification_status}`)}</p>
            </div>
          ) : <Link to="/farmer/bank" className="block text-sm text-amber-800 bg-surface shadow-card border border-amber-200 rounded-2xl p-4">{t("dash.noAccount")}</Link>}
          <div className="grid grid-cols-2 gap-2 pt-1 text-sm">
            {[[t("link.farms"), "/farmer/farms"], [t("link.map"), "/farmer/map"], [t("link.profile"), "/farmer/profile"], [t("link.bank"), "/farmer/bank"]].map(([l, to]) => (
              <Link key={to} to={to} className="bg-surface border border-line hover:border-accent rounded-xl px-3 py-2 text-ink-soft">{l}</Link>
            ))}
          </div>
        </section>
      </div>
    </div>
    </div>
  );
}
