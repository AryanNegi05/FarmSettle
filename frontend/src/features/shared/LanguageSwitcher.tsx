import { LANGUAGES, Lang, useI18n } from "../../i18n";

export default function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("lang.label")} title={t("lang.label")}
      className="bg-sunken border border-line-strong text-ink text-xs rounded-xl px-2 py-1.5 focus:outline-none focus:border-accent">
      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  );
}
