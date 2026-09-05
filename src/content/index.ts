// ============================================================================
// BeaconLight — Content Script (index.ts)
// Runs at document_start in the ISOLATED content script world.
// Responsibilities:
//   1. Inject inject.ts into the page context (MAIN world)
//   2. Relay window.postMessage from inject.ts → chrome.runtime.sendMessage
//   3. Listen for spoofing toggle messages from background
// ============================================================================

import { ext, sendMessage } from "../browserApi";

const BEACONLIGHT_MSG_SOURCE = "__beaconlight_inject__";

/**
 * Inject the inject.ts bundle into the page's MAIN world.
 * The script is loaded from web_accessible_resources so it runs with
 * full access to the page's window, fetch, XHR, navigator, etc.
 *
 * If spoofing is enabled for this tab, we set a global flag BEFORE
 * injecting the script so the spoofing code activates immediately.
 */
function injectPageScript(spoofEnabled: boolean) {
  // First, set the spoof flag in the page context if needed
  if (spoofEnabled) {
    const flagScript = document.createElement("script");
    flagScript.textContent = `window.__beaconlightSpoofEnabled = true;`;
    (document.documentElement || document.head || document.body).prepend(
      flagScript
    );
    flagScript.remove();
  }

  // Then inject the main bundle
  const script = document.createElement("script");
  script.src = ext.runtime.getURL("assets/inject.js");
  script.type = "text/javascript";
  script.onload = () => script.remove(); // Clean up DOM after execution
  (document.documentElement || document.head || document.body).prepend(script);
}

/**
 * Listen for messages from the injected page-context script.
 * Only forwards messages that originate from our inject.ts (verified by source field).
 */
window.addEventListener("message", (event) => {
  // Only accept messages from our own window (same origin)
  if (event.source !== window) return;
  if (!event.data || event.data.source !== BEACONLIGHT_MSG_SOURCE) return;

  if (event.data.type === "OBSERVED_REQUEST") {
    // Relay the observed request to the background service worker
    sendMessage({
      type: "OBSERVED_REQUEST",
      payload: event.data.payload,
    });
  }
});

/**
 * Listen for messages from the background service worker.
 * Currently handles spoofing toggle for live enable/disable.
 */
ext.runtime.onMessage.addListener((message) => {
  if (message.type === "SPOOF_TOGGLE") {
    // For live toggle, we need to reload the page so the spoof flag
    // is set before inject.ts runs. This is a known MV3 limitation —
    // overrides must be applied before the page's scripts execute.
    // Assumption: For the hackathon demo, we store the state and apply
    // on next page load rather than forcing a reload.
    // The background will persist the spoof state per tab.
  }
});

/**
 * On initialization, check if the extension is master active and if spoofing is enabled
 * for this tab, then inject the page-context script accordingly.
 */
sendMessage({ type: "GET_MASTER_ACTIVE" }, (masterResponse) => {
  if (masterResponse?.active === false) {
    return; // Do not inject if the extension is paused
  }

  sendMessage({ type: "GET_SPOOF_STATE" }, (response) => {
    const spoofEnabled = response?.enabled ?? false;
    injectPageScript(spoofEnabled);
  });
});
