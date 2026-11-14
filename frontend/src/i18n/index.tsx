import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Dict, DictKey, en } from "./en";
import { hi } from "./hi";
import { mr } from "./mr";

export type Lang = "en" | "hi" | "mr";
export const LANGUAGES: { code: Lang; label: string }[] = [
  { code: "en", label: "English" }, { code: "hi", label: "हिन्दी" }, { code: "mr", label: "मराठी" },
];
const DICTS: Record<Lang, Dict> = { en, hi, mr };
const LOCALE: Record<Lang, string> = { en: "en-IN", hi: "hi-IN", mr: "mr-IN" };
const STORE = "paratrust.lang";

type Vars = Record<string, unknown>;

function readLang(): Lang {
  try { const v = localStorage.getItem(STORE); if (v === "hi" || v === "mr" || v === "en") return v; } catch { /* private mode */ }
  return "en";
}

// Latin digits and Indian (lakh) grouping in every language, so amounts match the bank and the receipts.
const NUM = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
export const fmtNum = (n: number) => NUM.format(n);
export const fmtInr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function interpolate(template: string, vars: Vars): string {
  return template.replace(/\{(\w+)(?::(\w+))?\}/g, (_m, k: string, f?: string) => {
    const v = vars[k];
    if (v === null || v === undefined || v === "") return "—";
    switch (f) {
      case "inr": return fmtInr(Number(v));
      case "pct": return `${Math.round(Number(v) * 100)}%`;
      case "num": return fmtNum(Number(v));
      default: return String(v);
    }
  });
}

interface I18n {
  lang: Lang; setLang: (l: Lang) => void;
  /** Translate a key; `vars` fill {placeholders} (formats: :inr, :pct, :num). Unknown keys fall back to English, then the key. */
  t: (key: string, vars?: Vars) => string;
  has: (key: string) => boolean;
  date: (iso?: string | null, withTime?: boolean) => string;
}

const Ctx = createContext<I18n | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(STORE, l); } catch { /* ignore */ }
    document.documentElement.lang = l;
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = DICTS[lang] as Record<string, string>;
    const base = en as Record<string, string>;
    return {
      lang, setLang,
      t: (key, vars = {}) => interpolate(dict[key] ?? base[key] ?? key, vars),
      has: (key) => key in base,
      date: (iso, withTime = true) => !iso ? "" : new Date(iso).toLocaleString(`${LOCALE[lang]}-u-nu-latn`,
        { day: "numeric", month: "short", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }),
    };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error("useI18n must be used inside <LanguageProvider>");
  return v;
}

export type { DictKey };
