import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FarmerClaimItem, getMyClaims } from "../../api/farmerClaims";
import { useI18n } from "../../i18n";
import { StatusPill, Tracker, inr } from "./claimUi";

export default function FarmerClaimsPage() {
  const { t, date } = useI18n();
  const [claims, setClaims] = useState<FarmerClaimItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    getMyClaims().then(setClaims).catch((e) => setError(e instanceof Error ? e.message : "Could not load your claims"));
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">{t("claims.title")}</h1>
        <p className="text-gray-400 text-sm">{t("claims.subtitle")}</p>
      </div>
      {error && <div className="bg-red-900/40 border border-red-700 text-red-300 rounded-lg px-4 py-3 text-sm">{error}</div>}
      {!claims && !error && <p className="text-gray-400">{t("common.loading")}</p>}
      {claims && claims.length === 0 && (
        <div className="bg-navy-800 border border-navy-700 rounded-xl p-10 text-center space-y-2">
          <p className="text-4xl">🌦️</p>
          <p className="text-white font-semibold">{t("claims.emptyTitle")}</p>
          <p className="text-gray-400 text-sm">{t("claims.emptyBody")}</p>
        </div>
      )}
      {claims?.map((c) => (
        <Link key={c.id} to={`/farmer/claims/${encodeURIComponent(c.id)}`}
          className="block bg-navy-800 border border-navy-700 hover:border-brand-blue rounded-xl p-5 space-y-4 transition">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <p className="text-white font-semibold text-lg">{c.amount > 0 ? inr(c.amount) : t("claim.noPayout")}
                <span className="text-sm font-normal text-gray-400"> · {c.farm_name ?? t("claim.yourFarm")}</span></p>
              <p className="text-xs text-gray-500">{c.policy_number} · {t("claim.opened", { date: date(c.created_at) })}</p>
            </div>
            <StatusPill status={c.status} />
          </div>
          <Tracker status={c.status} />
          <p className="text-sm text-gray-300">{t(`status.${c.status.code}.next`)}</p>
          <p className="text-xs text-brand-blue">{t("claim.whyAmount")}</p>
        </Link>
      ))}
    </div>
  );
}
