/**
 * Client side of the /gallery filter: chips narrow the grid by the facet slugs
 * each `a.g-item` carries (`data-f-camera` / `data-f-lens` / `data-f-focal`,
 * derived at build time in `src/utils/galleryFacets.ts`).
 *
 * Choices within a dimension are OR-ed, dimensions are AND-ed, and a dimension
 * with nothing picked doesn't filter. The reserved "unknown" value matches the
 * items lacking that dimension. Chip counts are faceted — each counts what its
 * dimension would add under the other dimensions' current picks — and the
 * state lives in the query string (`?camera=a,b&lens=c`) so a view can be
 * shared.
 *
 * The bar ships `hidden` and is revealed here, so without JS the page is the
 * plain album list. Every listener hangs off the bar or the album index inside
 * `.gallery` and dies with it when a View Transition swaps the page in; call
 * `initGalleryFilter` once per page (from `onPageReady`).
 */

const FACETS = ["camera", "lens", "focal"] as const;
type Facet = (typeof FACETS)[number];

/** Chip value matching items without the dimension; never a real slug. */
const UNKNOWN = "unknown";

/** `dataset` keys of the per-item facet attributes. */
const DATASET_KEYS: Record<Facet, string> = {
  camera: "fCamera",
  lens: "fLens",
  focal: "fFocal",
};

interface FilterStrings {
  summaryAll?: string;
  summaryAllOneAlbum?: string;
  summaryFiltered?: string;
  filtersReset?: string;
}

type Selection = Record<Facet, Set<string>>;

function parseStrings(el: HTMLElement): FilterStrings {
  try {
    return JSON.parse(el.dataset.filterStrings ?? "{}");
  } catch {
    return {};
  }
}

/** Fill `{{key}}` placeholders (a client-side twin of the i18n `tplStr`). */
function fill(
  template: string | undefined,
  vars: Record<string, string | number>
) {
  return (template ?? "").replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in vars ? String(vars[key]) : ""
  );
}

function emptySelection(): Selection {
  return { camera: new Set(), lens: new Set(), focal: new Set() };
}

export function initGalleryFilter() {
  const bar = document.querySelector<HTMLElement>("[data-gallery-filter]");
  const gallery = bar?.closest<HTMLElement>(".gallery");
  if (!bar || !gallery || bar.dataset.filterReady) return;
  bar.dataset.filterReady = "true";

  const toggle = bar.querySelector<HTMLButtonElement>("[data-filter-toggle]");
  const panel = bar.querySelector<HTMLElement>("[data-filter-panel]");
  const summary = bar.querySelector<HTMLElement>("[data-filter-summary]");
  const clear = bar.querySelector<HTMLButtonElement>("[data-filter-clear]");
  const empty = bar.querySelector<HTMLElement>("[data-filter-empty]");
  const chips = Array.from(
    bar.querySelectorAll<HTMLButtonElement>("button[data-facet]")
  );
  const strings = parseStrings(bar);

  const items = Array.from(
    gallery.querySelectorAll<HTMLAnchorElement>("a.g-item")
  ).map(el => ({
    el,
    section: el.closest<HTMLElement>("section"),
    values: Object.fromEntries(
      FACETS.map(facet => [facet, el.dataset[DATASET_KEYS[facet]] ?? UNKNOWN])
    ) as Record<Facet, string>,
  }));
  const sections = Array.from(
    gallery.querySelectorAll<HTMLElement>("section[id^='album-']")
  );
  const navLinks = Array.from(
    gallery.querySelectorAll<HTMLAnchorElement>(".g-albums a[href^='#album-']")
  );

  // Only values that have a chip are selectable; anything else in the URL is
  // silently dropped.
  const known = emptySelection();
  for (const chip of chips) {
    const facet = chip.dataset.facet as Facet;
    if (FACETS.includes(facet)) known[facet].add(chip.dataset.value ?? "");
  }

  const selected = emptySelection();
  const chipCounts = new Map<HTMLButtonElement, number>();

  const isActive = () => FACETS.some(facet => selected[facet].size > 0);
  const passes = (values: Record<Facet, string>, facet: Facet) =>
    selected[facet].size === 0 || selected[facet].has(values[facet]);

  function apply(announceReset = false) {
    // Visibility, per album tally.
    let shown = 0;
    const perSection = new Map<HTMLElement | null, number>();
    for (const item of items) {
      const visible = FACETS.every(facet => passes(item.values, facet));
      item.el.hidden = !visible;
      if (visible) {
        shown++;
        perSection.set(item.section, (perSection.get(item.section) ?? 0) + 1);
      }
    }
    for (const section of sections) {
      section.hidden = !perSection.get(section);
    }
    for (const link of navLinks) {
      const section = document.getElementById(
        decodeURIComponent(link.hash.slice(1))
      );
      const count = section ? (perSection.get(section) ?? 0) : 0;
      const label = link.querySelector("[data-album-count]");
      if (label) label.textContent = String(count);
      if (count) link.removeAttribute("aria-disabled");
      else link.setAttribute("aria-disabled", "true");
    }

    // Faceted counts: an item counts toward a chip when it passes every
    // *other* dimension and carries the chip's value.
    const tallies = Object.fromEntries(
      FACETS.map(facet => [facet, new Map<string, number>()])
    ) as Record<Facet, Map<string, number>>;
    for (const item of items) {
      for (const facet of FACETS) {
        const others = FACETS.every(f => f === facet || passes(item.values, f));
        if (!others) continue;
        const tally = tallies[facet];
        tally.set(item.values[facet], (tally.get(item.values[facet]) ?? 0) + 1);
      }
    }
    for (const chip of chips) {
      const facet = chip.dataset.facet as Facet;
      const value = chip.dataset.value ?? "";
      const count = tallies[facet]?.get(value) ?? 0;
      const pressed = selected[facet]?.has(value) ?? false;
      chipCounts.set(chip, count);
      chip.setAttribute("aria-pressed", String(pressed));
      chip.toggleAttribute("data-empty", count === 0 && !pressed);
      const label = chip.querySelector("[data-count]");
      if (label) label.textContent = String(count);
    }

    const active = isActive();
    if (clear) clear.hidden = !active;
    if (empty) empty.hidden = shown > 0;
    if (summary) {
      const text = active
        ? fill(strings.summaryFiltered, { shown, total: items.length })
        : fill(
            sections.length === 1
              ? strings.summaryAllOneAlbum
              : strings.summaryAll,
            { photos: items.length, albums: sections.length }
          );
      summary.textContent =
        announceReset && strings.filtersReset
          ? fill(strings.filtersReset, { summary: text })
          : text;
    }
  }

  /** Mirror the selection into the query string, leaving the rest intact. */
  function writeUrl() {
    const params = new URLSearchParams(location.search);
    for (const facet of FACETS) params.delete(facet);
    // URLSearchParams would escape the commas; keep `a,b` readable instead.
    const own = FACETS.flatMap(facet => {
      const values = chips
        .filter(
          chip =>
            chip.dataset.facet === facet &&
            selected[facet].has(chip.dataset.value ?? "")
        )
        .map(chip => encodeURIComponent(chip.dataset.value ?? ""));
      return values.length ? [`${facet}=${values.join(",")}`] : [];
    });
    const rest = params.toString();
    const search = [rest, ...own].filter(Boolean).join("&");
    const url = `${location.pathname}${search ? `?${search}` : ""}${location.hash}`;
    // Keep `history.state`: Astro's ClientRouter stores its scroll state there.
    history.replaceState(history.state, "", url);
  }

  function readUrl() {
    const params = new URLSearchParams(location.search);
    for (const facet of FACETS) {
      for (const value of params.get(facet)?.split(",") ?? []) {
        if (known[facet].has(value)) selected[facet].add(value);
      }
    }
  }

  function setExpanded(expanded: boolean) {
    if (panel) panel.hidden = !expanded;
    toggle?.setAttribute("aria-expanded", String(expanded));
  }

  // Album-index jumps bypass Astro's router: it compares against the URL it
  // last navigated to, so once `writeUrl` has changed the query string a
  // plain `#album-…` link would count as a new page and trigger a full swap.
  // Scroll here instead and keep the hash in the current history entry
  // (a pushed entry would hit the same stale comparison on Back).
  gallery.querySelector(".g-albums")?.addEventListener("click", event => {
    const e = event as MouseEvent;
    if (
      e.defaultPrevented ||
      e.button !== 0 ||
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey
    ) {
      return;
    }
    const link = (e.target as Element | null)?.closest<HTMLAnchorElement>(
      "a[href^='#album-']"
    );
    if (!link) return;
    e.preventDefault();
    document
      .getElementById(decodeURIComponent(link.hash.slice(1)))
      ?.scrollIntoView();
    history.replaceState(
      history.state,
      "",
      `${location.pathname}${location.search}${link.hash}`
    );
  });

  bar.addEventListener("click", event => {
    const button = (event.target as Element | null)?.closest("button");
    if (!button || !bar.contains(button)) return;

    if (button === toggle) {
      setExpanded(toggle.getAttribute("aria-expanded") !== "true");
      return;
    }

    if (button === clear) {
      for (const facet of FACETS) selected[facet].clear();
      apply();
      writeUrl();
      // The clear button just hid itself; keep focus inside the bar.
      toggle?.focus();
      return;
    }

    const facet = button.dataset.facet as Facet | undefined;
    const value = button.dataset.value;
    if (!facet || !FACETS.includes(facet) || value === undefined) return;

    let reset = false;
    if (selected[facet].has(value)) {
      selected[facet].delete(value);
    } else {
      // A chip that would match nothing under the other dimensions wins:
      // drop those picks rather than leave the grid empty.
      if ((chipCounts.get(button) ?? 0) === 0) {
        for (const other of FACETS) {
          if (other !== facet && selected[other].size) {
            selected[other].clear();
            reset = true;
          }
        }
      }
      selected[facet].add(value);
    }
    apply(reset);
    writeUrl();
  });

  readUrl();
  apply();
  bar.hidden = false;
  setExpanded(isActive());

  // Astro restores a Back/reload scroll position before this runs, i.e. in
  // the unfiltered layout; redo it now that the filtered layout is in place.
  // A forward navigation stores 0/0 and is left alone, and so is a page with
  // no filter in its URL — its layout is the one Astro already scrolled.
  const saved = history.state as { scrollX?: number; scrollY?: number } | null;
  if (
    isActive() &&
    !location.hash &&
    saved &&
    (saved.scrollX || saved.scrollY)
  ) {
    scrollTo({
      left: saved.scrollX ?? 0,
      top: saved.scrollY ?? 0,
      behavior: "instant",
    });
  }
}
