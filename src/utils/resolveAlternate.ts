import { getCollection } from "astro:content";
import { getRelativeLocaleUrl } from "astro:i18n";
import { getLocaleFromPath, type Locale } from "@/i18n/helpers";
import { getPostSlug } from "./getPostPaths";
import { getSortedPosts } from "./getSortedPosts";
import { getUniqueTags } from "./getUniqueTags";
import { slugifyAll } from "./slugify";
import { stripBase, stripLocale } from "./withBase";
import config from "@/config";

/** Every page one locale builds, keyed the way its URL segments read. */
type LocaleRoutes = {
  /** Single-segment pages: `posts`, `about`, `search`, … */
  pages: Set<string>;
  /** Post slugs below `posts/`, e.g. `welcome` or `nested/dir/slug`. */
  posts: Set<string>;
  /** Number of pages of the `posts/` list. */
  postListPages: number;
  /** Tag slug → number of pages of that tag's list. */
  tagPages: Map<string, number>;
};

/**
 * Single-segment pages per locale (`about`, `search`, a fork's `projects`…),
 * read off the route files so a page added to `src/pages/` and
 * `src/pages/[lang]/` maps across without touching this file. Only the file
 * names are used: the lazy `?raw` imports are never called.
 */
const routeFiles = Object.keys(
  import.meta.glob(
    [
      "/src/pages/*.astro",
      "/src/pages/*/index.astro",
      "/src/pages/*/*.astro",
      "/src/pages/*/*/index.astro",
    ],
    { query: "?raw" }
  )
);

function findStaticPages(dir: string): Set<string> {
  const pattern = new RegExp(`^${dir}/([^/]+?)(?:/index)?\\.astro$`);
  const names = routeFiles.map(file => pattern.exec(file)?.[1]);
  return new Set(
    names.filter(
      (name): name is string =>
        // Dynamic segments, and the home and 404 pages, are handled apart.
        !!name && !name.includes("[") && name !== "index" && name !== "404"
    )
  );
}

const staticPages: Record<Locale, Set<string>> = {
  zh: findStaticPages("/src/pages"),
  en: findStaticPages("/src/pages/\\[lang\\]"),
};

const pageCount = (items: number) =>
  Math.max(1, Math.ceil(items / config.posts.perPage));

/**
 * Collect the routes of `locale`. Static pages come from the route files;
 * posts, tags and list pages mirror the `getStaticPaths()` of the pages under
 * `src/pages/` (and `[lang]/`) — the same collection filters,
 * `getSortedPosts`/`getUniqueTags` and page size — so a page counts as
 * existing exactly when the build emits it. Keep the two in step.
 */
async function collectRoutes(locale: Locale): Promise<LocaleRoutes> {
  const posts = await getCollection(
    "posts",
    ({ id, data }) => id.startsWith(`${locale}/`) && !data.draft
  );
  const sortedPosts = getSortedPosts(posts);

  const tagPages = new Map<string, number>();
  for (const { tag } of getUniqueTags(posts)) {
    const tagged = getSortedPosts(
      posts.filter(({ data }) => slugifyAll(data.tags).includes(tag))
    );
    tagPages.set(tag, pageCount(tagged.length));
  }

  const { features } = config;
  const pages = new Set(["posts", "tags", ...staticPages[locale]]);
  // These pages rewrite themselves to the 404 page when their feature is off.
  if (!features.showArchives) pages.delete("archives");
  if (!features.gallery.enabled) pages.delete("gallery");
  if (features.search !== "pagefind") pages.delete("search");

  return {
    pages,
    posts: new Set(
      sortedPosts.map(({ id, filePath }) =>
        getPostSlug(id, filePath).replace(/^\//, "")
      )
    ),
    postListPages: pageCount(sortedPosts.length),
    tagPages,
  };
}

// The route table only depends on content, so a build computes it once per
// locale and every page reuses it. The dev server keeps modules alive across
// content edits, so there it is rebuilt per call to stay fresh.
const routeCache = new Map<Locale, Promise<LocaleRoutes>>();

function getRoutes(locale: Locale): Promise<LocaleRoutes> {
  if (import.meta.env.DEV) return collectRoutes(locale);
  let routes = routeCache.get(locale);
  if (!routes) {
    routes = collectRoutes(locale);
    routeCache.set(locale, routes);
  }
  return routes;
}

/** `/posts/2/` style list pages: page 1 lives at the bare list URL. */
const isListPage = (segment: string | undefined, lastPage: number) =>
  segment !== undefined &&
  /^[1-9]\d*$/.test(segment) &&
  Number(segment) >= 2 &&
  Number(segment) <= lastPage;

/** Whether the page at `segments` (locale prefix removed) exists. */
function routeExists(routes: LocaleRoutes, segments: string[]): boolean {
  const [first, ...rest] = segments;
  if (rest.length === 0) return routes.pages.has(first);

  if (first === "posts") {
    return (
      routes.posts.has(rest.join("/")) ||
      (rest.length === 1 && isListPage(rest[0], routes.postListPages))
    );
  }

  if (first === "tags") {
    const lastPage = routes.tagPages.get(rest[0]);
    if (lastPage === undefined || rest.length > 2) return false;
    return rest.length === 1 || isListPage(rest[1], lastPage);
  }

  return false;
}

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export type ResolvedAlternate = {
  /** Root-relative, base-aware URL of the page to link to. */
  href: string;
  /**
   * `true` when `href` is the same page in the target locale; `false` when
   * that page does not exist and `href` is its nearest existing ancestor.
   */
  exact: boolean;
};

/**
 * Map the page at `pathname` (as in `Astro.url.pathname`) to `target` locale,
 * checked against the pages the build actually emits.
 *
 * Returns the counterpart when it exists — posts by slug, tags by slug (tags
 * are localised, so `旅行` has no English page), paginated lists by page
 * count, static pages by feature flag. Otherwise it returns the nearest
 * ancestor that does exist in the target locale (`/en/posts/`, `/en/tags/`,
 * or the home page) with `exact: false`, so callers never link to a 404.
 *
 * Shared by the language switcher, the `hreflang` links and the first-visit
 * redirect in `Layout.astro`, so all three agree.
 */
export async function resolveAlternate(
  pathname: string,
  target: Locale
): Promise<ResolvedAlternate> {
  const path = stripBase(pathname);
  const segments = stripLocale(path, getLocaleFromPath(path))
    .split("/")
    .filter(Boolean)
    .map(decodeSegment);
  const routes = await getRoutes(target);

  for (let depth = segments.length; depth > 0; depth--) {
    const candidate = segments.slice(0, depth);
    if (routeExists(routes, candidate)) {
      return {
        href: getRelativeLocaleUrl(target, candidate.join("/")),
        exact: depth === segments.length,
      };
    }
  }

  // The home page always exists.
  return {
    href: getRelativeLocaleUrl(target, ""),
    exact: segments.length === 0,
  };
}
