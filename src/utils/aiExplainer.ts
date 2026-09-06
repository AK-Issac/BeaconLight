// ============================================================================
// BeaconLight — Local On-Device AI Explainer
// 100% local-first. No external API calls.
//
// Tier 1: Chrome Built-in Gemini Nano (window.ai.languageModel)
// Tier 2: Improved heuristic analysis — reads URL structure, path segments,
//         query parameters, and category signals.
// ============================================================================

export type ExplainSource = "gemini-nano" | "heuristic";

export interface ExplainResult {
  text: string;
  source: ExplainSource;
}

// --- Tier 1: Chrome Built-in Gemini Nano ------------------------------------

async function explainWithGeminiNano(
  url: string,
  method: string,
  payload: string | null,
  category: string | null
): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ai = (window as any).ai;
  if (!ai) return null;

  try {
    const prompt =
      `You are a cybersecurity expert. In 1 or 2 simple, non-technical sentences, ` +
      `explain what this network request is doing and whether it poses a privacy risk. ` +
      `Request: METHOD ${method}, URL ${url}, ` +
      `Category: ${category ?? "uncategorised"}, ` +
      `Payload preview: ${payload ?? "none"}`;

    let session: { prompt: (p: string) => Promise<string>; destroy?: () => void } | null = null;

    if (ai.languageModel?.create) {
      session = await ai.languageModel.create();
    } else if (ai.createTextSession) {
      session = await ai.createTextSession();
    }

    if (!session) return null;

    const result = await session.prompt(prompt);
    session.destroy?.();
    const trimmed = result?.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

// --- Tier 2: Heuristic analysis ---------------------------------------------

/** Pull path segments and query param names from a URL for richer analysis. */
function parseUrl(raw: string) {
  try {
    const u = new URL(raw);
    const pathParts = u.pathname.split("/").filter(Boolean);
    const params = Array.from(u.searchParams.keys());
    return { hostname: u.hostname, pathParts, params, pathname: u.pathname };
  } catch {
    return { hostname: raw, pathParts: [] as string[], params: [] as string[], pathname: "" };
  }
}

function explainWithHeuristics(url: string, method: string, category: string | null): string {
  const { hostname, pathParts, params, pathname } = parseUrl(url);
  const urlLower = url.toLowerCase();

  // -- Extension probe --------------------------------------------------------
  if (category === "extension-probe" || url.startsWith("chrome-extension://")) {
    return (
      `${hostname} is probing your browser for installed extensions. ` +
      `By checking whether extension-specific resources load, websites can infer ` +
      `which tools you use — a behavioural fingerprinting technique with no legitimate need.`
    );
  }

  // -- Auth / session tokens --------------------------------------------------
  if (/token|auth|oauth|session|login|credential|refresh|signin/i.test(urlLower)) {
    const scope = params.includes("scope") ? " with a specific permission scope" : "";
    return (
      `This ${method} request to ${hostname} is handling authentication${scope}. ` +
      `It likely exchanges or refreshes credentials to maintain your logged-in state — ` +
      `standard behaviour, but worth noting if the domain is unfamiliar.`
    );
  }

  // -- Telemetry / analytics / ad-bidding ------------------------------------
  const telemetryPath = /\/events?|\/collect|\/track(ing)?|\/telemetry|\/metrics|\/beacon|\/ping|\/hit\b|\/pixel|\/log\b|\/stat/i;
  const adSignal = /openrtb|prebid|bidder|auction|syndication|impression/i;
  if (telemetryPath.test(pathname) || adSignal.test(urlLower)) {
    const isAd = adSignal.test(urlLower);
    if (isAd) {
      return (
        `This is a real-time ad-bidding signal sent to ${hostname}. ` +
        `It shares contextual page data and likely a user identifier so advertisers ` +
        `can bid on showing you targeted ads — a core part of behavioural advertising infrastructure.`
      );
    }
    return (
      `This ${method} call to ${hostname} is transmitting usage telemetry — ` +
      `typically page interactions, timing data, or feature engagement metrics. ` +
      `It helps the site owner understand behaviour but also builds a record of your activity.`
    );
  }

  // -- Known tracker ---------------------------------------------------------
  if (category === "known-tracker") {
    return (
      `${hostname} is a recognised cross-site tracker. ` +
      `It aggregates browsing data across many websites to build detailed user profiles ` +
      `used for targeted advertising and audience segmentation.`
    );
  }

  // -- Fingerprinting --------------------------------------------------------
  if (category === "fingerprinting") {
    return (
      `This request is exfiltrating browser or hardware attributes — ` +
      `such as screen resolution, GPU info, or audio stack characteristics — to ${hostname}. ` +
      `These signals are combined to create a device fingerprint that tracks you without cookies.`
    );
  }

  // -- Location data ---------------------------------------------------------
  if (category === "location") {
    return (
      `Location coordinates or a derived geolocation estimate are being sent to ${hostname}. ` +
      `Depending on precision, this can reveal your city, neighbourhood, or exact position.`
    );
  }

  // -- PII --------------------------------------------------------------------
  if (category === "pii") {
    return (
      `The payload of this request contains what appears to be personally identifiable information — ` +
      `possibly an email address, phone number, or name — being transmitted to ${hostname}.`
    );
  }

  // -- Static asset (image, font, script, style) -----------------------------
  const lastSeg = pathParts[pathParts.length - 1] ?? "";
  if (/\.(woff2?|ttf|eot|otf|svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|mjs|map)(\?|$)/i.test(lastSeg)) {
    const ext = lastSeg.split(".").pop()?.toUpperCase() ?? "resource";
    return (
      `This is a ${ext} asset fetch from ${hostname}. ` +
      `The browser is loading a static file needed to render the page — ` +
      `no user data is being sent outbound.`
    );
  }

  // -- API / data endpoint ---------------------------------------------------
  const isApiLike = /\/api\/|\/v\d+\/|\.json|graphql|gql|\/rpc|\/data\b/i.test(pathname);
  if (isApiLike || method === "POST" || method === "PUT" || method === "PATCH") {
    const paramSummary = params.length > 0 ? ` with parameters: ${params.slice(0, 4).join(", ")}` : "";
    return (
      `A ${method} data request to ${hostname}${paramSummary}. ` +
      `This looks like a content or application API call — ` +
      `fetching or submitting structured data to power the page's dynamic functionality.`
    );
  }

  // -- Generic fallback ------------------------------------------------------
  const pathHint = pathParts.length > 0 ? ` (path: /${pathParts.slice(0, 2).join("/")})` : "";
  return (
    `A ${method} request to ${hostname}${pathHint}. ` +
    `No specific tracking or risk signals were detected — ` +
    `this appears to be routine network activity for loading page content.`
  );
}

// --- Public API --------------------------------------------------------------

/**
 * Explains a network request using the best available local method.
 * Returns both the explanation text and which engine produced it.
 * Never makes any external network requests.
 */
export async function explainRequestLocally(
  url: string,
  method: string,
  payload: string | null,
  category: string | null
): Promise<ExplainResult> {
  // Simulate local inference processing time (1.5 s)
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const nanoText = await explainWithGeminiNano(url, method, payload, category);
  if (nanoText) {
    return { text: nanoText, source: "gemini-nano" };
  }
  return { text: explainWithHeuristics(url, method, category), source: "heuristic" };
}


