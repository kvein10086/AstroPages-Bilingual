/**
 * Post table of contents: scroll spy, the side rail, the floating button and
 * its sheet. Markup: src/pages/posts/[...slug]/_components/PostToc.astro.
 *
 * One `activeIndex` drives everything — the rail's `aria-current`, its sliding
 * indicator and the sheet's highlight — so the three can never disagree.
 *
 * The spy reads heading positions on scroll instead of using an
 * IntersectionObserver: "the last heading above a line 35% down the viewport"
 * is one pass over a few dozen rects, has no dead zones between observed
 * sections, and answers correctly at the very bottom of the page, where a short
 * last section can never reach the line.
 */

/** Matches Tailwind's `xl`: the rail shows, the button and sheet don't. */
const WIDE_QUERY = "(min-width: 80rem)";

/** A heading becomes active once its top crosses this share of the viewport. */
const ACTIVE_LINE = 0.35;

/** Height of the rail's fade masks (`--toc-fade` in global.css), in px. */
const RAIL_EDGE = 24;

/** Scroll-end fallback where `scrollend` isn't supported (Safari). */
const SCROLL_END_DELAY = 150;
const HAS_SCROLL_END = "onscrollend" in window;

/**
 * A scroll that was still running when a TOC link was clicked (a key press,
 * a wheel fling) reports its `scrollend` a few ms after the click, before the
 * jump has even started. Scroll ends this soon after a pin belong to it.
 */
const PIN_SETTLE = 150;

/** Keys that scroll the page, and so end a pin (see `pin`). */
const SCROLL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

/** Typing or moving the caret here doesn't scroll the page. */
const EDITABLE =
  "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/** Cleanup for the page instance currently wired up. */
let teardown: (() => void) | null = null;

/** `:focus-visible`, for engines too old to parse it: plain focus. */
function hasFocusVisible(element: Element) {
  try {
    return element.matches(":focus-visible");
  } catch {
    return element === document.activeElement;
  }
}

/** The elements PostToc.astro renders, all present. */
interface TocParts {
  article: HTMLElement;
  rail: HTMLElement;
  railScroll: HTMLElement;
  railTrack: HTMLElement;
  indicator: HTMLElement;
  button: HTMLButtonElement;
  sheet: HTMLDialogElement;
  sheetList: HTMLElement;
}

function queryParts(): TocParts | null {
  const article = document.getElementById("article");
  const rail = document.querySelector<HTMLElement>("[data-toc-rail]");
  const railScroll = rail?.querySelector<HTMLElement>("[data-toc-scroll]");
  const railTrack = rail?.querySelector<HTMLElement>("[data-toc-track]");
  const indicator = rail?.querySelector<HTMLElement>("[data-toc-indicator]");
  const button = document.querySelector<HTMLButtonElement>("[data-toc-button]");
  const sheet = document.querySelector<HTMLDialogElement>(
    "dialog[data-toc-sheet]"
  );
  const sheetList = sheet?.querySelector<HTMLElement>("[data-toc-sheet-list]");
  if (
    !article ||
    !rail ||
    !railScroll ||
    !railTrack ||
    !indicator ||
    !button ||
    !sheet ||
    !sheetList
  ) {
    return null;
  }
  return {
    article,
    rail,
    railScroll,
    railTrack,
    indicator,
    button,
    sheet,
    sheetList,
  };
}

/** Wire up the TOC of the current page, if it has one. */
export function initPostToc() {
  teardown?.();
  const parts = queryParts();
  if (parts) teardown = wire(parts);
}

/** Attach every behaviour; returns the cleanup for this page instance. */
function wire({
  article,
  rail,
  railScroll,
  railTrack,
  indicator,
  button,
  sheet,
  sheetList,
}: TocParts): () => void {
  const railLinks = Array.from(
    rail.querySelectorAll<HTMLAnchorElement>("a[data-toc-id]")
  );
  const sheetLinks = Array.from(
    sheet.querySelectorAll<HTMLAnchorElement>("a[data-toc-id]")
  );
  const ids = railLinks.map(link => link.dataset.tocId ?? "");
  // Look headings up by the id the build wrote, scoped to the article. The
  // link's `hash` is no use for this: CJK slugs come back percent-encoded.
  const headings = ids.map(id =>
    id ? article.querySelector<HTMLElement>(`#${CSS.escape(id)}`) : null
  );
  /** `toc: true` in the frontmatter: the button shows on any length. */
  const forced = button.hasAttribute("data-toc-forced");

  /** The TOC entry a URL fragment points at, or -1. */
  function indexOfHash(hash: string) {
    try {
      return ids.indexOf(decodeURIComponent(hash.slice(1)));
    } catch {
      return -1; // Malformed percent-encoding.
    }
  }

  const controller = new AbortController();
  const { signal } = controller;
  const wide = window.matchMedia(WIDE_QUERY);

  let activeIndex = -1;
  /** Set while a TOC click owns the highlight; the spy is suspended. */
  let pinnedIndex: number | null = null;
  let pinnedAt = 0;
  let buttonVisible: boolean | null = null;
  let frame = 0;
  let scrollEndTimer = 0;

  // ---- Spy ---------------------------------------------------------------

  function spiedIndex(viewportHeight: number): number {
    const root = document.documentElement;
    const line = viewportHeight * ACTIVE_LINE;
    // At the bottom of a scrollable page the last sections may never reach
    // the line; then whichever heading is lowest on screen wins.
    const atBottom =
      root.scrollTop > 0 &&
      root.scrollTop + viewportHeight >= root.scrollHeight - 2;

    let index = -1;
    headings.forEach((heading, i) => {
      if (!heading || heading.getClientRects().length === 0) return;
      const { top } = heading.getBoundingClientRect();
      if (top <= line || (atBottom && top < viewportHeight)) index = i;
    });
    return index;
  }

  function update() {
    frame = 0;

    // Read everything first…
    const viewportHeight = window.innerHeight;
    const nextIndex = pinnedIndex ?? spiedIndex(viewportHeight);
    const articleRect = article.getBoundingClientRect();
    // Only worth a button on a long read (or where the author asked for the
    // TOC outright), and only until the reader is finishing it — a short post
    // fits in a couple of flicks anyway. A keyboard-focused button stays put:
    // hiding it (inert) would drop focus to <body>.
    const showButton =
      ((forced || articleRect.height > 2 * viewportHeight) &&
        articleRect.bottom > 0.5 * viewportHeight) ||
      hasFocusVisible(button);

    // …then write only what changed.
    if (nextIndex !== activeIndex) setActive(nextIndex);
    if (showButton !== buttonVisible) {
      buttonVisible = showButton;
      button.toggleAttribute("data-visible", showButton);
      button.inert = !showButton;
    }
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  // ---- Highlight -----------------------------------------------------------

  function setActive(index: number) {
    const wasHidden = activeIndex < 0;
    for (const links of [railLinks, sheetLinks]) {
      links[activeIndex]?.removeAttribute("aria-current");
      links[index]?.setAttribute("aria-current", "location");
    }
    activeIndex = index;
    placeIndicator(wasHidden);
    followRail();
  }

  /**
   * Slide the indicator onto the active link. `jump` places it without the
   * slide — on first appearance it would otherwise glide in from the top, and
   * after a re-wrap it would visibly chase the text.
   */
  function placeIndicator(jump: boolean) {
    const link = railLinks[activeIndex];
    indicator.toggleAttribute("data-jump", jump);
    if (!link) {
      indicator.removeAttribute("data-active");
      return;
    }
    indicator.style.setProperty("--toc-indicator-y", `${link.offsetTop}px`);
    indicator.style.setProperty("--toc-indicator-h", `${link.offsetHeight}px`);
    indicator.setAttribute("data-active", "");
  }

  /**
   * Keep the active link visible in a rail that scrolls on its own. Set
   * `scrollTop` directly: `scrollIntoView` would scroll the window too. Hands
   * off while the reader is pointing at or tabbing through the rail — only
   * keyboard focus counts, since a clicked link keeps focus long after the
   * reader has gone back to the article.
   */
  function followRail() {
    const link = railLinks[activeIndex];
    if (!link || railInUse()) return;
    const top = railTrack.offsetTop + link.offsetTop;
    const bottom = top + link.offsetHeight;
    const { scrollTop, clientHeight } = railScroll;
    // "Visible" excludes the faded ends: a link half under the mask reads as
    // hidden.
    if (
      top < scrollTop + RAIL_EDGE ||
      bottom > scrollTop + clientHeight - RAIL_EDGE
    ) {
      railScroll.scrollTop = top - clientHeight / 3;
    }
  }

  function railInUse() {
    if (rail.matches(":hover")) return true;
    const focused = document.activeElement;
    return !!focused && rail.contains(focused) && hasFocusVisible(focused);
  }

  /** Fade whichever end of the rail has more links hidden past it. */
  function updateFade() {
    const { scrollTop, scrollHeight, clientHeight } = railScroll;
    const top = scrollTop > 1;
    const bottom = scrollTop + clientHeight < scrollHeight - 1;
    if (top || bottom) {
      railScroll.dataset.fade = top && bottom ? "both" : top ? "top" : "bottom";
    } else {
      delete railScroll.dataset.fade;
    }
  }

  /** Full label as a tooltip, but only where `line-clamp` actually cut it. */
  function updateTitles() {
    for (const link of railLinks) {
      const label = link.firstElementChild;
      if (label && label.scrollHeight > label.clientHeight + 1) {
        link.title = label.textContent?.trim() ?? "";
      } else {
        link.removeAttribute("title");
      }
    }
  }

  // ---- Pinning -------------------------------------------------------------

  /**
   * A TOC click selects its entry at once and holds it: a smooth scroll to a
   * far section would otherwise flick the highlight through every heading on
   * the way, and a short last section — which can't scroll up to the line —
   * would never be selected at all. The pin lasts until the reader scrolls on
   * their own.
   */
  function pin(index: number) {
    pinnedIndex = index;
    pinnedAt = performance.now();
    if (index !== activeIndex) setActive(index);
  }

  function unpin() {
    if (pinnedIndex === null) return;
    pinnedIndex = null;
    schedule();
  }

  /** At scroll end, drop a pin whose heading isn't even on screen. */
  function checkPinOnScrollEnd() {
    if (pinnedIndex === null) return;
    if (performance.now() - pinnedAt < PIN_SETTLE) return;
    const heading = headings[pinnedIndex];
    const rect = heading?.getBoundingClientRect();
    if (!rect || rect.bottom < 0 || rect.top > window.innerHeight) unpin();
  }

  const isPlainClick = (e: MouseEvent) =>
    e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

  // ---- Sheet ---------------------------------------------------------------

  function openSheet() {
    delete sheet.dataset.instant;
    sheet.showModal();
    // Centre the current section in the list and start keyboard focus there.
    const link = sheetLinks[activeIndex] ?? sheetLinks[0];
    if (!link) return;
    if (activeIndex >= 0) {
      sheetList.scrollTop =
        link.offsetTop - (sheetList.clientHeight - link.offsetHeight) / 2;
    }
    link.focus({ preventScroll: true });
  }

  /**
   * Jumping from the sheet: close it at once — an exit animation would slide
   * over the page as it scrolls — and let the link's default action (the
   * router's fragment navigation) run untouched. Focus then moves to the
   * section itself, so keyboard and screen-reader users carry on reading
   * from there rather than from the floating button.
   */
  function jumpFromSheet(index: number) {
    sheet.dataset.instant = "";
    sheet.close();
    const heading = headings[index];
    if (!heading) return;
    if (!heading.hasAttribute("tabindex")) heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }

  // ---- Wiring --------------------------------------------------------------

  const options = { signal, passive: true };

  window.addEventListener(
    "scroll",
    () => {
      schedule();
      window.clearTimeout(scrollEndTimer);
      if (!HAS_SCROLL_END) {
        scrollEndTimer = window.setTimeout(
          checkPinOnScrollEnd,
          SCROLL_END_DELAY
        );
      }
    },
    options
  );
  window.addEventListener("scrollend", checkPinOnScrollEnd, options);
  window.addEventListener("resize", schedule, options);

  // Anything the reader does to scroll by themselves ends a pin.
  window.addEventListener("wheel", unpin, options);
  window.addEventListener("touchstart", unpin, options);
  window.addEventListener(
    "keydown",
    e => {
      if (!SCROLL_KEYS.has(e.key)) return;
      // Keys typed into a field (the search box) or used inside the sheet
      // don't move the page.
      const target = e.target as Element;
      if (target.closest?.(EDITABLE) || sheet.contains(target)) return;
      unpin();
    },
    options
  );
  window.addEventListener(
    "pointerdown",
    e => {
      const target = e.target as Node;
      if (!rail.contains(target) && !sheet.contains(target)) unpin();
    },
    options
  );

  rail.addEventListener(
    "click",
    e => {
      const link = (e.target as Element).closest("a");
      const index = link ? railLinks.indexOf(link as HTMLAnchorElement) : -1;
      if (index >= 0 && isPlainClick(e)) pin(index);
    },
    { signal }
  );
  // Any other in-page link to a listed section — a heading's own `#`
  // permalink, a cross-reference in the text — selects it just the same.
  document.addEventListener(
    "click",
    e => {
      const link = (e.target as Element).closest?.("a[href]");
      if (
        !(link instanceof HTMLAnchorElement) ||
        !isPlainClick(e) ||
        rail.contains(link) ||
        sheet.contains(link) ||
        link.pathname !== location.pathname ||
        link.search !== location.search
      ) {
        return;
      }
      const index = indexOfHash(link.hash);
      if (index >= 0) pin(index);
    },
    { signal }
  );
  railScroll.addEventListener("scroll", updateFade, options);

  button.addEventListener("click", openSheet, { signal });
  // Leaving the button may let it hide (see `update`).
  button.addEventListener("blur", schedule, { signal });
  // Padding is zero, so the dialog box itself is the backdrop. A press that
  // starts inside the panel and is released over the backdrop (a text
  // selection, a finger sliding off) clicks their common ancestor — the
  // dialog — too; only a press that starts on the backdrop dismisses.
  let pressedBackdrop = false;
  sheet.addEventListener(
    "pointerdown",
    e => {
      pressedBackdrop = e.target === sheet;
    },
    options
  );
  sheet.addEventListener(
    "click",
    e => {
      if (e.target === sheet) {
        if (pressedBackdrop) sheet.close();
        return;
      }
      if ((e.target as Element).closest("[data-toc-close]")) {
        sheet.close();
        return;
      }
      const link = (e.target as Element).closest("a");
      const index = link ? sheetLinks.indexOf(link as HTMLAnchorElement) : -1;
      if (index >= 0 && isPlainClick(e)) {
        pin(index);
        jumpFromSheet(index);
      }
    },
    { signal }
  );
  wide.addEventListener(
    "change",
    () => {
      if (!wide.matches || !sheet.open) return;
      sheet.close();
      // Focus can't go back to the button, which the rail has just replaced
      // (display: none), and would otherwise fall to <body>: carry it over to
      // the rail instead.
      const focused = document.activeElement;
      if (
        !focused ||
        focused === document.body ||
        focused === button ||
        sheet.contains(focused)
      ) {
        (railLinks[activeIndex] ?? railLinks[0])?.focus({
          preventScroll: true,
        });
      }
    },
    { signal }
  );

  // Headings move whenever the article re-flows (fonts, images, callouts
  // opening); the rail re-wraps whenever its width or fonts change.
  const articleObserver = new ResizeObserver(schedule);
  articleObserver.observe(article);
  const railObserver = new ResizeObserver(() => {
    placeIndicator(true);
    updateTitles();
    updateFade();
  });
  railObserver.observe(railTrack);
  railObserver.observe(railScroll);

  // A deep link to a section selects it, like a click would have.
  const hashIndex = indexOfHash(location.hash);
  if (hashIndex >= 0) pin(hashIndex);

  button.hidden = false;
  button.inert = true;
  schedule();

  const cleanup = () => {
    controller.abort();
    articleObserver.disconnect();
    railObserver.disconnect();
    cancelAnimationFrame(frame);
    window.clearTimeout(scrollEndTimer);
    sheet.close();
    if (teardown === cleanup) teardown = null;
  };
  document.addEventListener("astro:before-swap", cleanup, { signal });
  return cleanup;
}
