// ============================================================================
// SpotLight — Cross-browser WebExtension API adapter
// Chrome, Edge, Brave, Opera GX, Firefox, and Safari Web Extensions all
// expose either `chrome` or `browser`. Prefer `chrome` (callback + promise
// compatible) and fall back to `browser`.
// ============================================================================

type ExtensionAPI = typeof chrome;

const root = globalThis as typeof globalThis & {
  chrome?: ExtensionAPI;
  browser?: ExtensionAPI;
};

export const ext: ExtensionAPI = (root.chrome ?? root.browser) as ExtensionAPI;

export function hasSidePanel(): boolean {
  return typeof ext?.sidePanel?.setPanelBehavior === "function";
}

export function hasDeclarativeNetRequest(): boolean {
  return typeof ext?.declarativeNetRequest?.updateSessionRules === "function";
}

export function hasSessionStorage(): boolean {
  return typeof ext?.storage?.session?.set === "function";
}

/** Opera GX and Firefox cannot dock Chrome's right-hand side panel. */
export function prefersToolbarPopup(): boolean {
  const g = globalThis as typeof globalThis & { opr?: unknown; opera?: unknown };
  if (g.opr || g.opera) return true;
  const ua = globalThis.navigator?.userAgent ?? "";
  return /OPR\/|Opera|Firefox\//.test(ua);
}

/** Swallow runtime.lastError so Firefox/Safari don't treat unused errors as crashes. */
export function consumeLastError(): void {
  void ext?.runtime?.lastError;
}

export function sendMessage(
  message: unknown,
  callback?: (response: any) => void
): void {
  try {
    if (!ext?.runtime?.sendMessage) return;
    ext.runtime.sendMessage(message, (response) => {
      consumeLastError();
      callback?.(response);
    });
  } catch {
    // Extension context invalidated (tab closed, reload, etc.)
  }
}

export const BLOCK_RESOURCE_TYPES = [
  "xmlhttprequest",
  "script",
  "image",
  "sub_frame",
  "stylesheet",
  "font",
  "media",
  "ping",
  "other",
] as chrome.declarativeNetRequest.ResourceType[];
