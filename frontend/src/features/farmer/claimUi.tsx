import { ClaimStatusView } from "../../api/farmerClaims";
import { fmtInr, useI18n } from "../../i18n";

export const inr = fmtInr;

export const TONE: Record<string, string> = {
  good: "bg-green-50 text-green-700 border-green-200",
  info: "bg-blue-50 text-accent border-blue-200",
  warn: "bg-amber-50 text-amber-700 border-amber-200",
  bad: "bg-red-50 text-red-700 border-red-200",
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
        const dot = stuck ? "bg-amber-500 border-amber-300" : done ? "bg-accent border-accent" : "bg-paper border-line-strong";
        return (
          <li key={i} className="flex-1 min-w-0">
            <div className="flex items-center">
              <span className={`w-3.5 h-3.5 rounded-full border-2 shrink-0 ${dot} ${current && !stuck ? "ring-4 ring-green-500/20" : ""}`} />
              {i < status.tracker.length - 1 && <span className={`h-0.5 flex-1 ${i < status.step ? "bg-accent" : "bg-line"}`} />}
            </div>
            {!compact && <p className={`mt-1.5 text-[11px] leading-tight pr-1 ${done ? "text-ink-soft" : "text-ink-faint"}`}>{t(`tracker.${i}`)}</p>}
          </li>
        );
      })}
    </ol>
  );
}
