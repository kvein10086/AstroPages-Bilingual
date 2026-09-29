/**
 * Make View Transitions land on their scroll position instantly.
 *
 * `<html>` carries `scroll-smooth` for in-page anchor links. The ClientRouter
 * restores the saved position on back/forward with a plain
 * `scrollTo(x, y)`, which honours that CSS — so returning to a long post
 * animated from the top down to where the reader left off (~0.8s across a
 * 3000px restore), and a cross-page `#hash` link glided to its section too
 * (see the `astro:after-swap` listener below for that case).
 *
 * The override has to go on the *incoming* document: the swap replaces every
 * attribute of the live `<html>` with the new page's, so a style written to
 * `document.documentElement` here would be gone before the router scrolls.
 * It is cleared on `astro:page-load`, after the router has scrolled, so
 * anchor links on the new page are smooth again.
 */
document.addEventListener("astro:before-swap", event => {
  event.newDocument.documentElement.style.scrollBehavior = "auto";
});

// A cross-page `#hash` link is not scrolled by `scrollTo`: the router sets
// `location.href`, and the browser defers that fragment scroll to the next
// layout — by which time `astro:page-load` may already have put
// `scroll-behavior: smooth` back, so the page glided ~20000px to a section
// near the end of a long post. The router fires `astro:after-swap` right
// after it has moved to the new location; reading a layout value there forces
// that layout, and with it the fragment scroll, while `auto` is still set.
document.addEventListener("astro:after-swap", () => {
  void document.documentElement.scrollTop;
});

document.addEventListener("astro:page-load", () => {
  const root = document.documentElement;
  root.style.removeProperty("scroll-behavior");
  // Don't leave a bare `style=""` behind on every page.
  if (!root.getAttribute("style")) root.removeAttribute("style");
});
