import { ClaimStatusView } from "../../api/farmerClaims";
import { fmtInr, useI18n } from "../../i18n";

export const inr = fmtInr;

export const TONE: Record<string, string> = {
  good: "bg-green-900/40 text-green-300 border-green-700",
  info: "bg-blue-900/40 text-blue-300 border-blue-700",
  warn: "bg-amber-900/40 text-amber-200 border-amber-700",
  bad: "bg-red-900/40 text-red-300 border-red-700",
};

export function StatusPill({ status }: { status: ClaimStatusView }) {
  const { t } = useI18n();
  return <span className={`text-xs px-2.5 py-0.5 rounded-full border font-medium ${TONE[status.tone]}`}>{t(`status.${status.code}.label`)}</span>;
}

/** Five-step progress: Rain detected → Evidence checked → Insurer review → Approved → Paid. */
export function Tracker({ status, compact }: { status: ClaimStatusView; compact?: boolean }) {
  const { t } = useI18n();
  return (
    <ol className="flex items-start w-full">
      {status.tracker.map((_label, i) => {
        const done = i <= status.step;
        const current = i === status.step;
        const stuck = current && status.stopped;
        const dot = stuck ? "bg-amber-500 border-amber-300" : done ? "bg-brand-green border-brand-green" : "bg-navy-900 border-navy-600";
        return (
          <li key={i} className="flex-1 min-w-0">
            <div className="flex items-center">
              <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${dot} ${current && !stuck ? "ring-4 ring-green-500/20" : ""}`} />
              {i < status.tracker.length - 1 && <span className={`h-0.5 flex-1 ${i < status.step ? "bg-brand-green" : "bg-navy-600"}`} />}
            </div>
            {!compact && <p className={`mt-1.5 text-[11px] leading-tight pr-1 ${done ? "text-gray-200" : "text-gray-500"}`}>{t(`tracker.${i}`)}</p>}
          </li>
        );
      })}
    </ol>
  );
}
