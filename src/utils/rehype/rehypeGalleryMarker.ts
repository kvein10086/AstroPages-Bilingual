import { parseGalleryMarker } from "../media";

/**
 * Strip per-image gallery markers from the rendered HTML.
 *
 * A photo opts in or out of the gallery through the *title* of its markdown
 * image — `![caption](https://host/album/shot.jpg "nogallery")` — because that
 * is the one slot the syntax already has and the gallery extractor already
 * matches (see `parseGalleryMarker` in `src/utils/media.ts`). Remark faithfully
 * turns that title into `<img title="nogallery">`, which browsers show as a
 * tooltip on hover: a build instruction leaking into the page as if it were a
 * caption. This plugin deletes it again, so the marker only ever means
 * something to the gallery.
 *
 * Only markers are removed. Any other title is a real one the author wrote for
 * readers, and is left alone.
 *
 * It runs before `rehypeVideoEmbed`: a clip's marker would be dropped anyway
 * when that plugin rebuilds the node's properties, but the order keeps the
 * guarantee in one obvious place rather than in a side effect.
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

function walk(node: HastNode): void {
  if (!node.children) return;
  for (const child of node.children) {
    const properties = child.properties;
    const title = properties?.title;
    if (
      properties &&
      child.type === "element" &&
      child.tagName === "img" &&
      typeof title === "string" &&
      parseGalleryMarker(title) !== null
    ) {
      delete properties.title;
    }
    walk(child);
  }
}

export default function rehypeGalleryMarker() {
  return (tree: HastNode) => walk(tree);
}
