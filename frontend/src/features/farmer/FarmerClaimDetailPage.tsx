import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { FarmerClaimDetail, challengeClaim, getMyClaim } from "../../api/farmerClaims";
import { useI18n } from "../../i18n";
import { StatusPill, TONE, Tracker, inr } from "./claimUi";

/** Rain bar: the farm's estimated rain (with its likely range) against the policy trigger and full-payout levels. */
function RainBar({ g }: { g: FarmerClaimDetail["gauge"] }) {
  const { t } = useI18n();
  const max = Math.max(g.full ?? 0, g.rain_high, g.trigger ?? 0, 1) * 1.1;
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / max) * 100))}%`;
  return (
    <div className="space-y-2">
      <div className="relative h-9 rounded-lg bg-paper border border-line overflow-hidden">
        {g.trigger != null && g.full != null && (
          <div className="absolute inset-y-0 bg-gradient-to-r from-accent-soft to-green-500/30" style={{ left: pct(g.trigger), width: `calc(${pct(g.full)} - ${pct(g.trigger)})` }} />
        )}
        <div className="absolute inset-y-2 rounded bg-accent/25" style={{ left: pct(g.rain_low), width: `calc(${pct(g.rain_high)} - ${pct(g.rain_low)})` }} />
        <div className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: pct(g.rain) }} />
        {g.trigger != null && <div className="absolute inset-y-0 w-0.5 bg-amber-400" style={{ left: pct(g.trigger) }} />}
        {g.full != null && <div className="absolute inset-y-0 w-0.5 bg-green-400" style={{ left: pct(g.full) }} />}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-muted">
        <span><i className="inline-block w-2 h-2 rounded-sm bg-accent mr-1" />{t("bar.estimated", { mu: g.rain.toFixed(1) })}</span>
        {g.trigger != null && <span><i className="inline-block w-2 h-2 rounded-sm bg-amber-400 mr-1" />{t("bar.start", { v: g.trigger })}</span>}
        {g.full != null && <span><i className="inline-block w-2 h-2 rounded-sm bg-green-400 mr-1" />{t("bar.full", { v: g.full })}</span>}
      </div>
    </div>
  );
}

const DISPUTE_TONE: Record<string, string> = {
  open: "text-amber-700 border-amber-200 bg-amber-50",
  upheld: "text-green-700 border-green-200 bg-green-50",
  dismissed: "text-ink-soft border-line-strong bg-paper/40",
};

function ChallengeCard({ d, onUpdated }: { d: FarmerClaimDetail; onUpdated: (x: FarmerClaimDetail) => void }) {
  const { t, lang, date } = useI18n();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState(d.dispute.categories[0]?.id ?? "other");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const dp = d.dispute;
  const tr = d.translations ?? {};

  async function submit() {
    if (reason.trim().length < 10) { setErr(t("ch.tooShort")); return; }
    setBusy(true); setErr(null);
    try { onUpdated(await challengeClaim(d.id, category, reason.trim(), lang)); setOpen(false); setReason(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not send your challenge"); }
    finally { setBusy(false); }
  }

  return (
    <div className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-3">
      <h3 className="text-ink font-semibold">{t("ch.title")}</h3>
      {dp.items.map((it) => (
        <div key={it.id} className={`rounded-lg border p-3 text-sm space-y-1 ${DISPUTE_TONE[it.status]}`}>
          <div className="flex justify-between gap-2 flex-wrap">
            <span className="font-medium">{t("ch.yours", { n: it.id, cat: t(`cat.${it.category_id}`) })}</span>
            <span className="text-xs">{t(`ch.status.${it.status}`)}</span>
          </div>
          <p className="text-ink-soft">“{it.reason}”</p>
          <p className="text-[11px] text-ink-faint">{t("ch.sent", { date: date(it.created_at) })}</p>
          {it.response && <p className="text-ink-soft">{t("ch.answer", { text: tr[`response_${it.id}`] ?? it.response })}</p>}
          {it.outcome?.additional_amount != null && <p className="text-green-700">{t("ch.extra", { amount: inr(it.outcome.additional_amount) })}</p>}
          {it.outcome?.new_amount != null && <p className="text-green-700">{t("ch.back", { amount: inr(it.outcome.new_amount) })}</p>}
        </div>
      ))}
      {dp.open && <p className="text-xs text-ink-muted">{t("ch.openNote")}</p>}
      {!dp.open && dp.can_challenge && !open && (
        <>
          <p className="text-sm text-ink-muted">{t("ch.intro")}</p>
          <button onClick={() => setOpen(true)} className="text-sm font-semibold px-4 py-2 rounded-lg bg-amber-500 text-white hover:opacity-90">{t("ch.button")}</button>
        </>
      )}
      {!dp.open && dp.can_challenge && open && (
        <div className="space-y-3">
          <label className="block text-xs text-ink-muted">{t("ch.what")}
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="mt-1 w-full bg-paper border border-line rounded-lg px-3 py-2 text-sm text-ink">
              {dp.categories.map((c) => <option key={c.id} value={c.id}>{t(`cat.${c.id}`)}</option>)}
            </select>
          </label>
          <label className="block text-xs text-ink-muted">{t("ch.tell")}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={1000} placeholder={t("ch.placeholder")}
              className="mt-1 w-full bg-paper border border-line rounded-lg px-3 py-2 text-sm text-ink placeholder-gray-500" />
          </label>
          {err && <p className="text-xs text-red-700">{err}</p>}
          <div className="flex gap-2">
            <button disabled={busy} onClick={submit} className="text-sm font-semibold px-4 py-2 rounded-lg bg-amber-500 text-white disabled:opacity-50">{busy ? t("ch.sending") : t("ch.send")}</button>
            <button disabled={busy} onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-sunken text-ink">{t("ch.cancel")}</button>
          </div>
          <p className="text-[11px] text-ink-faint">{t("ch.footer")}</p>
        </div>
      )}
      {!dp.open && !dp.can_challenge && dp.blocked_code && <p className="text-xs text-ink-faint">{t(`ch.blocked.${dp.blocked_code}`)}</p>}
    </div>
  );
}

export default function FarmerClaimDetailPage() {
  const { claimId } = useParams();
  const { t, lang, date } = useI18n();
  const [d, setD] = useState<FarmerClaimDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!claimId) return;
    getMyClaim(claimId, lang).then(setD).catch((e) => setError(e instanceof Error ? e.message : "Could not load this claim"));
  }, [claimId, lang]);

  if (error) return <div className="max-w-3xl mx-auto px-6 py-10"><p className="text-red-700">{error}</p><Link to="/farmer/claims" className="text-accent text-sm">{t("claim.back")}</Link></div>;
  if (!d) return <p className="text-ink-muted px-6 py-10">{t("common.loading")}</p>;

  const tr = d.translations ?? {};
  const farm = d.farm_name ?? t("claim.yourFarm");
  const aiText = tr.ai_summary ?? d.ai_summary;
  const reasonText = tr.decision_reason ?? d.decision.reason;
  const machineTranslated = Boolean(tr.ai_summary || tr.decision_reason || Object.keys(tr).some((k) => k.startsWith("response_")));

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <Link to="/farmer/claims" className="text-sm text-accent hover:underline">{t("claim.back")}</Link>

      <div className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-ink">{d.amount > 0 ? t("headline.amount", { amount: inr(d.amount), farm }) : t("headline.none")}</h1>
            <p className="text-xs text-ink-faint mt-1">{d.policy_number} · {t("claim.opened", { date: date(d.created_at) })}</p>
          </div>
          <StatusPill status={d.status} />
        </div>
        <Tracker status={d.status} />
        <p className={`text-sm rounded-lg border px-3 py-2 ${TONE[d.status.tone]}`}>{t(`status.${d.status.code}.next`)}</p>
      </div>

      <div className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-3">
        <h2 className="text-ink font-semibold">{t("detail.why")}</h2>
        <RainBar g={d.gauge} />
        <p className="text-xs text-ink-muted">{t("formula.text")}</p>
      </div>

      {d.sections.map((s) => (
        <div key={s.id} className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-3">
          <h3 className="text-ink font-semibold">{t(`sec.${s.id}`)}</h3>
          <dl className="divide-y divide-line/60 text-sm">
            {s.rows.map((r) => (
              <div key={r.key ?? r.label} className="flex justify-between gap-4 py-1.5">
                <dt className="text-ink-muted">{r.key ? t(r.key, r.vars) : r.label}</dt>
                <dd className="text-ink text-right font-medium">{r.vkey ? t(r.vkey, r.vars) : r.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-ink-muted leading-relaxed">{s.note_key ? t(s.note_key) : s.note}</p>
        </div>
      ))}

      {aiText && (
        <div className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-1">
          <h3 className="text-ink font-semibold">{t("ai.title")}</h3>
          <p className="text-sm text-ink-soft">{aiText}</p>
          <p className="text-[11px] text-ink-faint">{t("ai.footer")}{machineTranslated && ` ${t("ai.translated")}`}</p>
        </div>
      )}

      {d.checks.length > 0 && (
        <div className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-2">
          <h3 className="text-ink font-semibold">{t("sec.checks")}</h3>
          <ul className="text-sm space-y-1">
            {d.checks.map((c) => (
              <li key={c.id} className={c.ok ? "text-green-700" : "text-amber-700"}>{c.ok ? "✓" : "⚠"} {t(`check.${c.id}`)}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-2">
        <h3 className="text-ink font-semibold">{t("sec.decided", { n: d.checks.length ? 5 : 4 })}</h3>
        {d.decision.by_human
          ? <p className="text-sm text-ink-soft">
              {d.decision.at ? t("decided.on", { date: date(d.decision.at) }) : t("decided.yes")}
              {reasonText && <> {t("decided.note", { reason: reasonText })}</>}
            </p>
          : <p className="text-sm text-ink-soft">{t("decided.no")}</p>}
      </div>

      <ChallengeCard d={d} onUpdated={setD} />

      {d.payment && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-1">
          <h3 className="text-green-700 font-semibold">{t("payment.title")}</h3>
          <p className="text-ink text-lg font-semibold">{inr(d.payment.amount)}</p>
          <p className="text-sm text-ink-soft">{t("payment.sentTo", { bank: d.payment.bank ?? "", account: d.payment.to ?? "" })}</p>
          <p className="text-xs text-ink-faint">{t("payment.ref", { ref: d.payment.reference, date: date(d.payment.at) })}</p>
        </div>
      )}

      <div className="bg-surface shadow-card border border-line rounded-2xl p-5 space-y-3">
        <h3 className="text-ink font-semibold">{t("sec.timeline")}</h3>
        <ol className="space-y-3 border-l border-line-strong ml-1.5">
          {d.timeline.map((x, i) => (
            <li key={i} className="pl-4 relative">
              <span className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-accent" />
              <p className="text-sm text-ink">{t(`timeline.${x.code}`)}</p>
              <p className="text-xs text-ink-faint">{date(x.at)}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
