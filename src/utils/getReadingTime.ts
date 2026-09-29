import type { CollectionEntry } from "astro:content";
import config from "@/config";
import { stripMarkdownCode } from "./media";

/**
 * Reading speeds. CJK text is read character by character and Latin text word
 * by word, and the two rates don't convert into each other — so both are
 * counted separately and the times added, which keeps a Chinese post full of
 * English terms and an English post quoting Chinese equally honest.
 */
const CJK_CHARS_PER_MINUTE = 400;
const LATIN_WORDS_PER_MINUTE = 230;

/** Han ideographs, kana and hangul; CJK punctuation is Script=Common. */
const CJK_CHAR_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

/**
 * A word once CJK is gone: letters, marks and decimal digits, optionally joined
 * by an apostrophe ("don't" is one word). Punctuation and markdown syntax
 * (`#`, `*`, `|`, `-`) never match, and neither do superscript footnote digits.
 */
const WORD_RE = /[\p{L}\p{M}\p{Nd}]+(?:['’][\p{L}\p{M}\p{Nd}]+)*/gu;

/** A link/image destination; tolerates one level of parentheses (Wikipedia). */
const DEST = String.raw`\((?:[^()\n]|\([^()\n]*\))*\)`;

/** Ordered: each step assumes the ones above it already ran. */
const STRIP_STEPS: [RegExp, string][] = [
  // A YAML block, should the body still carry one (it normally arrives
  // without: the glob loader cuts the frontmatter off).
  [/^---\n[\w-]+\s*:[\s\S]*?\n---\n/, ""],
  // MDX ESM lines.
  [/^(?:import|export)\s.*$/gm, ""],
  [/<!--[\s\S]*?-->/g, " "],
  // Display math, then inline math (the same `$…$` remark-math renders).
  [/\$\$[\s\S]*?\$\$/g, " "],
  [/\\\[[\s\S]*?\\\]/g, " "],
  [/\\\([\s\S]*?\\\)/g, " "],
  [/\$[^$\n]+\$/g, " "],
  // Images carry no reading text (the alt isn't on screen).
  [new RegExp(String.raw`!\[[^\]\n]*\]` + DEST, "g"), " "],
  [/!\[[^\]\n]*\]\[[^\]\n]*\]/g, " "],
  // Links keep their text and lose the destination.
  [new RegExp(String.raw`\[([^\]\n]*)\]` + DEST, "g"), "$1"],
  [/\[([^\]\n]*)\]\[[^\]\n]*\]/g, "$1"],
  // Reference definitions go; footnote definitions (`[^1]: …`) are prose.
  [/^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S+.*$/gm, " "],
  [/\[\^[^\]\n]+\]/g, " "],
  // Autolinks and bare URLs.
  [/<[a-z][\w+.-]*:[^<>\s]*>/gi, " "],
  [/\b(?:https?|ftp):\/\/\S+/gi, " "],
  // HTML / JSX tags (their text content stays) and entities.
  [/<\/?[A-Za-z][^<>]*>/g, " "],
  [/&(?:#\d+|#x[\da-f]+|\w+);/gi, " "],
];

/** Only the words a reader actually reads: code, math, URLs and markup go. */
function toReadableText(body: string): string {
  // Fenced code blocks are emptied with the same fence rules the gallery
  // scanner uses; inline code stays, since its words are read in the sentence.
  let text = stripMarkdownCode(body.replace(/\r\n?/g, "\n"));
  for (const [pattern, replacement] of STRIP_STEPS) {
    text = text.replace(pattern, replacement);
  }
  return text;
}

/**
 * Estimated reading time of a markdown/MDX body, in whole minutes (at least 1).
 */
export function getReadingTime(body: string): number {
  const text = toReadableText(body);
  const cjkChars = text.match(CJK_CHAR_RE)?.length ?? 0;
  const latinWords = text.replace(CJK_CHAR_RE, " ").match(WORD_RE)?.length ?? 0;
  const minutes =
    cjkChars / CJK_CHARS_PER_MINUTE + latinWords / LATIN_WORDS_PER_MINUTE;
  return Math.max(1, Math.round(minutes));
}

/**
 * The reading time to show for a post, or `null` when none is shown: the
 * feature is off, or it's a `gallery: true` post — a photo album would claim
 * "1 min" for what is mostly looking, which misleads more than it helps.
 */
export function getPostReadingTime({
  body,
  data,
}: Pick<CollectionEntry<"posts">, "body" | "data">): number | null {
  if (!config.features.readingTime || data.gallery || body === undefined) {
    return null;
  }
  return getReadingTime(body);
}
