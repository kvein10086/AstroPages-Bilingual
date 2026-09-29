import { getRelativeLocaleUrl } from "astro:i18n";
import { getLocaleInfo } from "@/i18n/helpers";
import config from "@/config";

/**
 * Root-relative URL of a locale's RSS feed: `/rss.xml` or `/en/rss.xml`
 * (base-aware).
 *
 * Built from the locale's home URL rather than `getRelativeLocaleUrl(locale,
 * "rss.xml")`, which appends a trailing slash — `/rss.xml/` works on the dev
 * server but 404s on Cloudflare Pages, so feed readers doing autodiscovery got
 * a dead link. Every place that links to a feed goes through here.
 */
export function getFeedPath(locale: string): string {
  return `${getRelativeLocaleUrl(locale, "")}rss.xml`;
}

/**
 * Feed title, suffixed with the language so readers subscribed to both feeds
 * can tell them apart. Shared by the feed itself and its autodiscovery link.
 */
export function getFeedTitle(locale: string): string {
  return `${config.site.title} · ${getLocaleInfo(locale).label}`;
}
