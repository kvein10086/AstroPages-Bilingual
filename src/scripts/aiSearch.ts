/**
 * Client side of the optional semantic-search panel on /search: the Pagefind
 * input also queries a Cloudflare AI Search endpoint, and the posts it finds
 * are listed in a small panel between the input and the Pagefind results.
 *
 * Pagefind is never touched and always wins: any failure on the semantic side
 * (timeout, network, non-2xx, malformed JSON, no results) just hides the panel,
 * leaving the plain Pagefind page. Nothing is ever thrown or shown.
 *
 * The config comes from `#ai-search-config` (rendered by `AiSearch.astro` only
 * when an endpoint is set) and is re-read from the current document at query
 * time, because the Pagefind container — and the input the listeners hang off —
 * may be carried across View Transitions by `transition:persist`. Call
 * `initAiSearch` once per page (from `onPageReady`).
 */

interface AiSearchConfig {
  endpoint: string;
  /** Absolute URL of the locale's posts index, ending in "/". */
  prefix: string;
  /** Origin of `site.url`; results on any other origin are dropped. */
  origin: string;
  titleSuffix: string;
  timeoutMs: number;
  maxResults: number;
  matchThreshold: number;
  label: string;
  loading: string;
  note: string;
}

interface AiSearchResult {
  href: string;
  title: string;
  section: string;
  snippet: string;
}

const INPUT_SELECTOR = "#pagefind-search .pagefind-ui__search-input";
const PANEL_ID = "ai-search-panel";
/** Visually hidden live region, kept outside the (often hidden) panel. */
const LIVE_ID = "ai-search-live";
const DEBOUNCE_MS = 600;
const MIN_QUERY_CHARS = 2;
const SNIPPET_CHARS = 160;
const CACHE_LIMIT = 50;
/** Pagefind UI is created lazily; stop waiting for its input after this. */
const INPUT_WAIT_MS = 10_000;

const boundInputs = new WeakSet<HTMLInputElement>();
const cache = new Map<string, AiSearchResult[]>();
let inFlight: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let stopWaiting: (() => void) | null = null;

function readConfig(): AiSearchConfig | null {
  const el = document.getElementById("ai-search-config");
  const data = el?.dataset;
  if (!data?.endpoint || !data.prefix || !data.origin) return null;

  const num = (value: string | undefined, fallback: number) => {
    const n = Number(value);
    return value && Number.isFinite(n) ? n : fallback;
  };

  return {
    endpoint: data.endpoint,
    prefix: data.prefix,
    origin: data.origin,
    titleSuffix: data.titleSuffix ?? "",
    timeoutMs: num(data.timeoutMs, 5000),
    maxResults: Math.max(1, Math.floor(num(data.maxResults, 5))),
    matchThreshold: num(data.matchThreshold, 0.2),
    label: data.label ?? "",
    loading: data.loading ?? "",
    note: data.note ?? "",
  };
}

/* ------------------------------------------------------------------------ */
/* Response → results                                                        */
/* ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown) {
  return typeof value === "string" ? value : "";
}

/** The crawler prefixes a page's first chunk with a YAML-ish metadata block. */
function stripFrontMatter(md: string) {
  return md.replace(/^\s*---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
}

const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t#]*$/m;

/** Markdown inline syntax → plain text. */
function cleanInline(text: string) {
  return (
    text
      // Images become their alt text; a separator keeps neighbours apart.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_, alt: string) =>
        alt.trim() ? ` ${alt.trim()} · ` : " "
      )
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\[![\w-]+\][+-]?/g, " ") // callout markers
      .replace(/<\/?[a-z][^>]*>/gi, " ")
      .replace(/\bhttps?:\/\/\S+/g, " ")
      .replace(/\*\*|__|~~|[*`]/g, "")
      .replace(/(^|[\s(])_([^_\s][^_]*?)_(?=[\s).,;:!?]|$)/g, "$1$2")
  );
}

/** Drop fenced code blocks, so a `# comment` in one is never a heading. */
function stripFences(md: string) {
  return md
    .replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, " ")
    .replace(/^[ \t]*(`{3,}|~{3,})[\s\S]*$/m, " "); // unclosed, cut by chunking
}

function cleanBlock(md: string) {
  return cleanInline(
    stripFences(md)
      .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, " ") // rules
      .replace(/^[ \t]*\|?[ \t:-]+(\|[ \t:-]+)+\|?[ \t]*$/gm, " ") // separator rows of tables
      .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^[ \t]*(>[ \t]?)+/gm, "")
      .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+/gm, "")
      .replace(/\|/g, " ")
  );
}

function tidy(text: string) {
  return text
    .replace(/\s+/g, " ")
    .replace(/(\s*·\s*){2,}/g, " · ")
    .replace(/^[\s·]+|[\s·]+$/g, "");
}

/** Truncate on grapheme (or at least code point) boundaries. */
function truncate(text: string, max: number) {
  const parts =
    typeof Intl.Segmenter === "function"
      ? Array.from(new Intl.Segmenter().segment(text), s => s.segment)
      : Array.from(text);
  if (parts.length <= max) return text;
  return `${tidy(parts.slice(0, max).join(""))}…`;
}

function toResult(
  chunk: Record<string, unknown>,
  config: AiSearchConfig
): AiSearchResult | null {
  const item = isRecord(chunk.item) ? chunk.item : {};
  const metadata = isRecord(item.metadata) ? item.metadata : {};

  let url: URL;
  try {
    url = new URL(str(item.key));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.origin !== config.origin) return null;
  // Same-origin path, so dev / preview servers stay on their own origin. A
  // path like "//evil.example/x" would be protocol-relative once used as an
  // href, so collapse leading slashes and check the origin again.
  const local = new URL(
    url.pathname.replace(/^\/+/, "/") + url.search + url.hash,
    config.origin
  );
  if (local.origin !== config.origin) return null;
  const href = local.pathname + local.search + local.hash;

  let title = str(metadata.title).trim();
  if (config.titleSuffix && title.endsWith(config.titleSuffix)) {
    title = title.slice(0, -config.titleSuffix.length).trim();
  }
  if (!title) {
    try {
      title = decodeURIComponent(url.pathname);
    } catch {
      title = url.pathname;
    }
  }

  const prose = stripFences(stripFrontMatter(str(chunk.text)));
  const heading = prose.match(HEADING);
  const section = heading ? tidy(cleanInline(heading[1])) : "";
  // The first heading is shown as the section line, so leave it out here.
  const rest = heading ? prose.replace(HEADING, " ") : prose;
  const snippet =
    tidy(cleanBlock(rest)) || tidy(str(metadata.description)) || "";

  return {
    href,
    title,
    section,
    snippet: snippet ? truncate(snippet, SNIPPET_CHARS) : "",
  };
}

/** Keep the ranking, one entry per page (its best chunk), `maxResults` pages. */
function parseResults(data: unknown, config: AiSearchConfig) {
  if (!isRecord(data) || data.success === false || !isRecord(data.result)) {
    throw new Error("Unexpected AI Search response");
  }
  const chunks = Array.isArray(data.result.chunks) ? data.result.chunks : [];

  const results: AiSearchResult[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    if (results.length >= config.maxResults) break;
    if (!isRecord(chunk)) continue;
    const key = isRecord(chunk.item) ? str(chunk.item.key) : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const result = toResult(chunk, config);
    if (result) results.push(result);
  }
  return results;
}

/* ------------------------------------------------------------------------ */
/* Panel                                                                     */
/* ------------------------------------------------------------------------ */

function getPanel() {
  return document.getElementById(PANEL_ID);
}

function removePanel() {
  getPanel()?.remove();
  document.getElementById(LIVE_ID)?.remove();
}

let announceSeq = 0;

function announce(text: string) {
  const seq = ++announceSeq;
  const live = document.getElementById(LIVE_ID);
  if (!live) return;
  if (!text) {
    live.textContent = "";
    return;
  }
  // Set after the panel has been laid out, so the change is announced.
  requestAnimationFrame(() => {
    if (seq === announceSeq) live.textContent = text;
  });
}

function hidePanel() {
  const panel = getPanel();
  if (panel) panel.hidden = true;
  announce("");
}

function createLiveRegion() {
  const live = document.createElement("p");
  live.id = LIVE_ID;
  live.setAttribute("aria-live", "polite");
  return live;
}

/** Find or create the panel, right above the Pagefind results drawer. */
function ensurePanel(input: HTMLInputElement) {
  const existing = getPanel();
  if (existing) {
    if (!document.getElementById(LIVE_ID)) existing.after(createLiveRegion());
    return existing;
  }

  const panel = document.createElement("section");
  panel.id = PANEL_ID;
  panel.hidden = true;
  panel.setAttribute("aria-labelledby", `${PANEL_ID}-label`);

  const label = document.createElement("h2");
  label.id = `${PANEL_ID}-label`;
  label.className = "ai-search__label";

  // Visual only; screen readers hear the live region below instead.
  const status = document.createElement("p");
  status.className = "ai-search__status";
  status.setAttribute("aria-hidden", "true");

  const list = document.createElement("ol");
  list.className = "ai-search__results";

  const note = document.createElement("p");
  note.className = "ai-search__note";

  panel.append(label, status, list, note);

  document.getElementById(LIVE_ID)?.remove();

  const form = input.closest("form");
  const drawer = form?.querySelector(":scope > .pagefind-ui__drawer");
  if (form && drawer) form.insertBefore(panel, drawer);
  else if (form) form.append(panel);
  else document.getElementById("pagefind-search")?.after(panel);
  panel.after(createLiveRegion());

  return panel;
}

function panelParts(panel: HTMLElement) {
  return {
    label: panel.querySelector<HTMLElement>(".ai-search__label"),
    status: panel.querySelector<HTMLElement>(".ai-search__status"),
    list: panel.querySelector<HTMLElement>(".ai-search__results"),
    note: panel.querySelector<HTMLElement>(".ai-search__note"),
  };
}

function showLoading(panel: HTMLElement, config: AiSearchConfig) {
  const { label, status, list, note } = panelParts(panel);
  if (label) label.textContent = config.label;
  if (note) note.textContent = config.note;
  if (list && list.childElementCount > 0 && !panel.hidden) {
    // Keep the previous results (dimmed) instead of collapsing the panel.
    list.setAttribute("aria-busy", "true");
  } else {
    list?.replaceChildren();
    if (list) list.hidden = true;
    if (status) {
      status.hidden = false;
      status.textContent = config.loading;
    }
  }
  panel.hidden = false;
  announce(config.loading);
}

function showResults(
  panel: HTMLElement,
  config: AiSearchConfig,
  results: AiSearchResult[]
) {
  const { label, status, list, note } = panelParts(panel);
  if (!list) return;
  if (label) label.textContent = config.label;
  if (note) note.textContent = config.note;
  if (status) {
    status.textContent = "";
    status.hidden = true;
  }

  list.replaceChildren(
    ...results.map(result => {
      const li = document.createElement("li");
      li.className = "ai-search__result";

      const title = document.createElement("p");
      title.className = "ai-search__title";
      const link = document.createElement("a");
      link.href = result.href;
      link.textContent = result.title;
      title.append(link);
      li.append(title);

      if (result.section) {
        const section = document.createElement("p");
        section.className = "ai-search__section";
        section.textContent = result.section;
        li.append(section);
      }
      if (result.snippet) {
        const excerpt = document.createElement("p");
        excerpt.className = "ai-search__excerpt";
        excerpt.textContent = result.snippet;
        li.append(excerpt);
      }
      return li;
    })
  );
  list.removeAttribute("aria-busy");
  list.hidden = false;
  panel.hidden = false;
  announce(`${config.label}: ${results.length}`);
}

/* ------------------------------------------------------------------------ */
/* Querying                                                                  */
/* ------------------------------------------------------------------------ */

function cancelPending() {
  clearTimeout(debounceTimer);
  inFlight?.abort();
  inFlight = null;
}

function charCount(text: string) {
  return Array.from(text).length;
}

function cacheSet(key: string, results: AiSearchResult[]) {
  cache.delete(key);
  cache.set(key, results);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

async function search(input: HTMLInputElement) {
  cancelPending();

  const config = readConfig();
  if (!config) {
    removePanel();
    return;
  }

  const query = input.value.trim();
  if (charCount(query) < MIN_QUERY_CHARS) {
    hidePanel();
    return;
  }

  const key = `${config.prefix}\n${query}`;
  const cached = cache.get(key);
  if (cached) {
    if (cached.length) showResults(ensurePanel(input), config, cached);
    else hidePanel();
    return;
  }

  const controller = new AbortController();
  inFlight = controller;
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  showLoading(ensurePanel(input), config);

  // The folder range [prefix, prefix-with-"/"-bumped-to-"0") is a starts-with
  // match on the page URL: only this locale's posts.
  const prefixUpper = `${config.prefix.slice(0, -1)}0`;

  try {
    const response = await fetch(`${config.endpoint}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      signal: controller.signal,
      body: JSON.stringify({
        query,
        ai_search_options: {
          retrieval: {
            retrieval_type: "vector",
            max_num_results: Math.min(50, config.maxResults * 4),
            match_threshold: config.matchThreshold,
            filters: {
              folder: { $gte: config.prefix, $lt: prefixUpper },
            },
          },
        },
      }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const results = parseResults(await response.json(), config);
    cacheSet(key, results);

    // A newer query (or page) has taken over; let it own the panel.
    if (
      inFlight !== controller ||
      input.value.trim() !== query ||
      readConfig()?.prefix !== config.prefix
    ) {
      return;
    }
    if (results.length) showResults(ensurePanel(input), config, results);
    else hidePanel();
  } catch {
    if (inFlight === controller) hidePanel();
  } finally {
    clearTimeout(timer);
    if (inFlight === controller) inFlight = null;
  }
}

function schedule(input: HTMLInputElement, delay: number) {
  clearTimeout(debounceTimer);
  // Too short: drop what is on screen now rather than after the debounce.
  if (charCount(input.value.trim()) < MIN_QUERY_CHARS) {
    inFlight?.abort();
    inFlight = null;
    hidePanel();
    return;
  }
  debounceTimer = setTimeout(() => void search(input), delay);
}

/** Pagefind's form outlives page swaps, so listeners are bound only once. */
function bindInput(input: HTMLInputElement) {
  if (boundInputs.has(input)) return;
  boundInputs.add(input);

  input.addEventListener("input", event => {
    // Wait for the IME to commit; `compositionend` schedules the query.
    if ((event as InputEvent).isComposing) return;
    schedule(input, DEBOUNCE_MS);
  });
  input.addEventListener("compositionend", () => schedule(input, DEBOUNCE_MS));
  input.addEventListener("keydown", event => {
    if (event.isComposing) return;
    // Pagefind clears the value itself on Escape; read it after it has.
    if (event.key === "Enter" || event.key === "Escape") schedule(input, 0);
  });
  // The clear button empties the value without an `input` event.
  input
    .closest("form")
    ?.querySelector(".pagefind-ui__search-clear")
    ?.addEventListener("click", () => schedule(input, 0));
}

/** Call `callback` with the Pagefind input once it exists (it is lazy). */
function waitForInput(callback: (input: HTMLInputElement) => void) {
  const found = document.querySelector<HTMLInputElement>(INPUT_SELECTOR);
  if (found) {
    callback(found);
    return;
  }

  const root = document.getElementById("pagefind-search");
  if (!root) return;

  const observer = new MutationObserver(() => {
    const input = document.querySelector<HTMLInputElement>(INPUT_SELECTOR);
    if (!input) return;
    stop();
    callback(input);
  });
  const timer = setTimeout(() => stop(), INPUT_WAIT_MS);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
    if (stopWaiting === stop) stopWaiting = null;
  };
  stopWaiting = stop;
  observer.observe(root, { childList: true, subtree: true });
}

export function initAiSearch() {
  stopWaiting?.();
  cancelPending();

  if (!readConfig()) {
    // A panel may survive inside the persisted Pagefind container.
    removePanel();
    return;
  }

  waitForInput(input => {
    bindInput(input);
    // Pagefind restores `?q=` through a deferred update, so the value may not
    // be there yet; a macrotask later it is. A carried-over input (page swap,
    // language switch) is re-queried against the current config as well.
    setTimeout(() => void search(input), 0);
  });
}
