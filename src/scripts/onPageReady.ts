/**
 * Run `fn` once the DOM is usable, and again after every View Transition swap.
 *
 * Why not just `astro:page-load`: on a *first* load the ClientRouter fires that
 * event from the window `load` event, which waits for every subresource the
 * page has already started fetching — including images. On a photo-heavy page
 * over a slow connection that is tens of seconds (measured: ~49s on a 400kbps /
 * 400ms-RTT profile for `/gallery/`), and until it fires the page has no
 * interactive behavior at all: gallery thumbnails are still plain links, so
 * tapping one navigates away to the full-resolution original instead of opening
 * the lightbox.
 *
 * `DOMContentLoaded` does not wait for images, so hook that for the first load
 * and keep `astro:page-load` for subsequent client-side navigations. The guard
 * keeps `fn` to exactly one call per page instance, so callers don't have to be
 * idempotent to survive both firing.
 */
export function onPageReady(fn: () => void) {
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    fn();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }

  // Each swap installs a fresh DOM, so allow one more run for the new page.
  document.addEventListener("astro:before-swap", () => (ran = false));
  document.addEventListener("astro:page-load", run);
}
