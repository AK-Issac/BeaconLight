import type { RequestLog } from "../types";

/** Mock traffic for `index.html?preview=1` so the panel can be designed in a browser. */
export function createPreviewLogs(): RequestLog[] {
  const now = Date.now();
  return [
    {
      id: "p1",
      url: "https://www.google-analytics.com/g/collect?v=2",
      domain: "google-analytics.com",
      timestamp: now - 4000,
      severity: "flagged",
      category: "known-tracker",
      plainDescription:
        "This request was sent to a known tracking/advertising domain.",
      bodyPreview: null,
      isBlocked: true,
      isAutoBlocked: true,
      isSpoofed: false,
      spoofable: false,
      tier: 1,
      method: "POST",
      tabId: 1,
    },
    {
      id: "p2",
      url: "https://geo.maps.example/locate?lat=25.2&lng=55.2",
      domain: "geo.maps.example",
      timestamp: now - 9000,
      severity: "flagged",
      category: "location",
      plainDescription:
        "This request appears to be sending or requesting your geographic location.",
      bodyPreview: '{"lat":25.2,"lng":55.2}',
      isBlocked: false,
      isAutoBlocked: false,
      isSpoofed: false,
      spoofable: true,
      tier: 2,
      method: "POST",
      tabId: 1,
    },
    {
      id: "p3",
      url: "https://probe.news.example/detect?target=chrome-extension://",
      domain: "probe.news.example",
      timestamp: now - 16000,
      severity: "flagged",
      category: "extension-probe",
      plainDescription:
        "This request may be probing which browser extensions you have installed.",
      bodyPreview: null,
      isBlocked: false,
      isAutoBlocked: false,
      isSpoofed: false,
      spoofable: false,
      tier: 2,
      method: "GET",
      tabId: 1,
    },
    {
      id: "p4",
      url: "https://cdn.example.org/app/main.js",
      domain: "cdn.example.org",
      timestamp: now - 20000,
      severity: "neutral",
      category: null,
      plainDescription: "Standard request — no tracking indicators detected.",
      bodyPreview: null,
      isBlocked: false,
      isAutoBlocked: false,
      isSpoofed: false,
      spoofable: false,
      tier: 2,
      method: "GET",
      tabId: 1,
    },
    {
      id: "p5",
      url: "https://finger.adnet.example/id",
      domain: "finger.adnet.example",
      timestamp: now - 25000,
      severity: "flagged",
      category: "fingerprinting",
      plainDescription:
        "This request may be collecting your device fingerprint (screen size, browser details, etc.).",
      bodyPreview: "canvas=true&webgl=Intel",
      isBlocked: false,
      isAutoBlocked: false,
      isSpoofed: false,
      spoofable: true,
      tier: 2,
      method: "POST",
      tabId: 1,
    },
  ];
}

export function isPreviewMode(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("preview") === "1";
  } catch {
    return false;
  }
}
