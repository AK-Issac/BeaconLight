// ============================================================================
// BeaconLight — Background Service Worker (src/background/index.ts)
// Single service worker file handling:
//   - webRequest observation
//   - Two-Tier classification engine
//   - DeclarativeNetRequest auto-blocking (Tier 1) and manual blocking (Tier 2)
//   - Message routing between popup, content scripts, and storage
//   - Port-based live updates to the popup
// ============================================================================

import type { RequestLog, Category, Severity, Tier, TabSpoofState } from "../types";
import {
  KNOWN_TRACKER_DOMAINS,
  HEURISTIC_PATTERNS,
  CATEGORY_DESCRIPTIONS,
  SPOOFABLE_CATEGORIES,
  MAX_BODY_PREVIEW_LENGTH,
} from "../constants";

// ============================================================================
// State
// ============================================================================

/** Per-tab spoofing state (in-memory, lost on SW restart — acceptable for demo) */
const tabSpoofState: TabSpoofState = {};

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
  try {
    return new URL(url).hostname;
  } catch {
    // Fallback for malformed URLs
    const match = url.match(/^(?:https?:\/\/)?([^/:\?#]+)/);
    return match ? match[1] : url;
  }
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

  // Reduce False Positives: Skip heuristic checks for GET requests 
  // or standard asset requests (unless they matched Tier 1 above).
  const isGet = method.toUpperCase() === "GET";
  const isAsset = /\.(css|js|png|jpg|jpeg|gif|svg|woff|woff2|ico)$/i.test(url.split('?')[0]);
  
  if (!isGet && !isAsset) {
    // Tier 2: Heuristic classification
    const heuristicCategory = classifyHeuristic(url, bodyPreview);
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
  const rules: chrome.declarativeNetRequest.Rule[] =
    KNOWN_TRACKER_DOMAINS.map((domain, index) => ({
      id: index + 1, // Rule IDs 1..N for auto-block
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.BLOCK,
      },
      condition: {
        urlFilter: `||${domain}`,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
          chrome.declarativeNetRequest.ResourceType.SCRIPT,
          chrome.declarativeNetRequest.ResourceType.IMAGE,
          chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
          chrome.declarativeNetRequest.ResourceType.STYLESHEET,
          chrome.declarativeNetRequest.ResourceType.FONT,
          chrome.declarativeNetRequest.ResourceType.MEDIA,
          chrome.declarativeNetRequest.ResourceType.PING,
          chrome.declarativeNetRequest.ResourceType.OTHER,
        ],
      },
    }));

  try {
    // Remove any existing session rules first
    const existingRules =
      await chrome.declarativeNetRequest.getSessionRules();
    const removeIds = existingRules
      .filter((r) => r.id < 10000) // Only remove auto-block rules (< 10000)
      .map((r) => r.id);

    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: removeIds,
      addRules: rules,
    });
    console.log(
      `[BeaconLight] Auto-block rules applied for ${rules.length} known tracker domains.`
    );
  } catch (err) {
    console.error("[BeaconLight] Failed to apply auto-block rules:", err);
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
      type: chrome.declarativeNetRequest.RuleActionType.BLOCK,
    },
    condition: {
      urlFilter: `||${domain}`,
      resourceTypes: [
        chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
        chrome.declarativeNetRequest.ResourceType.SCRIPT,
        chrome.declarativeNetRequest.ResourceType.IMAGE,
        chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
        chrome.declarativeNetRequest.ResourceType.STYLESHEET,
        chrome.declarativeNetRequest.ResourceType.FONT,
        chrome.declarativeNetRequest.ResourceType.MEDIA,
        chrome.declarativeNetRequest.ResourceType.PING,
        chrome.declarativeNetRequest.ResourceType.OTHER,
      ],
    },
  };

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      addRules: [rule],
    });

    // Persist to chrome.storage.local
    const stored = await chrome.storage.local.get("blockedDomains");
    const blockedDomains: string[] = stored.blockedDomains || [];
    if (!blockedDomains.includes(domain)) {
      blockedDomains.push(domain);
      await chrome.storage.local.set({ blockedDomains });
    }

    // Update in-memory logs to reflect blocked state
    for (const [, logs] of tabLogs) {
      for (const log of logs) {
        if (log.domain === domain) {
          log.isBlocked = true;
        }
      }
    }

    console.log(`[BeaconLight] Manually blocked domain: ${domain}`);
  } catch (err) {
    console.error(`[BeaconLight] Failed to block domain ${domain}:`, err);
  }
}

/**
 * Unblock a previously manually blocked domain.
 */
async function unblockDomain(domain: string) {
  try {
    // Find and remove the dynamic rule for this domain
    const dynamicRules = await chrome.declarativeNetRequest.getDynamicRules();
    const ruleToRemove = dynamicRules.find(
      (r) => r.condition.urlFilter === `||${domain}`
    );
    if (ruleToRemove) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [ruleToRemove.id],
      });
    }

    // Remove from chrome.storage.local
    const stored = await chrome.storage.local.get("blockedDomains");
    const blockedDomains: string[] = (stored.blockedDomains || []).filter(
      (d: string) => d !== domain
    );
    await chrome.storage.local.set({ blockedDomains });

    // Update in-memory logs
    for (const [, logs] of tabLogs) {
      for (const log of logs) {
        if (log.domain === domain) {
          log.isBlocked = false;
        }
      }
    }

    console.log(`[BeaconLight] Unblocked domain: ${domain}`);
  } catch (err) {
    console.error(`[BeaconLight] Failed to unblock domain ${domain}:`, err);
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

  // Check if this domain was manually blocked
  const stored = await chrome.storage.local.get("blockedDomains");
  const manuallyBlocked: string[] = stored.blockedDomains || [];
  const isManuallyBlocked = manuallyBlocked.includes(domain);

  const log: RequestLog = {
    id: generateId(),
    url,
    domain,
    timestamp: Date.now(),
    severity: classification.severity,
    category: classification.category,
    plainDescription: classification.plainDescription,
    bodyPreview: bodyPreview?.slice(0, MAX_BODY_PREVIEW_LENGTH) || null,
    isBlocked: classification.isAutoBlocked || isManuallyBlocked,
    isAutoBlocked: classification.isAutoBlocked,
    isSpoofed: tabSpoofState[tabId] === true && classification.spoofable,
    spoofable: classification.spoofable,
    tier: classification.tier,
    method,
    tabId,
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

  // Persist to chrome.storage.session
  try {
    await chrome.storage.session.set({ [`tabLog_${tabId}`]: logs });
  } catch {
    // Storage quota exceeded — acceptable for demo
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
chrome.webRequest.onBeforeRequest.addListener(
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      const logs = tabLogs.get(requestedTabId) || [];
      sendResponse({ type: "TAB_LOG_RESPONSE", payload: { logs } });
      return true; // async response
    }

    case "BLOCK_DOMAIN": {
      blockDomain(message.payload.domain);
      sendResponse({ success: true });
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
      chrome.tabs.sendMessage(spoofTabId, {
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

      chrome.tabs.sendMessage(disableSpoofTabId, {
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
      chrome.storage.local.set({ masterActive: isMasterActive });
      sendResponse({ success: true });
      return true;
    }
  }
});

// ============================================================================
// Port-based Live Updates (Popup ↔ Background)
// ============================================================================
chrome.runtime.onConnect.addListener((port) => {
  if (port.name.startsWith("beaconlight-popup-")) {
    const portTabId = parseInt(port.name.replace("beaconlight-popup-", ""), 10);
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
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[BeaconLight] Extension installed. Applying auto-block rules...");
  await applyAutoBlockRules();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));
  
  const stored = await chrome.storage.local.get("masterActive");
  if (stored.masterActive !== undefined) {
    isMasterActive = stored.masterActive;
  }
});

chrome.runtime.onStartup.addListener(async () => {
  console.log("[BeaconLight] Browser started. Re-applying auto-block rules...");
  await applyAutoBlockRules();
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => console.error(error));

  const stored = await chrome.storage.local.get("masterActive");
  if (stored.masterActive !== undefined) {
    isMasterActive = stored.masterActive;
  }
});

// Clean up tab logs when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabLogs.delete(tabId);
  delete tabSpoofState[tabId];
  connectedPorts.delete(tabId);
  chrome.storage.session.remove(`tabLog_${tabId}`);
});

// ============================================================================
// Page Navigation (Clear Logs)
// ============================================================================
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId === 0 && details.tabId >= 0) {
    // Main frame navigation: clear logs for this tab
    tabLogs.delete(details.tabId);
    chrome.storage.session.remove(`tabLog_${details.tabId}`);
    
    // Notify the popup to clear its UI
    const port = connectedPorts.get(details.tabId);
    if (port) {
      try {
        port.postMessage({ type: "CLEAR_LOG", payload: { tabId: details.tabId } });
      } catch (err) {
        connectedPorts.delete(details.tabId);
      }
    }
    
    console.log(`[BeaconLight] Cleared logs for tab ${details.tabId} on navigation.`);
  }
});
