/**
 * Collect a clean, readable label for every heading, for the post TOC.
 *
 * Astro's collected `headings[].text` is the heading's raw text content, which
 * is fine for prose but garbage wherever a heading holds rendered markup: KaTeX
 * emits each formula twice (MathML for assistive tech + an `aria-hidden` HTML
 * copy), so `## The $O(n^2)$ bound` collects as "The O(n2)O(n^2)O(n2) bound",
 * and a footnote reference glues its number onto the last word. This plugin
 * walks the finished heading instead and keeps only what a reader would read:
 *
 * - `aria-hidden` subtrees and footnote references are skipped;
 * - a KaTeX formula contributes its TeX source (the `application/x-tex`
 *   annotation), the one form that reads sensibly as plain text;
 * - inline code and links contribute their text.
 *
 * Labels land in `file.data.astro.frontmatter.tocLabels` as `{ [id]: label }`,
 * which the post page reads back through `remarkPluginFrontmatter`. That is
 * the one channel Astro offers from a rehype plugin to the page for both
 * `.md` and `.mdx`.
 *
 * It must run after `rehypeKatex` (the markup it cleans up) and after
 * `rehypeHeadingIds` (the ids it keys on) — see `astro.config.ts`. Astro runs
 * `rehypeHeadingIds` once more at the end of the pipeline, but that pass keeps
 * ids that already exist and uses the same slugger, so running it early does
 * not change a single id.
 *
 * MDX expressions (`{frontmatter.title}`) cannot be evaluated here; a heading
 * holding one gets no label and the TOC falls back to Astro's text, which
 * does resolve frontmatter references.
 *
 * The tree walk and the hast types are hand-rolled on purpose: this module is
 * pulled in by `astro.config.ts`, so it must not import packages that are only
 * present as transitive dependencies (`unist-util-visit`, `@types/hast`).
 */

/** The sliver of hast this plugin touches. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

interface VFileLike {
  data: { astro?: { frontmatter?: Record<string, unknown> } };
}

/** Node types whose text is only known at runtime (MDX) or unparsed (raw HTML). */
const OPAQUE_TYPES = new Set([
  "raw",
  "mdxTextExpression",
  "mdxFlowExpression",
  "mdxJsxTextElement",
  "mdxJsxFlowElement",
]);

const HEADING_TAG = /^h[2-6]$/;

function hasClass(node: HastNode, name: string): boolean {
  const className = node.properties?.className;
  return Array.isArray(className) && className.includes(name);
}

function isHidden(node: HastNode): boolean {
  const properties = node.properties ?? {};
  const ariaHidden = properties.ariaHidden;
  return (
    ariaHidden === true ||
    ariaHidden === "true" ||
    // remark-rehype marks footnote references with `data-footnote-ref`.
    properties.dataFootnoteRef !== undefined
  );
}

/** The TeX source KaTeX keeps in its MathML `<annotation>`. */
function findTex(node: HastNode): string | undefined {
  if (
    node.tagName === "annotation" &&
    node.properties?.encoding === "application/x-tex"
  ) {
    return textOf(node);
  }
  for (const child of node.children ?? []) {
    const tex = findTex(child);
    if (tex !== undefined) return tex;
  }
  return undefined;
}

/** Plain text of a subtree, ignoring nothing. */
function textOf(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return (node.children ?? []).map(textOf).join("");
}

/**
 * What a reader reads (see the module comment for the rules), or `null` when
 * the subtree holds a node whose text can't be known here.
 */
function labelOf(node: HastNode): string | null {
  if (OPAQUE_TYPES.has(node.type)) return null;
  if (node.type === "text") return node.value ?? "";
  if (node.type !== "element" || isHidden(node)) return "";
  if (hasClass(node, "katex")) {
    const tex = findTex(node);
    if (tex !== undefined) return tex;
  }
  let label = "";
  for (const child of node.children ?? []) {
    const part = labelOf(child);
    if (part === null) return null;
    label += part;
  }
  return label;
}

function collect(node: HastNode, labels: Record<string, string>): void {
  for (const child of node.children ?? []) {
    const id = child.properties?.id;
    if (
      child.type === "element" &&
      HEADING_TAG.test(child.tagName ?? "") &&
      typeof id === "string"
    ) {
      const label = labelOf(child)?.replace(/\s+/g, " ").trim();
      if (label) labels[id] = label;
      continue; // headings don't nest
    }
    collect(child, labels);
  }
}

export default function rehypeTocLabels() {
  return (tree: HastNode, file: VFileLike) => {
    const labels: Record<string, string> = {};
    collect(tree, labels);
    file.data.astro ??= {};
    file.data.astro.frontmatter ??= {};
    file.data.astro.frontmatter.tocLabels = labels;
  };
}
