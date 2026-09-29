/**
 * The "copy link" button at the start of a post's share row
 * (src/pages/posts/[...slug]/_components/ShareLinks.astro).
 *
 * Where the browser has a system share sheet the button opens it instead —
 * on a phone that is where WeChat, Messages and friends live, none of which
 * has a share URL — and it says so in its label and icon. A dismissed sheet
 * is not an error; a sheet that fails for any other reason falls back to
 * copying. The copied/failed result is shown in the button's icon and in a
 * `role="status"` line, so it is both seen and announced.
 */

/** How long the copied/failed feedback stays up. */
const FEEDBACK_MS = 2000;

/** Cleanup for the page instance currently wired up. */
let teardown: (() => void) | null = null;

export function initShareLink() {
  teardown?.();
  teardown = null;

  const button = document.querySelector<HTMLButtonElement>(
    "button[data-share-link]"
  );
  const status = document.querySelector<HTMLElement>("[data-share-status]");
  const label = button?.querySelector<HTMLElement>("[data-share-link-label]");
  if (!button || !status || !label) return;

  const {
    url = location.href,
    title = document.title,
    labelShare = "",
    labelCopied = "",
    labelFailed = "",
  } = button.dataset;

  const controller = new AbortController();
  let resetTimer = 0;
  teardown = () => {
    controller.abort();
    window.clearTimeout(resetTimer);
  };
  document.addEventListener("astro:before-swap", () => teardown?.(), {
    once: true,
    signal: controller.signal,
  });

  const shareData: ShareData = { url, title };
  const canShare =
    typeof navigator.share === "function" &&
    (navigator.canShare?.(shareData) ?? true);

  // Which icon shows (ShareLinks.astro): one value, so no two can clash.
  const restingIcon = canShare ? "share" : "link";
  button.dataset.icon = restingIcon;
  if (canShare) {
    button.title = labelShare;
    label.textContent = labelShare;
  }
  button.hidden = false;

  function feedback(state: "copied" | "failed") {
    window.clearTimeout(resetTimer);
    button!.dataset.state = state;
    button!.dataset.icon = state === "copied" ? "check" : restingIcon;
    // Clear first so a second copy in a row is announced again.
    status!.textContent = "";
    requestAnimationFrame(() => {
      status!.textContent = state === "copied" ? labelCopied : labelFailed;
    });
    resetTimer = window.setTimeout(() => {
      delete button!.dataset.state;
      button!.dataset.icon = restingIcon;
      status!.textContent = "";
    }, FEEDBACK_MS);
  }

  async function copy() {
    try {
      // Throws where the Clipboard API is missing (an insecure origin) or
      // denied; either way the reader is told to copy it themselves.
      await navigator.clipboard.writeText(url);
      feedback("copied");
    } catch {
      feedback("failed");
    }
  }

  button.addEventListener(
    "click",
    async () => {
      if (canShare) {
        try {
          await navigator.share(shareData);
          return;
        } catch (error) {
          // The reader closed the sheet: nothing to report.
          if (error instanceof DOMException && error.name === "AbortError") {
            return;
          }
        }
      }
      await copy();
    },
    { signal: controller.signal }
  );
}
