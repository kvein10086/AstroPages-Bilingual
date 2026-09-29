import { manifestEntry } from "./galleryManifest";

/**
 * Loading hints and intrinsic size for article images.
 *
 * Remark renders `![caption](url)` as a bare `<img src alt>`, so a photo post
 * downloads every original at once — on a phone, tens of megabytes for images
 * the reader may never scroll to — and the column reflows as each one learns
 * its shape. This plugin gives each image what the /gallery grid already has:
 *
 * - `decoding="async"` everywhere, so decoding a large photo never holds up
 *   the rest of the page;
 * - `width`/`height` from the gallery manifest when the URL is in it. With
 *   Tailwind's `img { max-width: 100%; height: auto }` they only fix the
 *   aspect ratio, so the right box is reserved before a byte arrives;
 * - `loading="lazy"` on those sized images, except the first image of the
 *   post, which stays eager because it is often the largest thing above the
 *   fold (the LCP element). Images outside the manifest (screenshots,
 *   diagrams) have no size known at build time, and stay eager: lazy-loading
 *   them breaks jumps to headings (see `decorate`).
 *
 * Attributes an author already set are left alone. An `<img>` written as raw
 * HTML in a `.md` post (Astro only parses it after the user plugins) or as
 * JSX in MDX isn't an element yet at this stage, so it is neither changed nor
 * counted.
 *
 * It runs after `rehypeVideoEmbed`, so clips — which that plugin turns from
 * `<img>` into `<video>` — neither get image attributes nor take the "first
 * image" slot.
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

function decorate(properties: Record<string, unknown>, first: boolean): void {
  properties.decoding ??= "async";

  const src = properties.src;
  if (
    typeof src === "string" &&
    properties.width === undefined &&
    properties.height === undefined
  ) {
    const entry = manifestEntry(src);
    if (entry?.width && entry.height) {
      properties.width = entry.width;
      properties.height = entry.height;
    }
  }

  // Lazy only where the box is already reserved. An unsized lazy image is a
  // 0px line until it loads, and it loads only as the reader nears it — which
  // is exactly what a smooth jump to a heading (a `#fragment` link, the TOC)
  // does: the scroll target is computed up front, the images it passes then
  // load and grow, and the jump lands thousands of pixels short. Eager unsized
  // images are all in before `load`, when the browser performs that jump.
  if (
    !first &&
    properties.width !== undefined &&
    properties.height !== undefined
  ) {
    properties.loading ??= "lazy";
  }
}

export default function rehypeImageAttrs() {
  return (tree: HastNode) => {
    let seen = 0;
    const walk = (node: HastNode): void => {
      for (const child of node.children ?? []) {
        if (child.type === "element" && child.tagName === "img") {
          child.properties ??= {};
          decorate(child.properties, seen++ === 0);
        }
        walk(child);
      }
    };
    walk(tree);
  };
}
