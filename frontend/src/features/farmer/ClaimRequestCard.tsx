import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FarmOut } from "../../api/registry";
import { ClaimRequest, applyForClaim, getMyClaimRequests } from "../../api/claimRequests";
import { useI18n } from "../../i18n";

const OPEN = ["pending", "assessed", "on_hold"];
const TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800", assessed: "bg-blue-100 text-blue-800", on_hold: "bg-gray-200 text-ink-soft",
  approved: "bg-green-100 text-green-800", rejected: "bg-red-100 text-red-800",
};

/** The farmer applies for a claim on one of their farms. The insurer assesses it against the rainfall at that farm. */
export default function ClaimRequestCard({ farms }: { farms: FarmOut[] }) {
  const { t, date } = useI18n();
  const [open, setOpen] = useState(false);
  const [farmId, setFarmId] = useState(farms[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [past, setPast] = useState<ClaimRequest[]>([]);

  useEffect(() => { if (!farmId && farms[0]) setFarmId(farms[0].id); }, [farms, farmId]);
  useEffect(() => { getMyClaimRequests().then(setPast).catch(() => setPast([])); }, [sent]);

  async function submit() {
    setBusy(true); setErr(null);
    try { await applyForClaim({ farm_id: farmId, note: note.trim() || undefined }); setSent(true); setNote(""); setOpen(false); }
    catch (e) { setErr(e instanceof Error ? e.message : "Could not send the request"); }
    finally { setBusy(false); }
  }

  if (farms.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-ink">{t("creq.title")}</h2>
      <div className="bg-surface shadow-card border border-line rounded-2xl p-4 space-y-3">
        <p className="text-sm text-ink-muted">{t("creq.intro")}</p>
        {sent && !open && <p className="text-sm text-green-700">✓ {t("creq.sent")}</p>}
        {!open && <button onClick={() => { setOpen(true); setSent(false); setErr(null); }} className="text-sm font-semibold px-4 py-2 rounded-full bg-accent text-white">{t("creq.open")}</button>}
        {open && (
          <div className="space-y-3">
            <label className="block text-xs text-ink-muted">{t("creq.farm")}
              <select value={farmId} onChange={(e) => setFarmId(e.target.value)} className="mt-1 w-full bg-paper border border-line rounded-lg px-3 py-2 text-sm text-ink">
                {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </label>
            <label className="block text-xs text-ink-muted">{t("creq.note")}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full bg-paper border border-line rounded-lg px-3 py-2 text-sm text-ink" />
            </label>
            {err && <p className="text-xs text-red-700">{err}</p>}
            <div className="flex gap-2">
              <button disabled={busy || !farmId} onClick={submit} className="text-sm font-semibold px-4 py-2 rounded-full bg-accent text-white disabled:opacity-50">{busy ? t("creq.sending") : t("creq.submit")}</button>
              <button disabled={busy} onClick={() => setOpen(false)} className="text-sm px-4 py-2 rounded-lg bg-sunken text-ink">{t("creq.close")}</button>
            </div>
            <p className="text-[11px] text-ink-faint">{t("creq.footer")}</p>
          </div>
        )}
        {past.length > 0 && (
          <div className="pt-1 space-y-1.5">
            <p className="text-[11px] uppercase tracking-wide text-ink-muted">{t("creq.past")}</p>
            {past.slice(0, 4).map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-xs text-ink-soft">
                <span>{r.farm_name} · {date(r.created_at, false)}</span>
                <span className="flex items-center gap-2">
                  {r.claim_id && !OPEN.includes(r.status) && <Link to={`/farmer/claims/${encodeURIComponent(r.claim_id)}`} className="text-accent hover:underline">{t("creq.viewClaim")}</Link>}
                  <span className={`px-2 py-0.5 rounded-full ${TONE[r.status]}`}>{t(`creq.s.${r.status}`)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
