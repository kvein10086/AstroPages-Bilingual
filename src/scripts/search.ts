/**
 * The /search page (zh and /en/): mounts Pagefind UI into `#pagefind-search`
 * and keeps the query in `?q=` so a search can be shared, reloaded and
 * returned to from a result. Call `initSearch` once per page (from
 * `onPageReady`); it does nothing on pages without the element.
 *
 * Pagefind UI is told its strings explicitly: the npm build of
 * `@pagefind/default-ui` ships an empty `onMount`, so its own `<html lang>`
 * detection never runs and every page would otherwise get English. The
 * strings come from `t.search.pagefind` through `data-translations`.
 */

/** `<div id="pagefind-search">`'s data attributes (see search.astro). */
interface SearchDataset {
  bundlePath?: string;
  backurl?: string;
  translations?: string;
}

// @pagefind/default-ui ships no types; this is the slice used here.
interface PagefindUIInstance {
  triggerSearch(term: string): void;
}

function readTranslations(json: string | undefined): Record<string, string> {
  try {
    return json ? JSON.parse(json) : {};
  } catch {
    return {};
  }
}

export function initSearch() {
  const container = document.querySelector<HTMLElement>("#pagefind-search");
  if (!container) return;

  // The container is `transition:persist`ed, so navigating from /search to
  // /search (the header's search link) carries over the live UI, query and
  // listeners included. Mounting again would add a second search box — as
  // would a second caller while the first mount is still waiting: each
  // search page's own script registers with `onPageReady` once it has run,
  // so after visiting both /search and /en/search two callers arrive here.
  if (container.querySelector("form") || container.dataset.mounting) return;

  const { bundlePath, backurl, translations } =
    container.dataset as SearchDataset;
  if (!bundlePath) return;

  // Pagefind is imported when the browser is idle; a navigation before then
  // cancels the mount instead of letting it land on the next page.
  const controller = new AbortController();
  const { signal } = controller;
  document.addEventListener("astro:before-swap", () => controller.abort(), {
    once: true,
    signal,
  });

  // Cleared again if the mount is cancelled, so a persisted, still empty
  // container gets mounted on the next page.
  container.dataset.mounting = "true";
  signal.addEventListener("abort", () => delete container.dataset.mounting);

  const params = new URLSearchParams(window.location.search);
  const query = params.get("q");

  const mount = async () => {
    // @ts-expect-error — Missing types for @pagefind/default-ui package.
    const { PagefindUI } = await import("@pagefind/default-ui");
    if (signal.aborted) return;
    delete container.dataset.mounting;

    const search: PagefindUIInstance = new PagefindUI({
      element: container,
      bundlePath,
      showImages: false,
      showSubResults: true,
      translations: readTranslations(translations),
      // Arriving to search, not to read results: put the caret in the box.
      // Skipped when a `?q=` already brought results, and when the reader
      // has moved focus somewhere during the idle wait — `autofocus` would
      // yank it back.
      autofocus:
        !query &&
        (document.activeElement === null ||
          document.activeElement === document.body),
      processTerm: function (term: string) {
        params.set("q", term); // Update the `q` parameter in the URL
        history.replaceState(history.state, "", "?" + params.toString()); // Push the new URL without reloading

        sessionStorage.setItem(
          "backUrl",
          `${backurl ?? window.location.pathname}?${params.toString()}`
        );

        return term;
      },
    });

    // If search param exists (eg: search?q=astro), trigger search
    if (query) {
      search.triggerSearch(query);
    }

    // Reset search param if search input is cleared. These listeners belong
    // to the persisted UI, not to this page instance, so they deliberately
    // don't take `signal`: aborting them on a /search → /search navigation
    // would leave the carried-over box without them.
    const resetSearchParam = (e: Event) => {
      if ((e.target as HTMLInputElement)?.value.trim() === "") {
        history.replaceState(history.state, "", window.location.pathname);
      }
    };
    container
      .querySelector(".pagefind-ui__search-input")
      ?.addEventListener("input", resetSearchParam);
    container
      .querySelector(".pagefind-ui__search-clear")
      ?.addEventListener("click", resetSearchParam);
  };

  if (window.requestIdleCallback) {
    const handle = window.requestIdleCallback(mount);
    signal.addEventListener("abort", () => window.cancelIdleCallback(handle));
  } else {
    const handle = window.setTimeout(mount, 1);
    signal.addEventListener("abort", () => window.clearTimeout(handle));
  }
}
