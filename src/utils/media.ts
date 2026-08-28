/**
 * Media-kind helpers shared by the gallery, the markdown video embed and the
 * thumbnail generator.
 *
 * Deliberately dependency-free: `astro.config.ts` pulls this module in (through
 * the rehype video plugin) outside the Astro/Vite module graph, so it must not
 * reach for `astro:*`, `@/config` or `import.meta.env`.
 */

/**
 * URL extensions rendered as video rather than as an image.
 *
 * Video is recognised by extension alone, so the authoring syntax stays the
 * markdown image one — `![caption](https://host/album/clip.mp4)`. Posts, the
 * gallery extractor and the thumbnail generator therefore all keep scanning a
 * single pattern, and a post never has to declare which lines are clips.
 *
 * This MUST stay in sync with `VIDEO_EXTS` in
 * `scripts/generate-gallery-thumbs.mjs`.
 */
export const VIDEO_EXTENSIONS = [".mp4", ".webm", ".mov", ".m4v"] as const;

const VIDEO_EXTENSION_SET: ReadonlySet<string> = new Set(VIDEO_EXTENSIONS);

/**
 * Does this URL (or path) point at a video? Query strings and fragments are
 * ignored and matching is case-insensitive. Absolute URLs and the relative
 * paths that can appear in a markdown source are both accepted.
 */
export function isVideoUrl(url: string): boolean {
  if (!url) return false;
  let pathname: string;
  try {
    pathname = new URL(url).pathname;
  } catch {
    // Relative path: trim the query/fragment by hand.
    pathname = url.split(/[?#]/)[0] ?? "";
  }
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) return false;
  return VIDEO_EXTENSION_SET.has(pathname.slice(dot).toLowerCase());
}

/** Format a duration in seconds as `m:ss`, or `h:mm:ss` from an hour up. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const total = Math.round(seconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}
