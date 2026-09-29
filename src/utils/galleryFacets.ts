import type { GalleryPhotoFacets } from "@/types/gallery";
import type { UIStrings } from "@/i18n/types";

/**
 * Filter facets for the /gallery page, derived at build time from the EXIF
 * already in the manifest — nothing here is specific to a camera or brand.
 *
 * Every dimension is keyed by a URL-safe slug (the `?camera=`, `?lens=` and
 * `?focal=` values read by `src/scripts/galleryFilter.ts`) and labelled for
 * display. The slug for a camera or lens comes from its raw key rather than
 * from the cleaned-up label, so a shared link keeps working when more photos
 * shift a label (the lens label depends on the photos' focal-length mode).
 */

export type FacetKey = keyof GalleryPhotoFacets;

/** Rendering order of the dimensions. */
export const FACET_KEYS: readonly FacetKey[] = ["camera", "lens", "focal"];

/** Reserved value: matches items lacking a dimension. Never a real slug. */
export const UNKNOWN_FACET = "unknown";

/** The EXIF each photo contributes to faceting, already trimmed/normalized. */
export interface FacetSource {
  /** Normalized camera name (see `normalizeCamera`) */
  camera?: string;
  /** Raw lens model string */
  lens?: string;
  /** Camera model, used to recognize a built-in lens's model prefix */
  model?: string;
  /** 35mm-equivalent focal length in mm */
  focal35?: number;
}

/** One chip: slug, display label, and how many gallery items carry it. */
export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

/** One rendered dimension. `unknown` counts items lacking it. */
export interface FacetGroup {
  key: FacetKey;
  options: FacetOption[];
  unknown: number;
}

/** Facet slugs per item plus the slug → label maps of the named dimensions. */
export interface ResolvedFacets {
  items: (GalleryPhotoFacets | undefined)[];
  labels: Record<"camera" | "lens", Map<string, string>>;
}

/**
 * 35mm-equivalent focal buckets, ascending. `max` is inclusive and applies to
 * the rounded focal length; `range` is the chip's mm suffix.
 */
const FOCAL_BUCKETS = [
  { value: "lt24", max: 23, name: "focalUltraWide", range: "<24" },
  { value: "24-35", max: 35, name: "focalWide", range: "24–35" },
  { value: "36-70", max: 70, name: "focalStandard", range: "36–70" },
  { value: "71-135", max: 135, name: "focalShortTele", range: "71–135" },
  { value: "136-300", max: 300, name: "focalTele", range: "136–300" },
  { value: "gt300", max: Infinity, name: "focalSuperTele", range: ">300" },
] as const satisfies readonly {
  value: string;
  max: number;
  name: keyof UIStrings["gallery"];
  range: string;
}[];

/** A phone's camera-module descriptor, e.g. "back triple camera". */
const PHONE_MODULE_RE = /\b(?:back|front|rear)\b[\w\s]*?\bcamera\b\s*/i;

/** A single physical focal length at the start, e.g. "6.765mm" (not "24-60"). */
const SINGLE_FOCAL_RE = /^\d+(?:\.\d+)?mm\b/;

/** The focal bucket slug for a 35mm-equivalent focal length. */
function focalBucket(focal35: number | undefined): string | undefined {
  if (!focal35 || focal35 <= 0) return undefined;
  const mm = Math.round(focal35);
  return FOCAL_BUCKETS.find(bucket => mm <= bucket.max)?.value;
}

/** Lowercase; runs of anything but Unicode letters/digits collapse to "-". */
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Slug every raw key, in sorted order so collisions resolve the same way on
 * every build: the later key gets "-2", "-3"… `unknown` is never handed out.
 */
function assignSlugs(keys: Iterable<string>, fallback: string) {
  const used = new Set<string>([UNKNOWN_FACET]);
  const slugs = new Map<string, string>();
  for (const key of [...keys].sort()) {
    const base = toSlug(key) || fallback;
    let slug = base;
    for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`;
    used.add(slug);
    slugs.set(key, slug);
  }
  return slugs;
}

/** Most frequent value; ties go to the smallest. */
function mode(values: number[]): number | undefined {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | undefined;
  let bestCount = 0;
  for (const [v, count] of counts) {
    if (count > bestCount || (count === bestCount && v < (best ?? v))) {
      best = v;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Chip label for a raw lens string. A phone's built-in lens reads e.g.
 * "iPhone 15 Pro back triple camera 6.765mm f/1.78": the module descriptor is
 * dropped and the physical focal length becomes the 35mm equivalent most of
 * its photos were shot at, giving "iPhone 15 Pro 24mm ƒ/1.78". The focal
 * swap only applies to a recognized built-in lens (a module descriptor was
 * dropped or a model prefix found): an interchangeable prime such as
 * "56mm F1.4 DC DN | C 018" on a crop body keeps its physical focal length.
 */
function lensLabel(raw: string, models: Set<string>, focals: number[]) {
  const trimmed = raw.trim();
  const stripped = trimmed.replace(PHONE_MODULE_RE, "").trim();
  let rest = stripped;
  // Keep a leading model name aside so the focal check sees what follows it.
  const model = [...models]
    .filter(m => rest === m || rest.startsWith(`${m} `))
    .sort((a, b) => b.length - a.length)[0];
  if (model) rest = rest.slice(model.length).trim();
  const builtIn = stripped !== trimmed || model !== undefined;
  const equivalent = mode(focals);
  if (builtIn && equivalent !== undefined) {
    rest = rest.replace(SINGLE_FOCAL_RE, `${equivalent}mm`);
  }
  const label = (model ? `${model} ${rest}` : rest)
    .trim()
    .replace(/\bf\//g, "ƒ/");
  return label || raw;
}

/**
 * Resolve every item's facet slugs, plus the labels of the camera and lens
 * dimensions. Pure and order-independent in its slugs, so any caller passing
 * the same set of items gets the same answer.
 */
export function resolveFacets(sources: FacetSource[]): ResolvedFacets {
  const cameras = new Set<string>();
  const lenses = new Map<string, { models: Set<string>; focals: number[] }>();
  for (const src of sources) {
    if (src.camera) cameras.add(src.camera);
    if (!src.lens) continue;
    const lens = lenses.get(src.lens) ?? { models: new Set(), focals: [] };
    if (src.model) lens.models.add(src.model);
    if (src.focal35 && src.focal35 > 0) {
      lens.focals.push(Math.round(src.focal35));
    }
    lenses.set(src.lens, lens);
  }

  const cameraSlugs = assignSlugs(cameras, "camera");
  const lensSlugs = assignSlugs(lenses.keys(), "lens");

  // Two lenses cleaned up into the same label would be indistinguishable
  // chips; fall back to the raw strings for both.
  const lensLabels = new Map<string, string>();
  const seenLabels = new Map<string, number>();
  for (const [raw, { models, focals }] of lenses) {
    const label = lensLabel(raw, models, focals);
    lensLabels.set(raw, label);
    seenLabels.set(label, (seenLabels.get(label) ?? 0) + 1);
  }

  const labels: ResolvedFacets["labels"] = {
    camera: new Map(),
    lens: new Map(),
  };
  for (const [camera, slug] of cameraSlugs) labels.camera.set(slug, camera);
  for (const [raw, slug] of lensSlugs) {
    const label = lensLabels.get(raw) ?? raw;
    labels.lens.set(slug, (seenLabels.get(label) ?? 0) > 1 ? raw : label);
  }

  const items = sources.map(src => {
    const facets: GalleryPhotoFacets = {};
    if (src.camera) facets.camera = cameraSlugs.get(src.camera);
    if (src.lens) facets.lens = lensSlugs.get(src.lens);
    const focal = focalBucket(src.focal35);
    if (focal) facets.focal = focal;
    return Object.keys(facets).length ? facets : undefined;
  });

  return { items, labels };
}

/**
 * The dimensions worth rendering, with their chips. Camera and lens chips are
 * ordered by count (ties by label), focal buckets by range, and empty buckets
 * are left out. A dimension needs at least two known values to be offered —
 * one value can't narrow anything down.
 */
export function buildFacetGroups(
  items: (GalleryPhotoFacets | undefined)[],
  labels: ResolvedFacets["labels"],
  t: UIStrings
): FacetGroup[] {
  const groups: FacetGroup[] = [];
  for (const key of FACET_KEYS) {
    const counts = new Map<string, number>();
    let unknown = 0;
    for (const item of items) {
      const value = item?.[key];
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      else unknown++;
    }
    if (counts.size < 2) continue;

    let options: FacetOption[];
    if (key === "focal") {
      options = FOCAL_BUCKETS.filter(bucket => counts.has(bucket.value)).map(
        bucket => ({
          value: bucket.value,
          label: `${t.gallery[bucket.name]} ${bucket.range}mm`,
          count: counts.get(bucket.value) ?? 0,
        })
      );
    } else {
      options = [...counts]
        .map(([value, count]) => ({
          value,
          label: labels[key].get(value) ?? value,
          count,
        }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    }
    groups.push({ key, options, unknown });
  }
  return groups;
}
