import { fontData, experimental_getFontFileURL } from "astro:assets";
import { getFontPathByWeight } from "./getFontPathByWeight";

type OgFont = {
  name: string;
  data: ArrayBuffer;
  weight: 400 | 700;
  style: "normal";
};

/** The Astro-managed webfont the OG images are set in — Latin glyphs only. */
const LATIN_FAMILY = "Google Sans Code";

/**
 * Whatever the Latin font cannot draw (CJK, Cyrillic, Greek, …) comes from this
 * family instead, so a Chinese title renders as text rather than tofu boxes.
 * Swap it for `Noto Sans JP` / `Noto Sans KR` / … on a site written in another
 * script — any Google font whose CSS yields a TTF/WOFF file works.
 *
 * Google serves CJK families as one big TTF (the `text=` subset parameter is
 * ignored for them), so the file is fetched at most once per build, only when a
 * non-Latin character actually shows up, and is never emitted into the output.
 */
const FALLBACK_FAMILY = "Noto Sans SC";
const FALLBACK_CSS_URL =
  "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;700";

/** Basic Latin + Latin-1 + Latin Extended-A/B + general punctuation. */
const LATIN_RANGE = /^[\u0000-\u024f\u2000-\u206f]*$/;

/** `font-weight: 400; src: url(https://…) format('truetype');` inside a face. */
const FONT_FACE =
  /font-weight:\s*(\d+);[^}]*?src:\s*url\((https:\/\/[^)]+)\)(?:\s*format\('([^']+)'\))?/g;

let fallbackFonts: Promise<OgFont[]> | undefined;

async function fetchFallbackFonts(): Promise<OgFont[]> {
  const response = await fetch(FALLBACK_CSS_URL);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  const css = await response.text();

  // satori reads TTF/OTF/WOFF but not WOFF2. Google picks the format from the
  // User-Agent and hands Node's default fetch a TTF, but skip WOFF2 defensively
  // rather than feeding satori a file it would reject.
  const faces = [...css.matchAll(FONT_FACE)].filter(
    ([, , , format]) => format !== "woff2"
  );
  if (faces.length === 0) {
    throw new Error("no TTF/WOFF @font-face in the stylesheet");
  }

  return Promise.all(
    faces.map(async ([, weight, url]) => ({
      name: FALLBACK_FAMILY,
      data: await fetch(url).then(res => res.arrayBuffer()),
      weight: Number(weight) as 400 | 700,
      style: "normal" as const,
    }))
  );
}

function getFallbackFonts(): Promise<OgFont[]> {
  // Memoised for the whole build — including the failure, so a site built
  // offline warns once instead of retrying for every post.
  fallbackFonts ??= fetchFallbackFonts().catch((error: unknown) => {
    // This runs in the Node build, where a warning is the only way to say that
    // the OG images came out worse than usual.
    // eslint-disable-next-line no-console
    console.warn(
      `[og-image] Could not load the ${FALLBACK_FAMILY} fallback (${error}). ` +
        "Non-Latin characters will render as empty boxes."
    );
    return [];
  });
  return fallbackFonts;
}

/**
 * Font set for a satori OG image: the Latin webfont first, so it keeps winning
 * for Latin text, followed by a fallback family whenever any of `texts` reaches
 * outside the Latin ranges. A site with Latin-only titles fetches nothing extra.
 */
export async function getOgFonts(
  url: URL,
  ...texts: (string | undefined)[]
): Promise<OgFont[]> {
  const fonts = fontData["--font-google-sans-code"];
  const regularFontPath = getFontPathByWeight(fonts, 400);
  const boldFontPath = getFontPathByWeight(fonts, 700);

  if (regularFontPath === undefined || boldFontPath === undefined) {
    throw new Error("Cannot find the font path.");
  }

  const [regularData, boldData] = await Promise.all([
    fetch(experimental_getFontFileURL(regularFontPath, url)).then(res =>
      res.arrayBuffer()
    ),
    fetch(experimental_getFontFileURL(boldFontPath, url)).then(res =>
      res.arrayBuffer()
    ),
  ]);

  const latinFonts: OgFont[] = [
    { name: LATIN_FAMILY, data: regularData, weight: 400, style: "normal" },
    { name: LATIN_FAMILY, data: boldData, weight: 700, style: "normal" },
  ];

  if (texts.every(text => LATIN_RANGE.test(text ?? ""))) {
    return latinFonts;
  }

  return [...latinFonts, ...(await getFallbackFonts())];
}
