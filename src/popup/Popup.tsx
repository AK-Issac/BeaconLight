// ============================================================================
// BeaconLight — Popup.tsx
// Main React UI component for the extension popup.
// Uses React Hooks (useState, useEffect) for state management.
// Opens a chrome.runtime.connect port for live request log updates.
// ============================================================================

import { useState, useEffect, useCallback, useRef } from "react";
import type { RequestLog, Category } from "../types";

type FilterMode = "all" | "flagged" | "blocked" | "spoofed";

/** Map categories to badge CSS class suffixes */
const CATEGORY_BADGE_CLASS: Record<string, string> = {
  "known-tracker": "tracker",
  fingerprinting: "fingerprint",
  location: "location",
  "extension-probe": "extension-probe",
  pii: "pii",
};

/** Map categories to human-readable short labels */
const CATEGORY_LABELS: Record<string, string> = {
  "known-tracker": "Tracker",
  fingerprinting: "Fingerprint",
  location: "Location",
  "extension-probe": "Ext. Probe",
  pii: "PII",
};

/** Format a timestamp as relative time */
function formatTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// ============================================================================
// RequestCard Component
// ============================================================================
function RequestCard({
  log,
  onBlock,
  onSpoof,
}: {
  log: RequestLog;
  onBlock: (domain: string) => void;
  onSpoof: (tabId: number) => void;
}) {
  const severityClass = log.severity === "flagged" ? "flagged" : "neutral";
  const blockedClass = log.isBlocked || log.isAutoBlocked ? "blocked" : "";

  return (
    <div
      className={`request-card request-card--${severityClass} ${
        blockedClass ? "request-card--blocked" : ""
      }`}
      id={`request-${log.id}`}
    >
      <div className="request-card__top">
        <div className="request-card__domain-row">
          {log.severity === "flagged" && (
            <span className="request-card__flag">🚩</span>
          )}
          <span className="request-card__domain">{log.domain}</span>
          <span className="request-card__method">{log.method}</span>
        </div>
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
          {log.category && (
            <span
              className={`request-card__badge request-card__badge--${
                CATEGORY_BADGE_CLASS[log.category] || "tracker"
              }`}
            >
              {CATEGORY_LABELS[log.category] || log.category}
            </span>
          )}
          {log.isAutoBlocked && (
            <span className="request-card__badge request-card__badge--blocked">
              Auto-blocked
            </span>
          )}
          {log.isBlocked && !log.isAutoBlocked && (
            <span className="request-card__badge request-card__badge--blocked">
              Blocked
            </span>
          )}
          {log.isSpoofed && (
            <span className="request-card__badge request-card__badge--spoofed">
              Spoofed
            </span>
          )}
        </div>
      </div>

      <p className="request-card__description">{log.plainDescription}</p>

      <div className="request-card__url" title={log.url}>
        {log.url}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div className="request-card__actions">
          {log.isAutoBlocked ? (
            <span className="request-card__auto-blocked">
              🛡️ Auto-blocked Tracker
            </span>
          ) : (
            <>
              {!log.isBlocked && (
                <button
                  className="request-card__btn request-card__btn--block"
                  onClick={() => onBlock(log.domain)}
                  id={`block-${log.id}`}
                >
                  Block
                </button>
              )}
              {log.spoofable && !log.isSpoofed && (
                <button
                  className="request-card__btn request-card__btn--spoof"
                  onClick={() => onSpoof(log.tabId)}
                  id={`spoof-${log.id}`}
                >
                  Spoof
                </button>
              )}
            </>
          )}
        </div>
        <span className="request-card__time">{formatTime(log.timestamp)}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Main Popup Component
// ============================================================================
export function Popup() {
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [spoofEnabled, setSpoofEnabled] = useState(false);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get the active tab ID on mount
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        setActiveTabId(tabs[0].id);
      }
    });
  }, []);

  // Fetch initial logs and open port for live updates
  useEffect(() => {
    if (activeTabId === null) return;

    // Fetch existing logs for this tab
    chrome.runtime.sendMessage(
      { type: "GET_TAB_LOG", payload: { tabId: activeTabId } },
      (response) => {
        if (response?.payload?.logs) {
          setRequestLogs(response.payload.logs);
        }
      }
    );

    // Open a named port for live updates
    const port = chrome.runtime.connect({
      name: `beaconlight-popup-${activeTabId}`,
    });
    portRef.current = port;

    port.onMessage.addListener((message) => {
      if (message.type === "LIVE_UPDATE" && message.payload?.log) {
        setRequestLogs((prev) => {
          const updated = [...prev, message.payload.log];
          // Keep only last 500
          return updated.length > 500 ? updated.slice(-500) : updated;
        });
      }
    });

    return () => {
      port.disconnect();
      portRef.current = null;
    };
  }, [activeTabId]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [requestLogs]);

  // Handle manual block action
  const handleBlock = useCallback((domain: string) => {
    chrome.runtime.sendMessage(
      { type: "BLOCK_DOMAIN", payload: { domain } },
      () => {
        // Update local state optimistically
        setRequestLogs((prev) =>
          prev.map((log) =>
            log.domain === domain ? { ...log, isBlocked: true } : log
          )
        );
      }
    );
  }, []);

  // Handle spoof action
  const handleSpoof = useCallback(
    (tabId: number) => {
      chrome.runtime.sendMessage(
        { type: "ENABLE_SPOOF", payload: { tabId } },
        () => {
          setSpoofEnabled(true);
          setRequestLogs((prev) =>
            prev.map((log) =>
              log.spoofable ? { ...log, isSpoofed: true } : log
            )
          );
        }
      );
    },
    []
  );

  // Handle global spoof toggle
  const handleSpoofToggle = useCallback(() => {
    if (activeTabId === null) return;

    if (spoofEnabled) {
      chrome.runtime.sendMessage({
        type: "DISABLE_SPOOF",
        payload: { tabId: activeTabId },
      });
      setSpoofEnabled(false);
      setRequestLogs((prev) =>
        prev.map((log) => ({ ...log, isSpoofed: false }))
      );
    } else {
      chrome.runtime.sendMessage({
        type: "ENABLE_SPOOF",
        payload: { tabId: activeTabId },
      });
      setSpoofEnabled(true);
      setRequestLogs((prev) =>
        prev.map((log) =>
          log.spoofable ? { ...log, isSpoofed: true } : log
        )
      );
    }
  }, [activeTabId, spoofEnabled]);

  // Compute summary stats
  const totalRequests = requestLogs.length;
  const flaggedCount = requestLogs.filter(
    (l) => l.severity === "flagged"
  ).length;
  const blockedCount = requestLogs.filter(
    (l) => l.isBlocked || l.isAutoBlocked
  ).length;

  // Apply filter
  const filteredLogs = requestLogs.filter((log) => {
    switch (filter) {
      case "flagged":
        return log.severity === "flagged";
      case "blocked":
        return log.isBlocked || log.isAutoBlocked;
      case "spoofed":
        return log.isSpoofed;
      default:
        return true;
    }
  });

  // Show flagged items first, then by timestamp (newest last)
  const sortedLogs = [...filteredLogs].sort((a, b) => {
    // Flagged items rise to top within their time order
    if (a.severity === "flagged" && b.severity !== "flagged") return -1;
    if (a.severity !== "flagged" && b.severity === "flagged") return 1;
    return a.timestamp - b.timestamp;
  });

  return (
    <div className="beaconlight" id="beaconlight-root">
      {/* Header */}
      <header className="header">
        <div className="header__top">
          <div className="header__brand">
            <div className="header__logo">B</div>
            <h1 className="header__title">BeaconLight</h1>
          </div>
          <div className="header__spoof-toggle">
            <span className="header__spoof-label">Spoof</span>
            <label className="toggle" id="spoof-toggle">
              <input
                type="checkbox"
                checked={spoofEnabled}
                onChange={handleSpoofToggle}
              />
              <span className="toggle__slider" />
            </label>
          </div>
        </div>
        <div className="header__stats">
          <div className="stat-chip stat-chip--flagged">
            <span className="stat-chip__icon">🚩</span>
            <span className="stat-chip__value">{flaggedCount}</span>
            <span>Flagged</span>
          </div>
          <div className="stat-chip stat-chip--blocked">
            <span className="stat-chip__icon">🛡️</span>
            <span className="stat-chip__value">{blockedCount}</span>
            <span>Blocked</span>
          </div>
          <div className="stat-chip stat-chip--total">
            <span className="stat-chip__icon">📡</span>
            <span className="stat-chip__value">{totalRequests}</span>
            <span>Total</span>
          </div>
        </div>
      </header>

      {/* Filter Bar */}
      <div className="filter-bar" id="filter-bar">
        {(["all", "flagged", "blocked", "spoofed"] as FilterMode[]).map(
          (mode) => (
            <button
              key={mode}
              className={`filter-btn ${
                filter === mode ? "filter-btn--active" : ""
              }`}
              onClick={() => setFilter(mode)}
              id={`filter-${mode}`}
            >
              {mode === "all"
                ? "All"
                : mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          )
        )}
      </div>

      {/* Request List */}
      <div className="request-list" ref={listRef} id="request-list">
        {sortedLogs.length === 0 ? (
          <div className="request-list__empty">
            <span className="request-list__empty-icon">🔍</span>
            <span className="request-list__empty-title">
              {filter === "all"
                ? "No requests captured yet"
                : `No ${filter} requests`}
            </span>
            <span className="request-list__empty-subtitle">
              {filter === "all"
                ? "Browse the web and BeaconLight will show you what data is being sent about you."
                : "Try switching to a different filter to see more results."}
            </span>
          </div>
        ) : (
          sortedLogs.map((log) => (
            <RequestCard
              key={log.id}
              log={log}
              onBlock={handleBlock}
              onSpoof={handleSpoof}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <footer className="footer" id="footer">
        <div className="footer__summary">
          <span>
            Session: {totalRequests} requests • {flaggedCount} flagged •{" "}
            {blockedCount} blocked
          </span>
          <span className="footer__link pulse">● Live</span>
        </div>
      </footer>
    </div>
  );
}
