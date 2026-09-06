// ============================================================================
// BeaconLight — inject.ts
// Runs in PAGE CONTEXT (not content script isolated world).
// Patches fetch/XHR for observational interception and applies fingerprint/
// geolocation spoofing when enabled. Communicates via window.postMessage.
// ============================================================================

(function () {
  "use strict";

  const BEACONLIGHT_MSG_SOURCE = "__beaconlight_inject__";
  const MAX_BODY_PREVIEW = 2000;

  // ========================================================================
  // Helper: Serialize request body to a preview string
  // ========================================================================
  function serializeBody(body: unknown): string | null {
    if (!body) return null;
    try {
      if (typeof body === "string") {
        return body.slice(0, MAX_BODY_PREVIEW);
      }
      if (body instanceof URLSearchParams) {
        return body.toString().slice(0, MAX_BODY_PREVIEW);
      }
      if (body instanceof FormData) {
        const parts: string[] = [];
        body.forEach((value, key) => {
          parts.push(`${key}=${typeof value === "string" ? value : "[File]"}`);
        });
        return parts.join("&").slice(0, MAX_BODY_PREVIEW);
      }
      if (body instanceof ArrayBuffer || body instanceof Uint8Array) {
        return "[Binary Data]";
      }
      if (typeof body === "object") {
        return JSON.stringify(body).slice(0, MAX_BODY_PREVIEW);
      }
    } catch {
      // Graceful degradation: if serialization fails, return null
    }
    return null;
  }

  // ========================================================================
  // Helper: Post observed request to content script
  // ========================================================================
  function reportRequest(
    url: string,
    method: string,
    bodyPreview: string | null
  ) {
    window.postMessage(
      {
        source: BEACONLIGHT_MSG_SOURCE,
        type: "OBSERVED_REQUEST",
        payload: {
          url,
          method,
          bodyPreview,
          timestamp: Date.now(),
        },
      },
      "*"
    );
  }

  // ========================================================================
  // Patch: window.fetch (observational only — does NOT block)
  // ========================================================================
  // Helper: sanitize sensitive fields when spoofing is active
  function sanitizePayload(body: unknown): any {
    if (!spoofActive || !body) return body;
    try {
      if (typeof body === "string") {
        return body
          .replace(/"lat":\s*[-\d.]+/gi, '"lat":0.0')
          .replace(/"lng":\s*[-\d.]+/gi, '"lng":0.0')
          .replace(/"lon":\s*[-\d.]+/gi, '"lon":0.0')
          .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, "anonymous@privacy.local")
          .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, "555-000-0000");
      }
    } catch { }
    return body;
  }

  // ========================================================================
  // Patch: window.fetch (observational + payload spoofing)
  // ========================================================================
  const originalFetch = window.fetch;
  window.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    try {
      const url =
        input instanceof Request
          ? input.url
          : input instanceof URL
            ? input.href
            : String(input);
      const method = init?.method || (input instanceof Request ? input.method : "GET");

      // When spoofing is active, sanitize outgoing body
      if (spoofActive && init?.body) {
        init.body = sanitizePayload(init.body);
      }

      const bodyPreview = serializeBody(init?.body);
      reportRequest(url, method.toUpperCase(), bodyPreview);
    } catch {
      // Never break the page's own fetch calls
    }
    return originalFetch.apply(this, [input, init!]);
  };

  // ========================================================================
  // Patch: XMLHttpRequest.prototype.send (observational only)
  // ========================================================================
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;

  // Store the URL and method set during .open()
  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    ...rest: any[]
  ) {
    (this as any).__beaconlight_method = method;
    (this as any).__beaconlight_url =
      url instanceof URL ? url.href : String(url);
    return originalXHROpen.apply(this, [method, url, ...rest] as any);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    try {
      const url = (this as any).__beaconlight_url || "";
      const method = ((this as any).__beaconlight_method || "GET").toUpperCase();
      const bodyPreview = serializeBody(body);
      reportRequest(url, method, bodyPreview);
    } catch {
      // Never break the page's own XHR calls
    }
    return originalXHRSend.apply(this, [body] as any);
  };

  // ========================================================================
  // Spoofing: Apply valid fake data overrides when enabled
  // CRITICAL: All spoofed data must be syntactically valid to prevent
  // breaking the web page. See spec Section 7.3.
  // ========================================================================
  // Track spoof state
  let spoofActive = Boolean((window as any).__beaconlightSpoofEnabled);

  // If already enabled at startup, apply immediately
  if (spoofActive) {
    applyBrowserSpoofing();
  }

  // Listen for the user clicking "Spoof" in the popup mid-session
  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.source === BEACONLIGHT_MSG_SOURCE && event.data.type === "SET_SPOOF_STATE") {
      spoofActive = Boolean(event.data.enabled);
      (window as any).__beaconlightSpoofEnabled = spoofActive;
      if (spoofActive) {
        applyBrowserSpoofing();
      }
    }
  });

  function applyBrowserSpoofing() {
    try {
      Object.defineProperty(navigator, "userAgent", {
        get: () =>
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        configurable: true,
      });
      Object.defineProperty(navigator, "platform", {
        get: () => "Win32",
        configurable: true,
      });
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => 4,
        configurable: true,
      });
      Object.defineProperty(navigator, "deviceMemory", {
        get: () => 8,
        configurable: true,
      });
      Object.defineProperty(navigator, "language", {
        get: () => "en-US",
        configurable: true,
      });
      Object.defineProperty(navigator, "languages", {
        get: () => ["en-US", "en"],
        configurable: true,
      });
    } catch {
      // Some properties may not be configurable in all environments
    }

    // --- Screen dimension spoofing ---
    try {
      Object.defineProperty(screen, "width", {
        get: () => 1920,
        configurable: true,
      });
      Object.defineProperty(screen, "height", {
        get: () => 1080,
        configurable: true,
      });
      Object.defineProperty(screen, "availWidth", {
        get: () => 1920,
        configurable: true,
      });
      Object.defineProperty(screen, "availHeight", {
        get: () => 1040,
        configurable: true,
      });
      Object.defineProperty(screen, "colorDepth", {
        get: () => 24,
        configurable: true,
      });
      Object.defineProperty(screen, "pixelDepth", {
        get: () => 24,
        configurable: true,
      });
    } catch {
      // Graceful fallback
    }

    // --- Canvas fingerprint spoofing (add invisible noise) ---
    try {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (
        ...args: Parameters<typeof origToDataURL>
      ) {
        const ctx = this.getContext("2d");
        if (ctx) {
          // Add imperceptible noise to break fingerprint consistency
          ctx.fillStyle = "rgba(255,255,255,0.01)";
          ctx.fillRect(0, 0, 1, 1);
        }
        return origToDataURL.apply(this, args);
      };

      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function (
        ...args: Parameters<typeof origGetImageData>
      ) {
        const imageData = origGetImageData.apply(this, args);
        // Slightly perturb a few pixels to break fingerprint consistency
        if (imageData.data.length > 4) {
          imageData.data[0] = (imageData.data[0] + 1) % 256;
          imageData.data[3] = Math.max(imageData.data[3] - 1, 0);
        }
        return imageData;
      };
    } catch {
      // Canvas spoofing failed — non-critical
    }

    // --- WebGL renderer/vendor spoofing ---
    try {
      const origGetParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function (pname: number) {
        // UNMASKED_VENDOR_WEBGL = 0x9245, UNMASKED_RENDERER_WEBGL = 0x9246
        if (pname === 0x9245) return "Intel Inc.";
        if (pname === 0x9246) return "Intel Iris OpenGL Engine";
        return origGetParameter.call(this, pname);
      };
    } catch {
      // WebGL spoofing failed — non-critical
    }

    // --- Geolocation spoofing: return plausible fake coordinates ---
    // Assumption: Coordinates (0.0, 0.0) is "Null Island" — a valid coordinate
    // that won't crash map implementations but is clearly synthetic.
    try {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition = function (
          success: PositionCallback,
          _error?: PositionErrorCallback | null,
          _options?: PositionOptions
        ) {
          if (success) {
            success({
              coords: {
                latitude: 0.0,
                longitude: 0.0,
                accuracy: 100,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          }
        };

        navigator.geolocation.watchPosition = function (
          success: PositionCallback,
          _error?: PositionErrorCallback | null,
          _options?: PositionOptions
        ): number {
          if (success) {
            success({
              coords: {
                latitude: 0.0,
                longitude: 0.0,
                accuracy: 100,
                altitude: null,
                altitudeAccuracy: null,
                heading: null,
                speed: null,
              },
              timestamp: Date.now(),
            } as GeolocationPosition);
          }
          // Return a valid watch ID
          return 999;
        };
      }
    } catch {
      // Geolocation spoofing failed — non-critical
    }

    // Notify that spoofing was applied
    window.postMessage(
      {
        source: BEACONLIGHT_MSG_SOURCE,
        type: "SPOOF_APPLIED",
      },
      "*"
    );
  }
})();
