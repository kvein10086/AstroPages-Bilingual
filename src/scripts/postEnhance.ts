/**
 * Post page enhancements, shared by the zh and en post pages: the reading
 * progress bar, the back-to-top button (markup in
 * src/pages/posts/[...slug]/_components/BackToTopButton.astro), heading anchor
 * links and code copy buttons.
 *
 * This is a bundled module, run once per page instance through `onPageReady`.
 * It used to be `is:inline data-astro-rerun` scripts, which re-ran on every
 * visit and added `document` listeners that nothing ever removed: two more
 * scroll handlers per post read, still firing on every page after it, and
 * each one keeping its old page's DOM alive. Here every listener hangs off one
 * `AbortController` that `astro:before-swap` aborts.
 */

/** Share of the page scrolled past before the back-to-top button shows. */
const BACK_TO_TOP_THRESHOLD = 0.3;

/** How long "Copied" stays on a copy button. */
const COPY_FEEDBACK_MS = 700;

/** Cleanup for the page instance currently wired up. */
let teardown: (() => void) | null = null;

/** Link icon after each heading of the article, pointing at its `id`. */
function addHeadingLinks(article: HTMLElement) {
  const headings = article.querySelectorAll<HTMLElement>(
    ":is(h2, h3, h4, h5, h6)[id]"
  );
  for (const heading of headings) {
    heading.classList.add("group");
    const link = document.createElement("a");
    link.className =
      "heading-link ms-2 no-underline opacity-75 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100";
    link.href = `#${heading.id}`;

    const span = document.createElement("span");
    span.ariaHidden = "true";
    span.textContent = "#";
    link.appendChild(span);
    heading.appendChild(link);
  }
}

/** A copy button on every code block; returns a canceller for its timers. */
function attachCopyButtons(article: HTMLElement, signal: AbortSignal) {
  const label = "Copy";
  const timers = new Set<number>();

  for (const codeBlock of article.querySelectorAll("pre")) {
    const wrapper = document.createElement("div");
    wrapper.style.position = "relative";

    // The file-name transformer shifts the block down to make room for its
    // tab; the button follows it instead of overlapping the tab.
    const hasFileNameOffset =
      getComputedStyle(codeBlock)
        .getPropertyValue("--file-name-offset")
        .trim() !== "";
    const topClass = hasFileNameOffset ? "top-(--file-name-offset)" : "-top-3";

    const button = document.createElement("button");
    button.className = `copy-code absolute end-3 ${topClass} rounded bg-muted border border-muted px-2 py-1 text-xs leading-4 text-foreground font-medium`;
    button.textContent = label;
    codeBlock.setAttribute("tabindex", "0");
    codeBlock.appendChild(button);

    codeBlock.parentNode?.insertBefore(wrapper, codeBlock);
    wrapper.appendChild(codeBlock);

    button.addEventListener(
      "click",
      async () => {
        const text = codeBlock.querySelector("code")?.innerText ?? "";
        await navigator.clipboard.writeText(text);
        button.textContent = "Copied";
        const timer = window.setTimeout(() => {
          timers.delete(timer);
          button.textContent = label;
        }, COPY_FEEDBACK_MS);
        timers.add(timer);
      },
      { signal }
    );
  }

  return () => {
    for (const timer of timers) window.clearTimeout(timer);
    timers.clear();
  };
}

/**
 * Reading progress: a bar across the top of the viewport and, on phones, a
 * ring around the back-to-top button, which itself shows once the reader is
 * past `BACK_TO_TOP_THRESHOLD`. One rAF-throttled passive scroll handler
 * drives all three.
 */
function initScrollChrome(signal: AbortSignal) {
  const root = document.documentElement;

  const progressContainer = document.createElement("div");
  progressContainer.className =
    "progress-container fixed top-0 z-10 h-1 w-full bg-background";
  const progressBar = document.createElement("div");
  progressBar.className = "progress-bar h-1 w-0 bg-accent";
  progressBar.id = "myBar";
  progressContainer.appendChild(progressBar);
  document.body.appendChild(progressContainer);

  const btnContainer = document.getElementById("btt-btn-container");
  const backToTopBtn = btnContainer?.querySelector<HTMLButtonElement>(
    "[data-button='back-to-top']"
  );
  const progressIndicator = document.getElementById("progress-indicator");

  backToTopBtn?.addEventListener(
    "click",
    () => {
      document.body.scrollTop = 0;
      root.scrollTop = 0;
    },
    { signal }
  );

  let lastVisible: boolean | null = null;
  function update() {
    const scrollTotal = root.scrollHeight - root.clientHeight;
    // A page that doesn't scroll has nothing left to read.
    const progress = scrollTotal > 0 ? root.scrollTop / scrollTotal : 1;
    const percent = Math.floor(progress * 100);

    progressBar.style.width = `${percent}%`;
    progressIndicator?.style.setProperty(
      "background-image",
      `conic-gradient(var(--accent), var(--accent) ${percent}%, transparent ${percent}%)`
    );

    const visible = scrollTotal > 0 && progress > BACK_TO_TOP_THRESHOLD;
    if (btnContainer && visible !== lastVisible) {
      btnContainer.classList.toggle("opacity-100", visible);
      btnContainer.classList.toggle("translate-y-0", visible);
      btnContainer.classList.toggle("opacity-0", !visible);
      btnContainer.classList.toggle("translate-y-14", !visible);
      lastVisible = visible;
    }
  }

  let frame = 0;
  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      update();
    });
  };
  const options = { signal, passive: true };
  window.addEventListener("scroll", schedule, options);
  window.addEventListener("resize", schedule, options);
  update();

  return () => cancelAnimationFrame(frame);
}

export function initPostEnhance() {
  teardown?.();

  const article = document.getElementById("article");
  if (!article) return;

  const controller = new AbortController();
  const { signal } = controller;

  addHeadingLinks(article);
  const cancelCopyTimers = attachCopyButtons(article, signal);
  const cancelFrame = initScrollChrome(signal);

  const cleanup = () => {
    controller.abort();
    cancelCopyTimers();
    cancelFrame();
    if (teardown === cleanup) teardown = null;
  };
  teardown = cleanup;
  document.addEventListener("astro:before-swap", cleanup, { signal });
}
