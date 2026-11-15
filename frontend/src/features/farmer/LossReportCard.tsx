import { useEffect, useState } from "react";
import { FarmOut } from "../../api/registry";
import { LossReport, getMyLossReports, reportMyLoss } from "../../api/basisRisk";
import { useI18n } from "../../i18n";

const CAUSES = ["excess_rain", "flood", "waterlogging", "drought", "pest_disease", "other"] as const;

/** The farmer tells the insurer about crop loss. It is an input to the insurer's Basis Risk Monitor only. */
export default function LossReportCard({ farms }: { farms: FarmOut[] }) {
  const { t, date } = useI18n();
  const [open, setOpen] = useState(false);
  const [farmId, setFarmId] = useState(farms[0]?.id ?? "");
  const [pct, setPct] = useState(30);
  const [cause, setCause] = useState<string>("excess_rain");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [past, setPast] = useState<LossReport[]>([]);

  useEffect(() => { if (!farmId && farms[0]) setFarmId(farms[0].id); }, [farms, farmId]);
  useEffect(() => { getMyLossReports().then(setPast).catch(() => setPast([])); }, [done]);

  async function submit() {
    setBusy(true); setErr(null);
    try { await reportMyLoss({ farm_id: farmId, loss_pct: pct, cause, note }); setDone(true); setNote(""); setOpen(false); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not send the report"); }
    finally { setBusy(false); }
  }

  if (farms.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-ink">{t("rep.title")}</h2>
      <div className="bg-surface shadow-card border border-line rounded-2xl p-4 space-y-3">
        <p className="text-sm text-ink-muted">{t("rep.intro")}</p>
        {done && !open && <p className="text-sm text-green-700">✓ {t("rep.thanks")}</p>}
        {!open && <button onClick={() => { setOpen(true); setDone(false); }} className="text-sm font-semibold px-4 py-2 rounded-lg bg-sunken hover:bg-line text-ink">{t("rep.open")}</button>}
        {open && (
          <div className="space-y-3">
            {farms.length > 1 && (
              <label className="block text-xs text-ink-muted">{t("rep.farm")}
                <select value={farmId} onChange={(e) => setFarmId(e.target.value)} className="mt-1 w-full bg-paper border border-line rounded-lg px-3 py-2 text-sm text-ink">
                  {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </label>
            )}
            <label className="block text-xs text-ink-muted">{t("rep.loss", { pct })}
              <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(+e.target.value)} className="mt-1 w-full" />
            </label>
            <label className="block text-xs text-ink-muted">{t("rep.cause")}
              <select value={cause} onChange={(e) => setCause(e.target.value)} className="mt-1 w-full bg-paper border border-line rounded-lg px-3 py-2 text-sm text-ink">
                {CAUSES.map((c) => <option key={c} value={c}>{t(`cause.${c}`)}</option>)}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">{t("rep.note")}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full bg-paper border border-line rounded-lg px-3 py-2 text-sm text-ink" />
            </label>
            {err && <p className="text-xs text-red-700">{err}</p>}
            <div className="flex gap-2">
              <button disabled={busy || !farmId} onClick={submit} className="text-sm font-semibold px-4 py-2 rounded-full bg-accent text-white disabled:opacity-50">{busy ? t("rep.sending") : t("rep.submit")}</button>
              <button disabled={busy} onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-sunken text-ink">{t("rep.close")}</button>
            </div>
            <p className="text-[11px] text-ink-faint">{t("rep.footer")}</p>
          </div>
        )}
        {past.length > 0 && (
          <div className="pt-1 space-y-1">
            <p className="text-[11px] uppercase tracking-wide text-ink-muted">{t("rep.past")}</p>
            {past.slice(0, 3).map((r) => (
              <p key={r.id} className="text-xs text-ink-soft">{t("rep.pastLine", { pct: r.loss_pct, cause: t(`cause.${r.cause}`), date: date(r.observed_on, false) })}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
