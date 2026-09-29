/**
 * Mark paragraphs that are emphasis from end to end.
 *
 * Chinese emphasis is drawn as dots under each character (`:lang(zh) em` in
 * `typography.css`). That suits a few words inside a sentence, but a whole
 * `*…*` paragraph — the usual way to write a figure caption under an image —
 * would get a dot under every character of several lines. CSS can't tell
 * such a paragraph from one that only contains some emphasis (selectors
 * don't see text nodes), so this plugin adds `class="emphasis-paragraph"` to
 * every `<p>` whose only non-whitespace content is a single `<em>`, and the
 * stylesheet sets those in a quieter style instead.
 *
 * Only markdown emphasis is seen: raw HTML in a `.md` post is still an opaque
 * string at this stage, and JSX in MDX is an `mdxJsx*` node.
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

const EMPHASIS_PARAGRAPH_CLASS = "emphasis-paragraph";

const isElement = (node: HastNode, tagName: string) =>
  node.type === "element" && node.tagName === tagName;

function isWholeEmphasis(paragraph: HastNode): boolean {
  const content = (paragraph.children ?? []).filter(
    child => !(child.type === "text" && !child.value?.trim())
  );
  return content.length === 1 && isElement(content[0], "em");
}

function addClass(node: HastNode, className: string): void {
  const properties = (node.properties ??= {});
  const current = properties.className;
  const list = Array.isArray(current)
    ? current
    : typeof current === "string"
      ? current.split(/\s+/).filter(Boolean)
      : [];
  if (!list.includes(className)) properties.className = [...list, className];
}

export default function rehypeEmphasisParagraph() {
  return (tree: HastNode) => {
    const walk = (node: HastNode): void => {
      for (const child of node.children ?? []) {
        if (isElement(child, "p")) {
          if (isWholeEmphasis(child)) addClass(child, EMPHASIS_PARAGRAPH_CLASS);
          // A paragraph holds only phrasing content: no nested <p> to find.
          continue;
        }
        walk(child);
      }
    };
    walk(tree);
  };
}
