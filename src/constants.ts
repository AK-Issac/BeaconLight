// ============================================================================
// BeaconLight — Constants
// Known tracker domains (Tier 1) and heuristic classification patterns (Tier 2).
// ============================================================================

/**
 * Tier 1: Confirmed tracker domains.
 * Requests to these domains are auto-blocked via DeclarativeNetRequest on install.
 * This list covers the most common ad/analytics/tracking domains.
 */
export const KNOWN_TRACKER_DOMAINS: string[] = [
  // Google Analytics & Ads
  "google-analytics.com",
  "googletagmanager.com",
  "googlesyndication.com",
  "googleadservices.com",
  "doubleclick.net",
  "google-analytics.com",

  // Facebook / Meta
  "facebook.net",
  "facebook.com",
  "connect.facebook.net",
  "graph.facebook.com",

  // Twitter / X
  "analytics.twitter.com",
  "t.co",

  // Ad Networks
  "adnxs.com",
  "adsrvr.org",
  "criteo.com",
  "criteo.net",
  "outbrain.com",
  "taboola.com",
  "amazon-adsystem.com",

  // Analytics
  "hotjar.com",
  "fullstory.com",
  "mixpanel.com",
  "segment.io",
  "segment.com",
  "amplitude.com",
  "newrelic.com",
  "nr-data.net",
  "sentry.io",

  // Tracking pixels & fingerprinting
  "scorecardresearch.com",
  "quantserve.com",
  "demdex.net",
  "omtrdc.net",
  "bluekai.com",
  "exelator.com",
  "mathtag.com",
  "rlcdn.com",
  "crwdcntrl.net",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "casalemedia.com",
  "moatads.com",
  "doubleverify.com",
];

/**
 * Tier 2: Heuristic classification patterns.
 * These regex patterns match request URLs or body content to detect
 * fingerprinting, location tracking, extension probing, and PII leakage.
 */
export const HEURISTIC_PATTERNS = {
  /** Fingerprinting: canvas, webGL, audioContext, font enumeration */
  fingerprinting: [
    /canvas/i,
    /webgl/i,
    /audiocontext/i,
    /fingerprint/i,
    /\.toDataURL/i,
    /getImageData/i,
    /font[_-]?list/i,
    /clientRects/i,
  ],

  /** Location: geolocation coordinates, IP-based location */
  location: [
    /geolocation/i,
    /latitude/i,
    /longitude/i,
    /navigator\.geolocation/i,
    /geo[_-]?loc/i,
    /ip[_-]?location/i,
    /"lat":\s*[-\d.]+/i,
    /"lng":\s*[-\d.]+/i,
    /"lon":\s*[-\d.]+/i,
  ],

  /** Extension probing: attempts to detect installed browser extensions */
  "extension-probe": [
    /chrome-extension:\/\//i,
    /moz-extension:\/\//i,
    /extensions?\//i,
    /installed[_-]?extensions/i,
    /addon[_-]?detect/i,
    /plugin[_-]?detect/i,
  ],

  /** PII: emails, phone numbers, names being sent to third parties */
  pii: [
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,    // email
    /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                       // US phone
    /"(first[_-]?name|last[_-]?name|full[_-]?name|email|phone|ssn|address)"\s*:/i,
    /password/i,
    /credit[_-]?card/i,
    /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/,            // credit card pattern
  ],
} as const;

/**
 * Human-readable descriptions for each category.
 * Used to generate plainDescription in RequestLog entries.
 */
export const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  "known-tracker": "This request was sent to a known tracking/advertising domain.",
  fingerprinting:
    "This request may be collecting your device fingerprint (screen size, browser details, etc.).",
  location:
    "This request appears to be sending or requesting your geographic location.",
  "extension-probe":
    "This request may be probing which browser extensions you have installed.",
  pii: "This request may contain personal information like your email, phone number, or name.",
};

/**
 * Categories that support spoofing.
 * When a request matches these categories, the user can activate spoofing
 * to return plausible but fake data instead of blocking.
 */
export const SPOOFABLE_CATEGORIES = new Set(["fingerprinting", "location", "pii"]);

/**
 * Maximum body preview length to store (security constraint from Section 12).
 */
export const MAX_BODY_PREVIEW_LENGTH = 2000;
