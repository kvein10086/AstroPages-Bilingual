import type { CollectionEntry } from "astro:content";
import config from "@/config";
import { slugifyStr } from "./slugify";

/** What the related-posts list needs of a post — kept small, like prev/next. */
export type RelatedPost = {
  id: string;
  title: string;
  filePath: string | undefined;
  pubDatetime: Date;
  timezone: string | undefined;
};

const MAX_RELATED = 3;

/**
 * The tag the content schema gives a post that lists none
 * (src/content.config.ts). It marks "untagged", not a topic, so it relates
 * nothing: otherwise every untagged post would recommend three others.
 */
const DEFAULT_TAG = slugifyStr("others");

/** A post's tag slugs, minus the placeholder default. */
const topicTags = (post: CollectionEntry<"posts">) =>
  post.data.tags.map(slugifyStr).filter(tag => tag !== DEFAULT_TAG);

/**
 * Up to three posts sharing the most tags with `post`, newer first on a tie;
 * none when nothing overlaps (the list then isn't rendered at all).
 *
 * `candidates` must already be one locale's published posts — the post pages
 * pass the list they build their routes from. Tags are compared by their slug,
 * the same key /tags/ groups by, so "Photography" matches "photography" and a
 * CJK tag like 摄影 matches itself.
 */
export function getRelatedPosts(
  post: CollectionEntry<"posts">,
  candidates: CollectionEntry<"posts">[]
): RelatedPost[] {
  if (!config.features.relatedPosts) return [];

  const tags = new Set(topicTags(post));
  if (tags.size === 0) return [];

  return candidates
    .filter(candidate => candidate.id !== post.id)
    .map(candidate => ({
      candidate,
      // A post listing one tag twice still shares it once.
      shared: new Set(topicTags(candidate).filter(tag => tags.has(tag))).size,
    }))
    .filter(({ shared }) => shared > 0)
    .sort(
      (a, b) =>
        b.shared - a.shared ||
        b.candidate.data.pubDatetime.getTime() -
          a.candidate.data.pubDatetime.getTime()
    )
    .slice(0, MAX_RELATED)
    .map(({ candidate }) => ({
      id: candidate.id,
      title: candidate.data.title,
      filePath: candidate.filePath,
      pubDatetime: candidate.data.pubDatetime,
      timezone: candidate.data.timezone,
    }));
}
