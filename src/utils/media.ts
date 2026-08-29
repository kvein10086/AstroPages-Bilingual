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

/** An opening/closing code fence: up to 3 spaces, then ``` or ~~~ (or longer). */
const CODE_FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * An inline code span: a backtick run, the shortest content that reaches a run
 * of the same length, and nothing but a non-backtick after it. Scoped to a
 * single line on purpose — a lone unmatched backtick then costs nothing,
 * whereas a body-wide match could swallow real image lines.
 */
const INLINE_CODE_RE = /(`+)[^\n]*?\1(?!`)/g;

/** Only a code span that quotes an image is blanked (see `stripMarkdownCode`). */
const quotesImage = (span: string): string => (span.includes("![") ? "" : span);

/** Split a fence line into its marker run and the rest (the info string). */
function parseCodeFence(line: string): { run: string; info: string } | null {
  const match = CODE_FENCE_RE.exec(line);
  if (!match) return null;
  return { run: match[1] ?? "", info: match[2] ?? "" };
}

/**
 * Blank out markdown code so the gallery scanners never collect an image that a
 * post merely *documents*.
 *
 * Both scanners match `![alt](url "title")` against the raw markdown source and
 * know nothing of markdown structure. That was harmless while only
 * `gallery: true` posts were scanned, but a per-image `"gallery"` marker now
 * lets any post contribute an album — so a tutorial (or a copy of the README
 * section describing this very feature) would ship a real album and make CI
 * download the URL it was only quoting. Fenced blocks are therefore emptied
 * first, and so is any inline code span that quotes an image — a span that
 * doesn't (`` `foo` `` inside an alt text, say) is left alone so the caption
 * keeps its words. Line structure is kept so nothing else shifts.
 *
 * Indented (4-space) code blocks are deliberately NOT stripped: telling one
 * apart from an image nested in a list item takes a real markdown parser, and
 * silently dropping a real photo is worse than the rare phantom album.
 *
 * This MUST stay in sync with the copy in
 * `scripts/generate-gallery-thumbs.mjs`, or the site and the thumbnail
 * generator stop agreeing on which media is collected.
 */
export function stripMarkdownCode(body: string): string {
  let openFence: string | null = null;
  return body
    .split("\n")
    .map(line => {
      const fence = parseCodeFence(line);
      if (openFence !== null) {
        // A closing fence is the same character, at least as long, and bare.
        if (
          fence &&
          fence.run[0] === openFence[0] &&
          fence.run.length >= openFence.length &&
          fence.info.trim() === ""
        ) {
          openFence = null;
        }
        return "";
      }
      // A backtick fence's info string may not itself contain a backtick.
      if (fence && !(fence.run[0] === "`" && fence.info.includes("`"))) {
        openFence = fence.run;
        return "";
      }
      return line.replace(INLINE_CODE_RE, quotesImage);
    })
    .join("\n");
}

/**
 * A per-image gallery marker, written as the *title* of a markdown image:
 * `![alt](url "gallery")` / `![alt](url "nogallery")`.
 *
 * The frontmatter `gallery` flag is the post's default; a marker overrides it
 * for a single item. `"include"` admits one photo from an ordinary post,
 * `"exclude"` keeps a screenshot or a route map out of a gallery post's album.
 * The `imageDomains` whitelist stays a hard gate either way — `"gallery"`
 * cannot admit media from a host that isn't configured.
 */
export type GalleryMarker = "include" | "exclude";

/**
 * Read the gallery marker out of a markdown image title.
 *
 * Matching is trimmed and case-insensitive, and only an exact `gallery` or
 * `nogallery` counts as a marker. Every other title is an ordinary one: it
 * stays the image's tooltip and has no effect on the gallery (`null`).
 *
 * This MUST stay in sync with the copy in
 * `scripts/generate-gallery-thumbs.mjs` — the site and the thumbnail generator
 * have to agree on which media is collected, or an excluded image keeps a
 * thumbnail it should have lost (or an included one never gets one).
 */
export function parseGalleryMarker(
  title: string | null | undefined
): GalleryMarker | null {
  if (!title) return null;
  switch (title.trim().toLowerCase()) {
    case "gallery":
      return "include";
    case "nogallery":
      return "exclude";
    default:
      return null;
  }
}
