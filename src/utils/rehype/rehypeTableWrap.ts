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
 * Three kinds of table reach this plugin:
 * - pipe-syntax tables, as hast `table` elements;
 * - `<table>` written as JSX in an `.mdx` post, as an `mdxJsxFlowElement`;
 * - `<table>` written as raw HTML in a `.md` post. Astro only parses raw HTML
 *   (rehype-raw) after every user plugin has run, so here it is still an
 *   opaque `raw` string. The wrapper is spliced into that string instead: each
 *   `<table …>` gains an opening `<div>` and each `</table>` a closing one, so
 *   the pairs stay balanced even when blank lines split one table across
 *   several `raw` nodes.
 *
 * Tables written inside `<ResponsiveTable>` in MDX are left alone: that
 * component brings its own scroller, and a second one inside it would add a
 * second tab stop that never scrolls. The component is recognised by the
 * post's own default import of `ResponsiveTable.astro`, so it is found under
 * whatever local name the post gives it.
 *
 * The tree walk and the hast types are hand-rolled on purpose: this module is
 * pulled in by `astro.config.ts`, so it must not import packages that are only
 * present as transitive dependencies (`unist-util-visit`, `@types/hast`).
 */

/** The sliver of estree an MDX import statement carries. */
interface EstreeProgram {
  body?: {
    type: string;
    source?: { value?: unknown };
    specifiers?: { type: string; local?: { name?: string } }[];
  }[];
}

/** The sliver of hast (plus the MDX nodes) this plugin touches. */
interface HastNode {
  type: string;
  tagName?: string;
  /** Component name of an MDX JSX element, e.g. `ResponsiveTable`. */
  name?: string | null;
  /** Source of a `raw` HTML node. */
  value?: string;
  properties?: Record<string, unknown>;
  /** An `mdxjsEsm` node keeps its parsed statements in `data.estree`. */
  data?: unknown;
  children?: HastNode[];
}

const WRAPPER_CLASS = "table-wrap";

const RESPONSIVE_TABLE_SOURCE = /(?:^|\/)ResponsiveTable(?:\.astro)?$/;

/** `<table` followed by whitespace, `>` or `/`, so `<tablefoo>` stays put. */
const RAW_TABLE_OPEN = /<table(?=[\s/>])/gi;
const RAW_TABLE_CLOSE = /<\/table\s*>/gi;
const RAW_WRAPPER_OPEN = `<div class="${WRAPPER_CLASS}" tabindex="0">`;

/** Local names an MDX post binds `ResponsiveTable.astro`'s default export to. */
function responsiveTableNames(tree: HastNode): Set<string> {
  const names = new Set<string>();
  for (const node of tree.children ?? []) {
    if (node.type !== "mdxjsEsm") continue;
    const esm = node.data as { estree?: EstreeProgram | null } | undefined;
    for (const statement of esm?.estree?.body ?? []) {
      const source = statement.source?.value;
      if (
        statement.type !== "ImportDeclaration" ||
        typeof source !== "string" ||
        !RESPONSIVE_TABLE_SOURCE.test(source)
      ) {
        continue;
      }
      for (const specifier of statement.specifiers ?? []) {
        if (
          specifier.type === "ImportDefaultSpecifier" &&
          specifier.local?.name
        ) {
          names.add(specifier.local.name);
        }
      }
    }
  }
  return names;
}

function isTable(node: HastNode): boolean {
  return (
    (node.type === "element" && node.tagName === "table") ||
    (node.type === "mdxJsxFlowElement" && node.name === "table")
  );
}

function wrap(table: HastNode): HastNode {
  return {
    type: "element",
    tagName: "div",
    properties: { className: [WRAPPER_CLASS], tabIndex: 0 },
    children: [table],
  };
}

function wrapRaw(html: string): string {
  return html
    .replace(RAW_TABLE_OPEN, `${RAW_WRAPPER_OPEN}<table`)
    .replace(RAW_TABLE_CLOSE, "$&</div>");
}

export default function rehypeTableWrap() {
  return (tree: HastNode) => {
    const scrollers = responsiveTableNames(tree);

    /** Elements whose tables already scroll and must not be wrapped again. */
    const isScroller = (node: HastNode): boolean => {
      if (
        (node.type === "mdxJsxFlowElement" ||
          node.type === "mdxJsxTextElement") &&
        typeof node.name === "string" &&
        scrollers.has(node.name)
      ) {
        return true;
      }
      // Our own wrapper: keeps the element walk idempotent should it ever run
      // twice (raw HTML has no such guard; it is only ever spliced once).
      const className = node.properties?.className;
      return (
        node.type === "element" &&
        Array.isArray(className) &&
        className.includes(WRAPPER_CLASS)
      );
    };

    const walk = (node: HastNode): void => {
      if (!node.children || isScroller(node)) return;
      node.children = node.children.map(child => {
        if (child.type === "raw" && typeof child.value === "string") {
          return { ...child, value: wrapRaw(child.value) };
        }
        // Descend first, so a table nested in a cell gets its own wrapper too.
        walk(child);
        return isTable(child) ? wrap(child) : child;
      });
    };

    walk(tree);
  };
}
