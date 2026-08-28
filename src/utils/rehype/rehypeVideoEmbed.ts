import { readFileSync } from "node:fs";
import { isVideoUrl } from "../media";

/**
 * Render markdown video links as a real player.
 *
 * Clips are authored with the markdown *image* syntax —
 * `![caption](https://host/album/clip.mp4)` — so a post keeps one line shape
 * for photos and videos alike, and the gallery extractor and the thumbnail
 * generator go on scanning a single pattern (see `src/utils/media.ts`). Remark
 * turns every such line into an `<img>`; this plugin rewrites the video ones.
 *
 * Poster and intrinsic dimensions come from the gallery manifest, which the
 * thumbnail generator writes ahead of the build. Before it has run — a fresh
 * clone, or a clip added since the last CI pass — the player falls back to
 * loading its own metadata, so the post still works, just without a poster.
 *
 * One local gotcha: Astro caches rendered markdown by post content (in
 * `node_modules/.astro`), and the manifest is an input it doesn't know about.
 * After regenerating thumbnails locally, clear that cache to see new posters.
 * CI builds from a fresh clone, so deployments are never stale.
 *
 * The tree walk and the hast types are hand-rolled on purpose: this module is
 * pulled in by `astro.config.ts`, so it must not import packages that are only
 * present as transitive dependencies (`unist-util-visit`, `@types/hast`).
 */

/** The sliver of hast this plugin touches. */
interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

interface ManifestEntry {
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

/** Normalize an Astro `base` to a prefix ending in exactly one slash. */
function normalizeBase(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  return trimmed === "" ? "/" : `${trimmed}/`;
}

/** Rewrite one `<img>` node into a `<video>` player, in place. */
function toVideo(node: HastNode, src: string, base: string): void {
  const entry: ManifestEntry = manifest[src] ?? {};
  const alt =
    typeof node.properties?.alt === "string" ? node.properties.alt : "";

  node.tagName = "video";
  node.children = [];
  node.properties = {
    src,
    controls: true,
    playsInline: true,
    // With a poster there is something to look at, so stay idle until the
    // reader presses play; without one, pull just enough to render a frame.
    preload: entry.thumb ? "none" : "metadata",
    className: ["md-video"],
    ...(alt ? { "aria-label": alt } : {}),
    ...(entry.thumb ? { poster: `${base}gallery/thumbs/${entry.thumb}` } : {}),
    // Reserve the right box before any metadata arrives — otherwise the article
    // reflows around the player once the browser learns its shape.
    ...(entry.width && entry.height
      ? { width: entry.width, height: entry.height }
      : {}),
  };
}

function walk(node: HastNode, base: string): void {
  if (!node.children) return;
  for (const child of node.children) {
    const src = child.properties?.src;
    if (
      child.type === "element" &&
      child.tagName === "img" &&
      typeof src === "string" &&
      isVideoUrl(src)
    ) {
      toVideo(child, src, base);
      continue; // the node has no children left to visit
    }
    walk(child, base);
  }
}

/**
 * @param options.base The site's Astro `base`, when one is configured — the
 * poster paths are absolute and must carry the same prefix as every other
 * public asset.
 */
export default function rehypeVideoEmbed(options: { base?: string } = {}) {
  const base = normalizeBase(options.base ?? "/");
  return (tree: HastNode) => walk(tree, base);
}
