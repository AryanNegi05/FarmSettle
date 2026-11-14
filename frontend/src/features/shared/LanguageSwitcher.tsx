import { LANGUAGES, Lang, useI18n } from "../../i18n";

export default function LanguageSwitcher() {
  const { lang, setLang, t } = useI18n();
  return (
    <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t("lang.label")} title={t("lang.label")}
      className="bg-navy-700 border border-navy-600 text-white text-xs rounded-lg px-2 py-1.5 focus:outline-none focus:border-brand-blue">
      {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  );
}
