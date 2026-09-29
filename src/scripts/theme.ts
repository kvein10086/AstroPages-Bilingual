/**
 * Light/dark theme. The first paint is handled by the inline FOUC-prevention
 * script in Layout.astro (`stored ?? system`); this module keeps the page, the
 * header button and `<meta name="theme-color">` in step afterwards.
 *
 * localStorage holds an explicit choice only. No stored value means "follow
 * the system", and the button has just two states, so there is no third
 * "auto" position to go back to — instead, choosing the theme the system
 * already prefers clears the stored value. OS appearance changes are never
 * written back: a tab left open over a macOS "Auto" dusk switch would
 * otherwise pin the page to dark for good.
 */

const THEME_KEY = "theme";
const LIGHT = "light";
const DARK = "dark";

const systemDark = window.matchMedia("(prefers-color-scheme: dark)");

function systemTheme(): string {
  return systemDark.matches ? DARK : LIGHT;
}

function getPreferredTheme(): string {
  return localStorage.getItem(THEME_KEY) ?? systemTheme();
}

// Reuse the value already set by the inline FOUC-prevention script if available.
let themeValue: string =
  (window as unknown as { __theme?: { value: string } }).__theme?.value ??
  getPreferredTheme();

/** An explicit choice by the reader: remembered unless it equals the system's. */
function choose(value: string): void {
  themeValue = value;
  if (value === systemTheme()) {
    localStorage.removeItem(THEME_KEY);
  } else {
    localStorage.setItem(THEME_KEY, value);
  }
  reflect();
}

function reflect(): void {
  const root = document.firstElementChild;
  root?.setAttribute("data-theme", themeValue);
  root?.classList.toggle("dark", themeValue === DARK);
  // The button's accessible name is a fixed, localised "Dark mode" (set in
  // Header.astro); the state goes in `aria-pressed`, so screen readers hear
  // "Dark mode, toggle button, pressed" instead of a raw "light"/"dark".
  document
    .querySelector("#theme-btn")
    ?.setAttribute("aria-pressed", String(themeValue === DARK));

  // Fill <meta name="theme-color"> with the computed background colour so
  // Android's browser chrome matches the page background.
  const bg = window.getComputedStyle(document.body).backgroundColor;
  document
    .querySelector("meta[name='theme-color']")
    ?.setAttribute("content", bg);
}

function setup(): void {
  reflect();
  document.querySelector("#theme-btn")?.addEventListener("click", () => {
    choose(themeValue === LIGHT ? DARK : LIGHT);
  });
}

setup();

// Re-run after View Transitions navigation.
document.addEventListener("astro:after-swap", setup);

// Carry the theme-color value across View Transitions to prevent the
// Android navigation bar from flashing during page transitions.
document.addEventListener("astro:before-swap", event => {
  const color = document
    .querySelector("meta[name='theme-color']")
    ?.getAttribute("content");
  if (color) {
    (event as { newDocument: Document }).newDocument
      .querySelector("meta[name='theme-color']")
      ?.setAttribute("content", color);
  }
});

// Follow OS-level appearance changes, unless the reader has made an explicit
// choice. Never persisted (see the top of the file). This also fires while
// Chrome prints — it evaluates the print as `prefers-color-scheme: light` and
// switches back afterwards — so a system-following page prints light and
// returns to dark, and nothing is written along the way.
systemDark.addEventListener("change", () => {
  if (localStorage.getItem(THEME_KEY)) return;
  themeValue = systemTheme();
  reflect();
});
