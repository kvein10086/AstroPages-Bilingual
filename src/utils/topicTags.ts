import { slugifyStr } from "./slugify";

/**
 * The tag the content schema gives a post that lists none
 * (src/content.config.ts). It marks "untagged", not a topic.
 */
export const DEFAULT_TAG = "others";

const DEFAULT_TAG_SLUG = slugifyStr(DEFAULT_TAG);

/**
 * A post's tags minus the placeholder default, for places where a tag is
 * read as a topic: related posts (otherwise every untagged post would
 * recommend three others) and feed categories. Compared by slug, as /tags/
 * groups them.
 */
export function topicTags(tags: readonly string[]): string[] {
  return tags.filter(tag => slugifyStr(tag) !== DEFAULT_TAG_SLUG);
}
