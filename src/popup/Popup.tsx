// ============================================================================
// BeaconLight — Popup.tsx (Side Panel)
// Main React UI component for the extension side panel.
// ============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
// DomainGroup Component (Accordion)
// ============================================================================
function DomainGroup({
  domain,
  logs,
  onBlock,
  onUnblock,
  onSpoof,
}: {
  domain: string;
  logs: RequestLog[];
  onBlock: (domain: string) => void;
  onUnblock: (domain: string) => void;
  onSpoof: (tabId: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const isAutoBlocked = logs.some((l) => l.isAutoBlocked);
  const isBlocked = logs.some((l) => l.isBlocked);
  const hasFlagged = logs.some((l) => l.severity === "flagged");
  const isSpoofable = logs.some((l) => l.spoofable);
  const isSpoofed = logs.some((l) => l.isSpoofed);

  const severityClass = hasFlagged ? "flagged" : "neutral";
  const blockedClass = isBlocked || isAutoBlocked ? "blocked" : "";

  // Get unique categories for badges
  const categories = Array.from(new Set(logs.map((l) => l.category).filter(Boolean))) as Category[];

  return (
    <div
      className={`request-card request-card--${severityClass} ${
        blockedClass ? "request-card--blocked" : ""
      }`}
    >
      <div
        className="request-card__top"
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: "pointer" }}
      >
        <div className="request-card__domain-row">
          {hasFlagged && <span className="request-card__flag">🚩</span>}
          <span className="request-card__domain">{domain}</span>
          <span className="request-card__count">({logs.length})</span>
          <span className="request-card__expand-icon">{expanded ? "▼" : "▶"}</span>
        </div>
        <div className="request-card__badges">
          {categories.map((cat) => (
            <span
              key={cat}
              className={`request-card__badge request-card__badge--${
                CATEGORY_BADGE_CLASS[cat!] || "tracker"
              }`}
            >
              {CATEGORY_LABELS[cat!] || cat}
            </span>
          ))}
          {isAutoBlocked && (
            <span className="request-card__badge request-card__badge--blocked">
              Auto-blocked
            </span>
          )}
          {isBlocked && !isAutoBlocked && (
            <span className="request-card__badge request-card__badge--blocked">
              Blocked
            </span>
          )}
          {isSpoofed && (
            <span className="request-card__badge request-card__badge--spoofed">
              Spoofed
            </span>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: "8px",
        }}
      >
        <div className="request-card__actions">
          {isAutoBlocked ? (
            <span className="request-card__auto-blocked">
              🛡️ Auto-blocked Tracker
            </span>
          ) : (
            <>
              {isBlocked ? (
                <button
                  className="request-card__btn request-card__btn--unblock"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnblock(domain);
                  }}
                >
                  Unblock
                </button>
              ) : (
                <button
                  className="request-card__btn request-card__btn--block"
                  onClick={(e) => {
                    e.stopPropagation();
                    onBlock(domain);
                  }}
                >
                  Block
                </button>
              )}
              {isSpoofable && !isSpoofed && (
                <button
                  className="request-card__btn request-card__btn--spoof"
                  onClick={(e) => {
                    e.stopPropagation();
                    // Grab tabId from the first log
                    onSpoof(logs[0].tabId);
                  }}
                >
                  Spoof
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {expanded && (
        <div className="request-card__details">
          {[...logs]
            .sort((a, b) => {
              // Flagged items to the top
              if (a.severity === "flagged" && b.severity !== "flagged") return -1;
              if (a.severity !== "flagged" && b.severity === "flagged") return 1;
              return b.timestamp - a.timestamp;
            })
            .map((log) => (
              <div
                key={log.id}
                className={`request-card__log-item ${
                  log.severity === "flagged" ? "request-card__log-item--flagged" : ""
                }`}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                  <span className="request-card__method">{log.method}</span>
                  <span className="request-card__time">{formatTime(log.timestamp)}</span>
                </div>
                {log.severity === "flagged" && (
                  <div className="request-card__culprit-alert">
                    ⚠️ {CATEGORY_LABELS[log.category!] || "Suspicious behavior"}
                  </div>
                )}
                <p className="request-card__description">{log.plainDescription}</p>
                <div className="request-card__url" title={log.url}>
                  {log.url}
                </div>
              </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Main Popup Component (Side Panel)
// ============================================================================
export function Popup() {
  const [requestLogs, setRequestLogs] = useState<RequestLog[]>([]);
  const [filter, setFilter] = useState<FilterMode>("all");
  const [isMasterActive, setIsMasterActive] = useState(true);
  const [spoofEnabled, setSpoofEnabled] = useState(false);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const portRef = useRef<chrome.runtime.Port | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get active tab ID and master state on mount
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        setActiveTabId(tabs[0].id);
      }
    });

    chrome.runtime.sendMessage({ type: "GET_MASTER_ACTIVE" }, (response) => {
      if (response && response.active !== undefined) {
        setIsMasterActive(response.active);
      }
    });
  }, []);

  // Fetch initial logs and open port for live updates
  useEffect(() => {
    if (activeTabId === null) return;

    chrome.runtime.sendMessage(
      { type: "GET_TAB_LOG", payload: { tabId: activeTabId } },
      (response) => {
        if (response?.payload?.logs) {
          setRequestLogs(response.payload.logs);
        }
      }
    );

    const port = chrome.runtime.connect({
      name: `beaconlight-popup-${activeTabId}`,
    });
    portRef.current = port;

    port.onMessage.addListener((message) => {
      if (message.type === "LIVE_UPDATE" && message.payload?.log) {
        setRequestLogs((prev) => {
          const updated = [...prev, message.payload.log];
          return updated.length > 500 ? updated.slice(-500) : updated;
        });
      } else if (message.type === "CLEAR_LOG") {
        if (message.payload?.tabId === activeTabId) {
          setRequestLogs([]);
        }
      }
    });

    return () => {
      port.disconnect();
      portRef.current = null;
    };
  }, [activeTabId]);

  const handleMasterToggle = useCallback(() => {
    const newState = !isMasterActive;
    chrome.runtime.sendMessage(
      { type: "SET_MASTER_ACTIVE", payload: { active: newState } },
      () => {
        setIsMasterActive(newState);
      }
    );
  }, [isMasterActive]);

  const handleBlock = useCallback((domain: string) => {
    chrome.runtime.sendMessage(
      { type: "BLOCK_DOMAIN", payload: { domain } },
      () => {
        setRequestLogs((prev) =>
          prev.map((log) =>
            log.domain === domain ? { ...log, isBlocked: true } : log
          )
        );
      }
    );
  }, []);

  const handleUnblock = useCallback((domain: string) => {
    chrome.runtime.sendMessage(
      { type: "UNBLOCK_DOMAIN", payload: { domain } },
      () => {
        setRequestLogs((prev) =>
          prev.map((log) =>
            log.domain === domain ? { ...log, isBlocked: false } : log
          )
        );
      }
    );
  }, []);

  const handleSpoof = useCallback((tabId: number) => {
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
  }, []);

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
  const flaggedCount = requestLogs.filter((l) => l.severity === "flagged").length;
  const blockedCount = requestLogs.filter((l) => l.isBlocked || l.isAutoBlocked).length;

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

  // Group by Domain
  const groupedLogs = useMemo(() => {
    const groups: Record<string, RequestLog[]> = {};
    for (const log of filteredLogs) {
      if (!groups[log.domain]) {
        groups[log.domain] = [];
      }
      groups[log.domain].push(log);
    }
    // Sort groups: flagged domains first, then alphabetically
    return Object.entries(groups).sort(([domainA, logsA], [domainB, logsB]) => {
      const aFlagged = logsA.some((l) => l.severity === "flagged");
      const bFlagged = logsB.some((l) => l.severity === "flagged");
      if (aFlagged && !bFlagged) return -1;
      if (!aFlagged && bFlagged) return 1;
      return domainA.localeCompare(domainB);
    });
  }, [filteredLogs]);

  return (
    <div className="beaconlight" id="beaconlight-root">
      {/* Header */}
      <header className="header">
        <div className="header__top">
          <div className="header__brand">
            <div className="header__logo">B</div>
            <h1 className="header__title">BeaconLight</h1>
          </div>
          <div className="header__toggles">
            <div className="header__master-toggle">
              <span className="header__toggle-label">
                {isMasterActive ? "Active" : "Paused"}
              </span>
              <label className="toggle" id="master-toggle">
                <input
                  type="checkbox"
                  checked={isMasterActive}
                  onChange={handleMasterToggle}
                />
                <span className="toggle__slider" />
              </label>
            </div>
          </div>
        </div>

        {/* Spoof Toggle - Only show if master is active */}
        {isMasterActive && (
          <div className="header__spoof-row">
            <span className="header__spoof-label">Global Spoofing</span>
            <label className="toggle toggle--small" id="spoof-toggle">
              <input
                type="checkbox"
                checked={spoofEnabled}
                onChange={handleSpoofToggle}
              />
              <span className="toggle__slider" />
            </label>
          </div>
        )}

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

      {/* Request List (Accordion) */}
      <div className="request-list" ref={listRef} id="request-list">
        {!isMasterActive ? (
          <div className="request-list__empty">
            <span className="request-list__empty-icon">⏸️</span>
            <span className="request-list__empty-title">BeaconLight is Paused</span>
            <span className="request-list__empty-subtitle">
              Toggle the Active switch above to resume request observation.
            </span>
          </div>
        ) : groupedLogs.length === 0 ? (
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
          groupedLogs.map(([domain, logs]) => (
            <DomainGroup
              key={domain}
              domain={domain}
              logs={logs}
              onBlock={handleBlock}
              onUnblock={handleUnblock}
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
          <span className={`footer__link ${isMasterActive ? "pulse" : ""}`}>
            {isMasterActive ? "● Live" : "○ Paused"}
          </span>
        </div>
      </footer>
    </div>
  );
}
