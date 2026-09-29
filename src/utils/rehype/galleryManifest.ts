import { readFileSync } from "node:fs";

/**
 * Build-time access to the gallery manifest for the rehype plugins.
 *
 * The thumbnail generator (`scripts/generate-gallery-thumbs.mjs`) records the
 * intrinsic dimensions — and for clips a poster — of every media URL the
 * gallery selects, ahead of the build. The markdown plugins use it to size
 * `<img>` and `<video>` before the file itself arrives.
 *
 * The manifest is read with `node:fs` rather than imported because this module
 * is pulled in by `astro.config.ts`, outside the Astro/Vite module graph.
 *
 * One local gotcha: Astro caches rendered markdown by post content (in
 * `node_modules/.astro`), and the manifest is an input it doesn't know about.
 * After regenerating thumbnails locally, clear that cache to see the change.
 * CI builds from a fresh clone, so deployments are never stale.
 */

export interface ManifestEntry {
  thumb?: string;
  width?: number;
  height?: number;
}

/**
 * Read the manifest once, at module load. Missing (or malformed) is normal
 * before the generator's first run and must not break the build.
 */
function readManifest(): Record<string, ManifestEntry> {
  try {
    const file = new URL("../../data/gallery-manifest.json", import.meta.url);
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
}

const manifest = readManifest();

/**
 * The manifest entry for a rendered `src`, if there is one.
 *
 * The manifest is keyed by the URL as written in the markdown, but by the time
 * a rehype plugin sees it, remark has percent-encoded every non-ASCII
 * character (a CJK filename, say). Try the attribute as-is first, then its
 * decoded form — the same lookup the post page's image script does.
 */
export function manifestEntry(src: string): ManifestEntry | undefined {
  if (manifest[src]) return manifest[src];
  try {
    return manifest[decodeURI(src)];
  } catch {
    return undefined; // malformed escape: nothing to match anyway
  }
}
