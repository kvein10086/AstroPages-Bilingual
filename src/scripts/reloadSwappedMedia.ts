/**
 * Revive `<video>` / `<audio>` players that a View Transitions swap left dead.
 *
 * The ClientRouter builds the next page with `DOMParser` and only then moves
 * its body into the live document. A media element with a `src` starts its
 * load algorithm as soon as it is parsed — inside a document that has no
 * browsing context — and Chrome rejects that load outright ("Media load
 * rejected by URL safety check", MEDIA_ERR_SRC_NOT_SUPPORTED). Moving the
 * element into the real page doesn't retry it, so every player on a page
 * reached by client-side navigation arrives with greyed-out controls and never
 * plays. A full page load skips the parser detour, which is why the same post
 * plays fine after a refresh.
 *
 * Re-running the load algorithm once the element lives in the real document
 * fixes it. Re-setting `src` does that while honouring `preload` — the
 * obvious `load()` makes Chromium ignore `preload="none"` and pull every clip
 * on the page up front. `load()` remains the fallback for `<source>`-based
 * players, which have no `src` to re-set.
 *
 * Only players with nothing loaded are touched, so one carried across the swap
 * with `transition:persist` keeps playing.
 */
function reloadSwappedMedia(): void {
  for (const media of document.querySelectorAll<HTMLMediaElement>(
    "video, audio"
  )) {
    if (media.readyState !== HTMLMediaElement.HAVE_NOTHING) continue;
    const src = media.getAttribute("src");
    if (src !== null) media.setAttribute("src", src);
    else media.load();
  }
}

document.addEventListener("astro:after-swap", reloadSwappedMedia);
