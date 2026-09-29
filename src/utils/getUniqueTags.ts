import type { CollectionEntry } from "astro:content";
import { postFilter } from "./postFilter";
import { slugifyStr } from "./slugify";

type Tag = {
  tag: string;
  tagName: string;
  /** Number of listed posts carrying the tag — what its tag page will show. */
  count: number;
};

/**
 * Builds a de-duplicated, sorted tag list from posts.
 *
 * - Drafts and scheduled posts are excluded via `postFilter()`
 * - `tag` is the slug used in URLs; `tagName` is the original label for display
 *   (the first spelling met wins)
 * - Uniqueness is based on the slug (so differently-cased labels collapse)
 * - `count` counts posts, not mentions: a post tagged both "Web Dev" and
 *   "web dev" is one post on /tags/web-dev/, so it counts once
 */
export function getUniqueTags(posts: CollectionEntry<"posts">[]) {
  const tags = new Map<string, Tag>();

  for (const post of posts.filter(postFilter)) {
    const counted = new Set<string>();
    for (const tagName of post.data.tags) {
      const tag = slugifyStr(tagName);
      if (counted.has(tag)) continue;
      counted.add(tag);

      const entry = tags.get(tag);
      if (entry) entry.count++;
      else tags.set(tag, { tag, tagName, count: 1 });
    }
  }

  return [...tags.values()].sort((tagA, tagB) =>
    tagA.tag.localeCompare(tagB.tag)
  );
}
