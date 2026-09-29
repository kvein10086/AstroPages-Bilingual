/**
 * Give every markdown table its own horizontal scroller.
 *
 * Remark emits a bare `<table>` straight into the article column. A table's
 * minimum width is the sum of its columns' longest unbreakable runs, so a
 * four-column comparison or one cell holding `torch.nn.Linear(d_in, 3*d_out)`
 * easily outgrows a 390px phone. With nothing to contain it, the table
 * widens the whole page: the reader can drag the layout sideways, iOS zooms
 * the page out, and the fixed back-to-top button slides off screen. Wrapping
 * the table in `<div class="table-wrap">` (which scrolls on its own — see
 * `typography.css`) keeps the overflow inside the table's box.
 *
 * The wrapper is a plain `<div>` rather than `display: block` on the table
 * itself, which would cost the table its semantics in Safari/VoiceOver.
 * `tabindex="0"` lets keyboard users focus it and scroll with the arrow keys,
 * as Shiki already does for `<pre>`. It deliberately gets no
 * `role="region"`: a region without an accessible name isn't exposed as one,
 * and the table already announces itself.
 *
 * Tables written inside `<ResponsiveTable>` in MDX are left alone: that
 * component brings its own scroller, and a second one inside it would add a
 * second tab stop that never scrolls. The check is by the JSX element's name,
 * so it only holds while the component is imported under that name.
 *
 * The tree walk and the hast types are hand-rolled on purpose: this module is
 * pulled in by `astro.config.ts`, so it must not import packages that are only
 * present as transitive dependencies (`unist-util-visit`, `@types/hast`).
 */

/** The sliver of hast (plus the MDX JSX node) this plugin touches. */
interface HastNode {
  type: string;
  tagName?: string;
  /** Component name of an MDX JSX element, e.g. `ResponsiveTable`. */
  name?: string | null;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

const WRAPPER_CLASS = "table-wrap";

/** Elements whose tables already scroll and must not be wrapped again. */
function isScroller(node: HastNode): boolean {
  if (
    (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") &&
    node.name === "ResponsiveTable"
  ) {
    return true;
  }
  // Our own wrapper: keeps the plugin idempotent should it ever run twice.
  const className = node.properties?.className;
  return (
    node.type === "element" &&
    Array.isArray(className) &&
    className.includes(WRAPPER_CLASS)
  );
}

function walk(node: HastNode): void {
  if (!node.children || isScroller(node)) return;
  node.children = node.children.map(child => {
    // Descend first, so a table nested in a cell gets its own wrapper too.
    walk(child);
    if (child.type !== "element" || child.tagName !== "table") return child;
    return {
      type: "element",
      tagName: "div",
      properties: { className: [WRAPPER_CLASS], tabIndex: 0 },
      children: [child],
    };
  });
}

export default function rehypeTableWrap() {
  return (tree: HastNode) => walk(tree);
}
