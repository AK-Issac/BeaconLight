// ============================================================================
// SpotLight — Background Service Worker (src/background/index.ts)
// Single service worker file handling:
//   - webRequest observation
//   - Two-Tier classification engine
//   - DeclarativeNetRequest auto-blocking (Tier 1) and manual blocking (Tier 2)
//   - Message routing between popup, content scripts, and storage
//   - Port-based live updates to the popup
// ============================================================================

import type {
  RequestLog,
  Category,
  Severity,
  Tier,
  TabSpoofState,
  RequestOverrideAction,
} from "../types";
import {
  KNOWN_TRACKER_DOMAINS,
  HEURISTIC_PATTERNS,
  CATEGORY_DESCRIPTIONS,
  SPOOFABLE_CATEGORIES,
  MAX_BODY_PREVIEW_LENGTH,
} from "../constants";
import {
  ext,
  hasSidePanel,
  hasDeclarativeNetRequest,
  hasSessionStorage,
  prefersToolbarPopup,
  BLOCK_RESOURCE_TYPES,
} from "../browserApi";

// ============================================================================
// State
// ============================================================================

/** Per-tab spoofing state (in-memory, lost on SW restart — acceptable for demo) */
const tabSpoofState: TabSpoofState = {};

/** Per-tab, per-request allow/block overrides for manual request-level decisions */
const requestOverrideState: Map<number, Map<string, RequestOverrideAction>> = new Map();

/** Master extension active state */
let isMasterActive = true;

/** Connected popup ports for live updates */
const connectedPorts: Map<number, chrome.runtime.Port> = new Map();

/** In-memory tab logs (mirrored to chrome.storage.session) */
const tabLogs: Map<number, RequestLog[]> = new Map();

/** Rule ID counter for dynamic DNR rules (starts above the auto-block range) */
let nextDynamicRuleId = 10000;

// ============================================================================
// Utility: Extract domain from URL
// ============================================================================
function extractDomain(url: string): string {
  let hostname = url;
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Fallback for malformed URLs
    const match = url.match(/^(?:https?:\/\/)?([^/:\?#]+)/);
    if (match) hostname = match[1];
  }

  const parts = hostname.split('.');
  if (parts.length <= 2) return hostname;

  const secondLevel = parts[parts.length - 2];
  if (['co', 'com', 'org', 'net', 'edu', 'gov', 'mil', 'ac'].includes(secondLevel)) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}

// ============================================================================
// Utility: Generate unique ID
// ============================================================================
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ============================================================================
// Two-Tier Classification Engine (Section 6.2)
// ============================================================================

/**
 * Check if a domain matches any known tracker domain (Tier 1).
 * Uses suffix matching so subdomains like "ssl.google-analytics.com" are caught.
 */
function isKnownTracker(domain: string): boolean {
  const lowerDomain = domain.toLowerCase();
  return KNOWN_TRACKER_DOMAINS.some(
    (tracker) =>
      lowerDomain === tracker || lowerDomain.endsWith(`.${tracker}`)
  );
}

/**
 * Run heuristic classification on URL and body content (Tier 2).
 * Returns the first matching category, or null if no heuristic fires.
 */
function classifyHeuristic(url: string, bodyPreview: string | null): Category {
  const combinedText = `${url} ${bodyPreview || ""}`;

  for (const [category, patterns] of Object.entries(HEURISTIC_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(combinedText)) {
        return category as Category;
      }
    }
  }
  return null;
}

/**
 * High-confidence scanner for GET requests without a body.
 * Prevents log pollution while reliably catching extension probing & query trackers.
 */
function classifyStrictGet(url: string): Category {
  // 1. Extension probing (e.g. BrowserGate attacks probing for installed extensions)
  if (
    url.startsWith("chrome-extension://") ||
    url.startsWith("moz-extension://") ||
    /installed[_-]?extensions|addon[_-]?detect|plugin[_-]?detect/i.test(url)
  ) {
    return "extension-probe";
  }

  // 2. Query string parameters carrying location or PII
  const qIndex = url.indexOf("?");
  if (qIndex !== -1) {
    const query = url.slice(qIndex + 1);
    if (/(?:^|[&?])(lat|lng|latitude|longitude|geo_loc|ip_location)=/i.test(query)) {
      return "location";
    }
    if (/(?:^|[&?])(email|phone|first_name|last_name|ssn)=/i.test(query)) {
      return "pii";
    }
  }

  // 3. Explicit fingerprint collection endpoints
  if (/(?:canvas|webgl|audiocontext)[_-]?(fingerprint|fp|detect|collect)/i.test(url) || /toDataURL/i.test(url)) {
    return "fingerprinting";
  }

  return null;
}

/**
 * Full classification: returns { category, severity, tier, spoofable, plainDescription }
 */
function classifyRequest(
  url: string,
  domain: string,
  bodyPreview: string | null,
  method: string
): {
  category: Category;
  severity: Severity;
  tier: Tier;
  spoofable: boolean;
  plainDescription: string;
  isAutoBlocked: boolean;
} {
  // Tier 1: Known tracker domain
  if (isKnownTracker(domain)) {
    return {
      category: "known-tracker",
      severity: "flagged",
      tier: 1,
      spoofable: false,
      plainDescription: CATEGORY_DESCRIPTIONS["known-tracker"],
      isAutoBlocked: true,
    };
  }

  // Reduce False Positives: Skip standard static asset files
  const isAsset = /\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ico)$/i.test(url.split('?')[0]);
  if (isAsset) {
    return {
      category: null,
      severity: "neutral",
      tier: 2,
      spoofable: false,
      plainDescription: "Standard request — static asset.",
      isAutoBlocked: false,
    };
  }

  const isPostOrPut = method.toUpperCase() === "POST" || method.toUpperCase() === "PUT";
  const hasPayload = bodyPreview !== null && bodyPreview.trim().length > 0;

  // Tier 2: Run full heuristics on POST/PUT or requests with a payload;
  // use strict high-confidence scanning on GET requests.
  const heuristicCategory = (isPostOrPut || hasPayload)
    ? classifyHeuristic(url, bodyPreview)
    : classifyStrictGet(url);

  if (heuristicCategory) {
    return {
      category: heuristicCategory,
      severity: "flagged",
      tier: 2,
      spoofable: SPOOFABLE_CATEGORIES.has(heuristicCategory),
      plainDescription:
        CATEGORY_DESCRIPTIONS[heuristicCategory] ||
        "Suspicious tracking behavior detected.",
      isAutoBlocked: false,
    };
  }

  // Neutral: no classification match
  return {
    category: null,
    severity: "neutral",
    tier: 2,
    spoofable: false,
    plainDescription: "Standard request — no tracking indicators detected.",
    isAutoBlocked: false,
  };
}

// ============================================================================
// DeclarativeNetRequest: Auto-block Known Trackers (Section 6.3)
// ============================================================================

/**
 * On install/startup, apply DNR block rules for all KNOWN_TRACKER_DOMAINS.
 * Uses session-scoped rules so they don't persist across browser restarts
 * (demo-safe behavior — user starts fresh each session).
 */
async function applyAutoBlockRules() {
  if (!hasDeclarativeNetRequest()) {
    console.warn(
      "[SpotLight] declarativeNetRequest is unavailable — observation still works, auto-block does not."
    );
    return;
  }

  const rules: chrome.declarativeNetRequest.Rule[] =
    KNOWN_TRACKER_DOMAINS.map((domain, index) => ({
      id: index + 1, // Rule IDs 1..N for auto-block
      priority: 1,
      action: {
        type: "block" as chrome.declarativeNetRequest.RuleActionType,
      },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: BLOCK_RESOURCE_TYPES,
      },
    }));

  try {
    // Remove any existing session rules first
    const existingRules = await ext.declarativeNetRequest.getSessionRules();
    const removeIds = existingRules
      .filter((r) => r.id < 10000) // Only remove auto-block rules (< 10000)
      .map((r) => r.id);

    await ext.declarativeNetRequest.updateSessionRules({
      removeRuleIds: removeIds,
      addRules: rules,
    });
    console.log(
      `[SpotLight] Auto-block rules applied for ${rules.length} known tracker domains.`
    );
  } catch (err) {
    console.error("[SpotLight] Failed to apply auto-block rules:", err);
  }
}

/**
 * Manually block a domain via dynamic DNR rules (Tier 2 manual blocking).
 */
async function blockDomain(domain: string) {
  const ruleId = nextDynamicRuleId++;
  const rule: chrome.declarativeNetRequest.Rule = {
    id: ruleId,
    priority: 2,
    action: {
      type: "block" as chrome.declarativeNetRequest.RuleActionType,
    },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: BLOCK_RESOURCE_TYPES,
    },
  };

  try {
    if (hasDeclarativeNetRequest()) {
      await ext.declarativeNetRequest.updateDynamicRules({
        addRules: [rule],
      });
    }

    // Persist to chrome.storage.local
    const stored = await ext.storage.local.get("blockedDomains");
    const blockedDomains: string[] = stored.blockedDomains || [];
    if (!blockedDomains.includes(domain)) {
      blockedDomains.push(domain);
      await ext.storage.local.set({ blockedDomains });
    }

    // Update in-memory logs to reflect blocked state
    for (const [, logs] of tabLogs) {
      for (const log of logs) {
        if (log.domain === domain) {
          log.isBlocked = true;
        }
      }
    }

    console.log(`[SpotLight] Manually blocked domain: ${domain}`);
  } catch (err) {
    console.error(`[SpotLight] Failed to block domain ${domain}:`, err);
  }
}

/**
 * Unblock a previously manually blocked domain.
 */
async function unblockDomain(domain: string) {
  try {
    if (hasDeclarativeNetRequest()) {
      const dynamicRules = await ext.declarativeNetRequest.getDynamicRules();
      const ruleToRemove = dynamicRules.find(
        (r) => r.condition.urlFilter === `||${domain}`
      );
      if (ruleToRemove) {
        await ext.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [ruleToRemove.id],
        });
      }
    }

    // Remove from chrome.storage.local
    const stored = await ext.storage.local.get("blockedDomains");
    const blockedDomains: string[] = (stored.blockedDomains || []).filter(
      (d: string) => d !== domain
    );
    await ext.storage.local.set({ blockedDomains });

    // Update in-memory logs
    for (const [, logs] of tabLogs) {
      for (const log of logs) {
        if (log.domain === domain) {
          log.isBlocked = false;
        }
      }
    }

    console.log(`[SpotLight] Unblocked domain: ${domain}`);
  } catch (err) {
    console.error(`[SpotLight] Failed to unblock domain ${domain}:`, err);
  }
}

// ============================================================================
// Request Logging
// ============================================================================

/**
 * Process and log an observed request (from webRequest or content script relay).
 */
async function processRequest(
  url: string,
  method: string,
  bodyPreview: string | null,
  tabId: number
) {
  if (!isMasterActive) return;
  if (tabId < 0) return; // Ignore requests without a valid tab

  const domain = extractDomain(url);
  const classification = classifyRequest(url, domain, bodyPreview, method);

  let partyContext: "1st-party" | "3rd-party" = "3rd-party";
  try {
    const tab = await ext.tabs.get(tabId);
    if (tab.url) {
      const tabDomain = extractDomain(tab.url);
      partyContext = tabDomain === domain ? "1st-party" : "3rd-party";
    }
  } catch {
    // Tab might be gone
  }

  //if (partyContext === "1st-party" && classification.severity === "flagged") {
  //  classification.severity = "neutral";
  //}

  // Check if this domain was manually blocked
  const stored = await ext.storage.local.get("blockedDomains");
  const manuallyBlocked: string[] = stored.blockedDomains || [];
  const isManuallyBlocked = manuallyBlocked.includes(domain);

  const overrideAction = requestOverrideState.get(tabId)?.get(url) ?? null;
  const isOverrideBlocked = overrideAction === "block";

  const log: RequestLog = {
    id: generateId(),
    url,
    domain,
    timestamp: Date.now(),
    severity: classification.severity,
    category: classification.category,
    plainDescription: classification.plainDescription,
    bodyPreview: bodyPreview?.slice(0, MAX_BODY_PREVIEW_LENGTH) || null,
    isBlocked: classification.isAutoBlocked || isManuallyBlocked || isOverrideBlocked,
    isAutoBlocked: classification.isAutoBlocked,
    isSpoofed: tabSpoofState[tabId] === true && classification.spoofable,
    spoofable: classification.spoofable,
    overrideAction,
    tier: classification.tier,
    method,
    tabId,
    partyContext,
  };

  // Store in-memory
  if (!tabLogs.has(tabId)) {
    tabLogs.set(tabId, []);
  }
  const logs = tabLogs.get(tabId)!;
  logs.push(log);

  // Keep only the last 500 entries per tab to avoid memory issues
  if (logs.length > 500) {
    logs.splice(0, logs.length - 500);
  }

  // Persist to chrome.storage.session when the browser supports it
  if (hasSessionStorage()) {
    try {
      await ext.storage.session.set({ [`tabLog_${tabId}`]: logs });
    } catch {
      // Storage quota exceeded — acceptable for demo
    }
  }

  // Push live update to connected popup
  const port = connectedPorts.get(tabId);
  if (port) {
    try {
      port.postMessage({ type: "LIVE_UPDATE", payload: { log } });
    } catch {
      // Port may have disconnected
      connectedPorts.delete(tabId);
    }
  }
}

// ============================================================================
// webRequest Observation (Section 6.1)
// ============================================================================
ext.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Use webRequest for URL-level observation. Body content comes from
    // the content script patch (inject.ts), so bodyPreview is null here.
    processRequest(details.url, details.method || "GET", null, details.tabId);
  },
  { urls: ["<all_urls>"] }
);

// ============================================================================
// Message Routing
// ============================================================================
ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id;

  switch (message.type) {
    case "OBSERVED_REQUEST": {
      // Relayed from content script (inject.ts → content/index.ts → here)
      if (tabId !== undefined && tabId >= 0) {
        processRequest(
          message.payload.url,
          message.payload.method,
          message.payload.bodyPreview,
          tabId
        );
      }
      break;
    }

    case "GET_TAB_LOG": {
      const requestedTabId = message.payload.tabId;
      let logs = tabLogs.get(requestedTabId);

      // If in-memory is empty (e.g. SW woke from sleep), check storage.session
      if (!logs && hasSessionStorage()) {
        ext.storage.session.get(`tabLog_${requestedTabId}`).then((stored) => {
          const restoredLogs = (stored[`tabLog_${requestedTabId}`] as RequestLog[]) || [];
          tabLogs.set(requestedTabId, restoredLogs);
          sendResponse({ type: "TAB_LOG_RESPONSE", payload: { logs: restoredLogs } });
        });
        return true; // async
      }

      sendResponse({ type: "TAB_LOG_RESPONSE", payload: { logs: logs || [] } });
      return true;
    }

    case "BLOCK_DOMAIN": {
      blockDomain(message.payload.domain);
      sendResponse({ success: true });
      return true;
    }

    case "SET_REQUEST_OVERRIDE": {
      const { tabId: requestTabId, requestId, action } = message.payload;
      if (!requestTabId || !requestId) {
        sendResponse({ success: false });
        return true;
      }

      const tabOverrides = requestOverrideState.get(requestTabId) ?? new Map<string, RequestOverrideAction>();
      requestOverrideState.set(requestTabId, tabOverrides);

      const matchingLog = tabLogs.get(requestTabId)?.find((log) => log.id === requestId);
      if (matchingLog) {
        tabOverrides.set(matchingLog.url, action);
        matchingLog.overrideAction = action;
        matchingLog.isBlocked = action === "block";
      }

      sendResponse({ success: true, action });
      return true;
    }

    case "UNBLOCK_DOMAIN": {
      unblockDomain(message.payload.domain);
      sendResponse({ success: true });
      return true;
    }

    case "ENABLE_SPOOF": {
      const spoofTabId = message.payload.tabId;
      tabSpoofState[spoofTabId] = true;

      // Notify the content script to enable spoofing on next load
      ext.tabs.sendMessage(spoofTabId, {
        type: "SPOOF_TOGGLE",
        payload: { enabled: true },
      });

      // Update all existing logs for this tab
      const spoofLogs = tabLogs.get(spoofTabId);
      if (spoofLogs) {
        for (const log of spoofLogs) {
          if (log.spoofable) {
            log.isSpoofed = true;
          }
        }
      }

      sendResponse({ success: true });
      return true;
    }

    case "DISABLE_SPOOF": {
      const disableSpoofTabId = message.payload.tabId;
      tabSpoofState[disableSpoofTabId] = false;

      ext.tabs.sendMessage(disableSpoofTabId, {
        type: "SPOOF_TOGGLE",
        payload: { enabled: false },
      });

      const disableSpoofLogs = tabLogs.get(disableSpoofTabId);
      if (disableSpoofLogs) {
        for (const log of disableSpoofLogs) {
          log.isSpoofed = false;
        }
      }

      sendResponse({ success: true });
      return true;
    }

    case "GET_SPOOF_STATE": {
      // Content script asks if spoofing is enabled for its tab
      const spoofStateTabId = tabId ?? -1;
      sendResponse({ enabled: tabSpoofState[spoofStateTabId] === true });
      return true;
    }

    case "GET_MASTER_ACTIVE": {
      sendResponse({ active: isMasterActive });
      return true;
    }

    case "SET_MASTER_ACTIVE": {
      isMasterActive = message.payload.active;
      ext.storage.local.set({ masterActive: isMasterActive });
      sendResponse({ success: true });
      return true;
    }
  }
});

// ============================================================================
// Port-based Live Updates (Popup ↔ Background)
// ============================================================================
ext.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith("spotlight-popup-")) {
    const portTabId = parseInt(port.name.replace("spotlight-popup-", ""), 10);
    if (!isNaN(portTabId)) {
      connectedPorts.set(portTabId, port);

      port.onDisconnect.addListener(() => {
        connectedPorts.delete(portTabId);
      });
    }
  }
});

// ============================================================================
// Lifecycle: Install & Startup
// ============================================================================
async function setupSidePanelBehavior() {
  try {
    if (prefersToolbarPopup()) {
      // Opera GX / Firefox: Chrome's sidePanel.open() opens a new tab instead
      // of a docked panel. Keep the toolbar popup.
      if (ext.action?.setPopup) {
        await ext.action.setPopup({ popup: "index.html" });
      }
      if (hasSidePanel()) {
        await ext.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
      }
      return;
    }

    if (!hasSidePanel()) return;
    await ext.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    if (typeof ext.sidePanel.setOptions === "function") {
      await ext.sidePanel.setOptions({
        path: "index.html",
        enabled: true,
      });
    }
    if (ext.action?.setPopup) {
      await ext.action.setPopup({ popup: "" });
    }
  } catch (error) {
    console.warn("[SpotLight] sidePanel unavailable, using popup/sidebar fallback.", error);
  }
}

function openSidePanelNow(tabId?: number, windowId?: number) {
  if (prefersToolbarPopup()) return;
  const sp = ext.sidePanel;
  if (typeof sp?.open !== "function") return;
  if (windowId != null) {
    void sp.open({ windowId });
    return;
  }
  if (tabId != null) {
    void sp.open({ tabId });
  }
}

if (ext.action?.onClicked) {
  ext.action.onClicked.addListener((tab) => {
    openSidePanelNow(tab.id, tab.windowId);
  });
}

void setupSidePanelBehavior();

ext.runtime.onInstalled.addListener(async () => {
  console.log("[SpotLight] Extension installed. Applying auto-block rules...");
  await applyAutoBlockRules();
  await setupSidePanelBehavior();

  const stored = await ext.storage.local.get("masterActive");
  if (stored.masterActive !== undefined) {
    isMasterActive = stored.masterActive;
  }
});

ext.runtime.onStartup.addListener(async () => {
  console.log("[SpotLight] Browser started. Re-applying auto-block rules...");
  await applyAutoBlockRules();
  await setupSidePanelBehavior();

  const stored = await ext.storage.local.get("masterActive");
  if (stored.masterActive !== undefined) {
    isMasterActive = stored.masterActive;
  }
});

// Clean up tab logs when a tab is closed
ext.tabs.onRemoved.addListener((tabId) => {
  tabLogs.delete(tabId);
  delete tabSpoofState[tabId];
  connectedPorts.delete(tabId);
  if (hasSessionStorage()) {
    ext.storage.session.remove(`tabLog_${tabId}`);
  }
});

// ============================================================================
// Page Navigation (Clear Logs)
// ============================================================================
ext.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading' && tabId >= 0) {
    // Main frame navigation: clear logs for this tab
    tabLogs.delete(tabId);
    if (hasSessionStorage()) {
      ext.storage.session.remove(`tabLog_${tabId}`);
    }

    // Notify the popup to clear its UI
    const port = connectedPorts.get(tabId);
    if (port) {
      try {
        port.postMessage({ type: "CLEAR_LOG", payload: { tabId } });
      } catch (err) {
        connectedPorts.delete(tabId);
      }
    }
    console.log(`[SpotLight] Cleared logs for tab ${tabId} on navigation.`);
  }
});
