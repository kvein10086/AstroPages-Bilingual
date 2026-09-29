import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { getRelativeLocaleUrl } from "astro:i18n";
import { getSortedPosts } from "@/utils/getSortedPosts";
import { getPostUrl } from "@/utils/getPostPaths";
import { getFeedTitle } from "@/utils/feed";
import { topicTags } from "@/utils/topicTags";
import { getLocaleInfo } from "@/i18n/helpers";
import config from "@/config";

export async function GET() {
  const locale = config.site.lang;
  const posts = await getCollection("posts", ({ id }) => id.startsWith("zh/"));
  const sortedPosts = getSortedPosts(posts);

  return rss({
    title: getFeedTitle(locale),
    description: config.site.description,
    // The channel links to this language's home page. Item links are
    // root-relative, so they don't depend on it — keep them byte-identical,
    // or readers re-show every post as unread.
    site: new URL(getRelativeLocaleUrl(locale, ""), config.site.url).href,
    customData: `<language>${getLocaleInfo(locale).hreflang}</language>`,
    items: sortedPosts.map(({ data, id, filePath }) => ({
      link: getPostUrl(id, filePath, locale),
      title: data.title,
      description: data.description,
      pubDate: new Date(data.modDatetime ?? data.pubDatetime),
      // Not the placeholder tag of untagged posts: it is not a topic.
      categories: topicTags(data.tags),
    })),
  });
}
