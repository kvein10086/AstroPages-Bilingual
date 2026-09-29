/**
 * Bilingual routing helpers (fork-specific).
 *
 * Routing scheme: Chinese (default locale) is served at the site root (`/foo`),
 * English is served under the `/en/` prefix (`/en/foo`). Astro's native i18n
 * (`Astro.currentLocale`, `getRelativeLocaleUrl`) handles locale detection and
 * link building; these helpers only describe the locales. Mapping a page to
 * its counterpart in the other language needs the content collections, so it
 * lives in `src/utils/resolveAlternate.ts`.
 */

export const DEFAULT_LOCALE = "zh";

/**
 * `hreflang` is the BCP 47 tag used for `<link rel="alternate" hreflang>` and
 * the RSS `<language>` element; `label` is the language's own name and
 * `shortLabel` the abbreviation the language switcher shows beside its icon.
 */
export const LOCALES = [
  { code: "zh", label: "中文", shortLabel: "中", hreflang: "zh-CN" },
  { code: "en", label: "English", shortLabel: "EN", hreflang: "en" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export type LocaleInfo = (typeof LOCALES)[number];

/** The `LOCALES` entry for `locale`; unknown codes get the default (first). */
export function getLocaleInfo(locale: string): LocaleInfo {
  return LOCALES.find(({ code }) => code === locale) ?? LOCALES[0];
}

/** Detect the locale from a URL pathname (en under `/en/`, otherwise zh). */
export function getLocaleFromPath(pathname: string): Locale {
  const first = pathname.split("/").filter(Boolean)[0];
  return first === "en" ? "en" : "zh";
}
