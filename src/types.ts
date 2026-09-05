// ============================================================================
// BeaconLight — TypeScript Interfaces
// All shared types for messages, request logs, and internal state.
// ============================================================================

/** Severity levels for classified requests */
export type Severity = "flagged" | "neutral";

/** Categories assigned by the classification engine */
export type Category =
  | "known-tracker"       // Tier 1: domain in KNOWN_TRACKER_DOMAINS
  | "fingerprinting"      // Tier 2: canvas, webGL, audioContext fingerprinting
  | "location"            // Tier 2: geolocation data detected
  | "extension-probe"     // Tier 2: probing for installed extensions
  | "pii"                 // Tier 2: personally identifiable information detected
  | null;                 // No classification match

/** Tier classification for the Two-Tier trust system */
export type Tier = 1 | 2;

/** A single logged request entry */
export interface RequestLog {
  id: string;
  url: string;
  domain: string;
  timestamp: number;
  severity: Severity;
  category: Category;
  plainDescription: string;
  bodyPreview: string | null;
  isBlocked: boolean;
  isAutoBlocked: boolean;   // True for Tier 1 known trackers
  isSpoofed: boolean;
  spoofable: boolean;        // True if category supports spoofing (fingerprinting, location)
  tier: Tier;
  method: string;            // HTTP method (GET, POST, etc.)
  tabId: number;
}

// ============================================================================
// Message Types — Structured message passing between components
// ============================================================================

/** Sent from inject.ts → content script → background when a fetch/XHR is observed */
export interface ObservedRequestMessage {
  type: "OBSERVED_REQUEST";
  payload: {
    url: string;
    method: string;
    bodyPreview: string | null;
    timestamp: number;
  };
}

/** Sent from popup → background to retrieve logs for a specific tab */
export interface GetTabLogMessage {
  type: "GET_TAB_LOG";
  payload: {
    tabId: number;
  };
}

/** Response from background → popup with the tab's request logs */
export interface TabLogResponse {
  type: "TAB_LOG_RESPONSE";
  payload: {
    logs: RequestLog[];
  };
}

/** Sent from popup → background to manually block a domain (Tier 2) */
export interface BlockDomainMessage {
  type: "BLOCK_DOMAIN";
  payload: {
    domain: string;
  };
}

/** Sent from popup → background to unblock a previously blocked domain */
export interface UnblockDomainMessage {
  type: "UNBLOCK_DOMAIN";
  payload: {
    domain: string;
  };
}

/** Sent from popup → background to enable spoofing for the active tab */
export interface EnableSpoofMessage {
  type: "ENABLE_SPOOF";
  payload: {
    tabId: number;
  };
}

/** Sent from popup → background to disable spoofing for the active tab */
export interface DisableSpoofMessage {
  type: "DISABLE_SPOOF";
  payload: {
    tabId: number;
  };
}

/** Live update pushed from background → popup via port connection */
export interface LiveUpdateMessage {
  type: "LIVE_UPDATE";
  payload: {
    log: RequestLog;
  };
}

/** Sent from background → content script to toggle spoofing */
export interface SpoofToggleMessage {
  type: "SPOOF_TOGGLE";
  payload: {
    enabled: boolean;
  };
}

/** Union of all message types for type-safe message handling */
export type BeaconLightMessage =
  | ObservedRequestMessage
  | GetTabLogMessage
  | TabLogResponse
  | BlockDomainMessage
  | UnblockDomainMessage
  | EnableSpoofMessage
  | DisableSpoofMessage
  | LiveUpdateMessage
  | SpoofToggleMessage;

// ============================================================================
// Internal State
// ============================================================================

/** Per-tab spoofing state tracked in the background service worker */
export interface TabSpoofState {
  [tabId: number]: boolean;
}

/** Stored blocked domains (chrome.storage.local) */
export interface BlockedDomainsStorage {
  blockedDomains: string[];
}
